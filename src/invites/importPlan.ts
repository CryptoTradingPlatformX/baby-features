import type { Angle, Person, PhotoAnalysis } from "../types";
import { uid } from "../types";

export type InviteStatus = "pending" | "partial" | "submitted" | "expired";

/** A slot is filled when the server sends true or any non-empty string. Photo downloads use http(s) URLs. */
export type SlotValue = string | boolean | null;

export interface InviteSlots {
  front?: SlotValue;
  left?: SlotValue;
  right?: SlotValue;
}

const ANGLES: Angle[] = ["front", "left", "right"];

export function slotFilled(value: SlotValue | undefined): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.length > 0;
}

export function filledSlots(slots: InviteSlots | null | undefined): Angle[] {
  if (!slots) return [];
  return ANGLES.filter((angle) => slotFilled(slots[angle]));
}

export function inviteStatus(slots: InviteSlots | null | undefined, serverStatus?: string | null): InviteStatus {
  if (serverStatus === "pending" || serverStatus === "partial" || serverStatus === "submitted" || serverStatus === "expired") {
    return serverStatus;
  }
  const count = filledSlots(slots).length;
  if (count === 0) return "pending";
  if (count === 3) return "submitted";
  return "partial";
}

/** Presigned GET urls expire in about 15 minutes, so import must use a fresh list response. */
export function importPhotoUrls(invite: { slots?: InviteSlots | null; photos?: InviteSlots | null }): Partial<Record<Angle, string>> {
  const urls: Partial<Record<Angle, string>> = {};
  for (const angle of ANGLES) {
    const photo = invite.photos?.[angle];
    if (typeof photo === "string" && /^https?:/i.test(photo)) {
      urls[angle] = photo;
      continue;
    }
    const slot = invite.slots?.[angle];
    if (typeof slot === "string" && /^https?:/i.test(slot)) urls[angle] = slot;
  }
  return urls;
}

export function rejectionNotes(rejected: unknown): { slot: Angle | null; message: string }[] {
  if (!Array.isArray(rejected)) return [];
  return rejected.map((item) => {
    if (typeof item === "string") {
      return {
        slot: ANGLES.includes(item as Angle) ? (item as Angle) : null,
        message: `${item} was removed. It was over 15 MB or was not an image. Please try another photo.`,
      };
    }
    const record = item as { slot?: string; reason?: string };
    const slot = record.slot && ANGLES.includes(record.slot as Angle) ? (record.slot as Angle) : null;
    const why = record.reason?.trim() || "It was over 15 MB or was not an image.";
    return { slot, message: slot ? `${slot}: ${why}` : why };
  });
}

export function suggestPerson(people: Person[], invite: { name: string; role: string }): Person | null {
  const name = invite.name.trim().toLowerCase();
  const byName = people.filter((person) => person.kind === "family" && person.name.trim().toLowerCase() === name);
  if (byName.length === 1) return byName[0];
  const role = invite.role.trim().toLowerCase();
  const byRole = people.filter((person) => person.kind === "family" && person.relationship.trim().toLowerCase() === role);
  if (byRole.length === 1) return byRole[0];
  return null;
}

/** `create` makes a new family member. Any other value is an existing person id. */
export function personForImport(people: Person[], invite: { name: string; role: string }, choice: string): Person {
  if (choice !== "create") {
    const existing = people.find((person) => person.id === choice);
    if (!existing) throw new Error("That family member is no longer on this phone.");
    return existing;
  }
  return {
    id: uid(),
    kind: "family",
    name: invite.name.trim() || invite.role.trim() || "Family",
    relationship: invite.role.trim() || invite.name.trim() || "Family",
    createdAt: Date.now(),
    photos: {},
  };
}

export function withImportedPhoto(
  person: Person,
  angle: Angle,
  photo: { blob: Blob; width: number; height: number; analysis: PhotoAnalysis | null },
): Person {
  return {
    ...person,
    photos: {
      ...person.photos,
      [angle]: {
        angle,
        blob: photo.blob,
        width: photo.width,
        height: photo.height,
        createdAt: Date.now(),
        analysis: photo.analysis,
      },
    },
  };
}
