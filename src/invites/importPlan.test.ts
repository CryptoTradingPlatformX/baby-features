import { describe, expect, it } from "vitest";
import type { Person } from "../types";
import { importPhotoUrls, inviteStatus, personForImport, rejectionNotes, suggestPerson, withImportedPhoto } from "./importPlan";

function member(id: string, name: string, relationship = name): Person {
  return { id, kind: "family", name, relationship, createdAt: 1, photos: {} };
}

describe("invite import mapping", () => {
  const people = [member("m", "Mom"), member("g", "Ruth", "Grandma (Mom's side)")];

  it("suggests the family member with the same name, then the same role", () => {
    expect(suggestPerson(people, { name: "Mom", role: "Aunt" })?.id).toBe("m");
    expect(suggestPerson(people, { name: "Nana", role: "Grandma (Mom's side)" })?.id).toBe("g");
    expect(suggestPerson(people, { name: "Uncle Joe", role: "Uncle" })).toBeNull();
  });

  it("creates a person or reuses the one the owner picked", () => {
    const created = personForImport(people, { name: "Joe", role: "Uncle" }, "create");
    expect(created.kind).toBe("family");
    expect(created.name).toBe("Joe");
    expect(created.relationship).toBe("Uncle");
    expect(created.photos).toEqual({});
    expect(personForImport(people, { name: "Mom", role: "Mom" }, "m").id).toBe("m");
    expect(() => personForImport(people, { name: "Mom", role: "Mom" }, "missing")).toThrow(/no longer on this phone/);
  });

  it("writes an imported photo into the matching slot", () => {
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const next = withImportedPhoto(people[0], "left", { blob, width: 40, height: 50, analysis: null });
    expect(next.photos.left?.angle).toBe("left");
    expect(next.photos.left?.blob).toBe(blob);
    expect(next.photos.front).toBeUndefined();
  });

  it("derives pending, partial, and submitted from the slots", () => {
    expect(inviteStatus({})).toBe("pending");
    expect(inviteStatus({ front: true })).toBe("partial");
    expect(inviteStatus({ front: true, left: true, right: true })).toBe("submitted");
    expect(inviteStatus({ front: true }, "submitted")).toBe("submitted");
    expect(inviteStatus({}, "expired")).toBe("expired");
  });

  it("imports from fresh presigned photo urls, not stored slot flags", () => {
    expect(importPhotoUrls({ slots: { front: true, left: true }, photos: { front: "https://files/front" } })).toEqual({
      front: "https://files/front",
    });
    expect(rejectionNotes(["front", { slot: "left", reason: "Not an image." }])).toEqual([
      { slot: "front", message: "front was removed. It was over 15 MB or was not an image. Please try another photo." },
      { slot: "left", message: "left: Not an image." },
    ]);
  });
});
