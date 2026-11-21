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
        return jsonResponse([
          {
            token: "tok",
            name: "Ruth",
            role: "Grandma",
            status: "partial",
            slots: { front: true },
            photos: { front: "https://files/front" },
            link: "https://site/#/upload/tok",
            createdAt: "2026-11-21T00:00:00.000Z",
            expiresAt: "2026-12-21T00:00:00.000Z",
          },
        ]);
      }
      if (init?.method === "DELETE") return jsonResponse({ deleted: true, token: "tok" });
      return jsonResponse({ message: "nope" }, 500);
    };
    const api = createInviteApi("https://api.example.test/", fetchImpl);
    const created = await api.createInvites({ ownerName: "Steven", babyName: "Ada", people: [{ name: "Ruth", role: "Grandma" }] });
    expect(created.ownerKey).toBe("owner-1");
    expect(created.invites[0].link).toContain("#/upload/tok");
    const list = await api.listOwnerInvites("owner-1");
    expect(list[0].photos?.front).toBe("https://files/front");
    expect(list[0].status).toBe("partial");
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

  it("PUTs the photo with exactly the signed Content-Type", async () => {
    const ticket = normalizeUploadTicket({
      url: "https://s3/put",
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      maxBytes: 15_000_000,
      expiresIn: 300,
    });
    expect(ticket).toMatchObject({ method: "PUT", maxBytes: 15_000_000, expiresIn: 300 });
    const putRequest = uploadRequest(ticket, new Blob(["a"], { type: "image/png" }));
    expect(putRequest.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(putRequest.body).toBeInstanceOf(Blob);
    expect(() => uploadRequest({ ...ticket, maxBytes: 10 }, new Blob([new Uint8Array(20)]))).toThrow(/too large/);

    const seen: { method: string; url: string; type: string | null }[] = [];
    const api = createInviteApi("https://api.example.test", async (url, init) => {
      seen.push({
        method: init?.method ?? "GET",
        url: String(url),
        type: new Headers(init?.headers).get("content-type"),
      });
      if (String(url).includes("upload-url")) {
        return jsonResponse({ url: "https://s3/put", method: "PUT", headers: { "Content-Type": "image/jpeg" }, maxBytes: 100, expiresIn: 60 });
      }
      expect(init?.headers).toEqual({ "Content-Type": "image/jpeg" });
      return new Response(null, { status: 200 });
    });
    const uploaded = await api.requestUpload("tok", "left", "image/jpeg");
    await api.sendUpload(uploaded, new Blob(["jpeg"], { type: "image/jpeg" }));
    expect(seen[1]).toEqual({ method: "PUT", url: "https://s3/put", type: "image/jpeg" });
  });

  it("treats an unknown owner key as unauthorized", async () => {
    const api = createInviteApi("https://api.example.test", async () => jsonResponse({ message: "Unknown owner" }, 401));
    await expect(api.createInvites({ ownerName: "Alex", people: [{ name: "Mom", role: "Mom" }] }, "stale")).rejects.toMatchObject({
      status: 401,
    });
  });
});
