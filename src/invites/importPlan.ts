import type { Angle, Person, PhotoAnalysis } from "../types";
import { uid } from "../types";

export type InviteStatus = "pending" | "partial" | "submitted";

export interface InviteSlots {
  front?: string | null;
  left?: string | null;
  right?: string | null;
}

const ANGLES: Angle[] = ["front", "left", "right"];

export function filledSlots(slots: InviteSlots | null | undefined): Angle[] {
  if (!slots) return [];
  return ANGLES.filter((angle) => Boolean(slots[angle]));
}

export function inviteStatus(slots: InviteSlots | null | undefined, serverStatus?: string | null): InviteStatus {
  if (serverStatus === "pending" || serverStatus === "partial" || serverStatus === "submitted") return serverStatus;
  const count = filledSlots(slots).length;
  if (count === 0) return "pending";
  if (count === 3) return "submitted";
  return "partial";
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
