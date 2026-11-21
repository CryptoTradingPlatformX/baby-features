import { describe, expect, it } from "vitest";
import { createInviteApi, inviteApiUrl, normalizeUploadTicket, uploadRequest } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("invite API client", () => {
  it("hides the placeholder and blank base URLs", () => {
    expect(inviteApiUrl("")).toBeNull();
    expect(inviteApiUrl(undefined)).toBeNull();
    expect(inviteApiUrl("https://REPLACE_ME.execute-api.us-east-1.amazonaws.com")).toBeNull();
    expect(inviteApiUrl("https://api.example.test/")).toBe("https://api.example.test");
  });

  it("creates invites, lists them, and deletes with the owner key", async () => {
    const calls: { url: string; method: string; owner: string | null; body: string | null }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        owner: headers.get("x-owner-key"),
        body: typeof init?.body === "string" ? init.body : null,
      });
      if (url.endsWith("/invites") && init?.method === "POST") {
        return jsonResponse({
          ownerKey: "owner-1",
          invites: [{ token: "tok", name: "Ruth", role: "Grandma", link: "https://site/#/upload/tok", expiresAt: "2026-12-01" }],
        });
      }
      if (url.endsWith("/owner/invites") && !init?.method) {
        return jsonResponse([{ token: "tok", name: "Ruth", role: "Grandma", status: "partial", slots: { front: "https://files/front" } }]);
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return jsonResponse({ message: "nope" }, 500);
    };
    const api = createInviteApi("https://api.example.test/", fetchImpl);
    const created = await api.createInvites({ ownerName: "Steven", babyName: "Ada", people: [{ name: "Ruth", role: "Grandma" }] });
    expect(created.ownerKey).toBe("owner-1");
    expect(created.invites[0].link).toContain("#/upload/tok");
    const list = await api.listOwnerInvites("owner-1");
    expect(list[0].slots.front).toBe("https://files/front");
    await api.deleteInvite("owner-1", "tok");
    expect(calls.map((call) => `${call.method} ${call.url} key=${call.owner}`)).toEqual([
      "POST https://api.example.test/invites key=null",
      "GET https://api.example.test/owner/invites key=owner-1",
      "DELETE https://api.example.test/owner/invites/tok key=owner-1",
    ]);
    expect(JSON.parse(calls[0].body!)).toMatchObject({ babyName: "Ada" });
  });

  it("turns a missing invite into a 404 error", async () => {
    const api = createInviteApi("https://api.example.test", async () => jsonResponse({ message: "gone" }, 404));
    await expect(api.getInvite("missing")).rejects.toMatchObject({ status: 404, message: "gone" });
  });

  it("uploads with PUT headers or a presigned POST form", async () => {
    const put = normalizeUploadTicket({ url: "https://s3/put", method: "PUT", headers: { "content-type": "image/jpeg" } });
    expect(put.method).toBe("PUT");
    const putRequest = uploadRequest(put, new Blob(["a"], { type: "image/jpeg" }));
    expect(putRequest.headers["content-type"]).toBe("image/jpeg");
    expect(putRequest.body).toBeInstanceOf(Blob);

    const post = normalizeUploadTicket({ url: "https://s3/post", fields: { key: "photos/a.jpg", policy: "abc" } });
    expect(post.method).toBe("POST");
    const postRequest = uploadRequest(post, new Blob(["a"], { type: "image/jpeg" }));
    expect(postRequest.body).toBeInstanceOf(FormData);
    const form = postRequest.body as FormData;
    expect(form.get("key")).toBe("photos/a.jpg");
    expect(form.get("file")).toBeInstanceOf(Blob);

    const seen: string[] = [];
    const api = createInviteApi("https://api.example.test", async (url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("upload-url")) return jsonResponse({ url: "https://s3/put", method: "PUT", headers: { "x-amz": "1" } });
      expect(init?.method).toBe("PUT");
      expect(new Headers(init?.headers).get("x-amz")).toBe("1");
      return new Response(null, { status: 200 });
    });
    const ticket = await api.requestUpload("tok", "left", "image/jpeg");
    await api.sendUpload(ticket, new Blob(["jpeg"]));
    expect(seen[0]).toContain("/invites/tok/upload-url");
    expect(seen[1]).toBe("PUT https://s3/put");
  });
});
