import { SCHEMA_VERSION, type Angle, type Person, type StoredPhoto } from "./types";

export interface BackupPhoto {
  angle: Angle;
  width: number;
  height: number;
  createdAt: number;
  jpegBase64: string;
}

export interface BackupPerson {
  id: string;
  kind: "baby" | "family";
  name: string;
  relationship: string;
  createdAt: number;
  photos: Partial<Record<Angle, BackupPhoto>>;
}

export interface BackupFile {
  app: "baby-features";
  schemaVersion: number;
  exportedAt: string;
  people: BackupPerson[];
}

const ANGLES: Angle[] = ["front", "left", "right"];

export async function peopleToBackup(people: Person[]): Promise<BackupFile> {
  return {
    app: "baby-features",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    people: await Promise.all(people.map(backupPerson)),
  };
}

export async function peopleFromBackup(raw: string): Promise<Person[]> {
  const parsed = JSON.parse(raw) as Partial<BackupFile>;
  if (parsed.app !== "baby-features" || !Array.isArray(parsed.people)) {
    throw new Error("That file is not a Baby Features backup.");
  }
  return Promise.all(parsed.people.map(restorePerson));
}

async function backupPerson(person: Person): Promise<BackupPerson> {
  const photos: BackupPerson["photos"] = {};
  for (const angle of ANGLES) {
    const photo = person.photos[angle];
    if (!photo?.blob) continue;
    photos[angle] = {
      angle,
      width: photo.width,
      height: photo.height,
      createdAt: photo.createdAt,
      jpegBase64: await blobToBase64(photo.blob),
    };
  }
  return {
    id: person.id,
    kind: person.kind,
    name: person.name,
    relationship: person.relationship,
    createdAt: person.createdAt,
    photos,
  };
}

async function restorePerson(input: BackupPerson): Promise<Person> {
  if (!input || (input.kind !== "baby" && input.kind !== "family") || typeof input.name !== "string") {
    throw new Error("The backup is missing a person.");
  }
  const photos: Person["photos"] = {};
  for (const angle of ANGLES) {
    const photo = input.photos?.[angle];
    if (!photo?.jpegBase64) continue;
    photos[angle] = await restorePhoto(angle, photo);
  }
  return {
    id: typeof input.id === "string" && input.id ? input.id : crypto.randomUUID(),
    kind: input.kind,
    name: input.name,
    relationship: typeof input.relationship === "string" ? input.relationship : input.name,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : Date.now(),
    schemaVersion: 1,
    photos,
  };
}

async function restorePhoto(angle: Angle, photo: BackupPhoto): Promise<StoredPhoto> {
  const blob = base64ToBlob(photo.jpegBase64);
  return {
    angle,
    blob,
    width: photo.width || 0,
    height: photo.height || 0,
    createdAt: photo.createdAt || Date.now(),
    analysis: null,
  };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

export function base64ToBlob(value: string): Blob {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}
