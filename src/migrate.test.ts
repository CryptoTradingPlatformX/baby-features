import { describe, expect, it } from "vitest";
import { analysisIsStale, countPhotosToRebuild, photosToRebuild } from "./migrate";
import { ANALYSIS_VERSION, SCHEMA_VERSION, type Person, type PhotoAnalysis } from "./types";
import { base64ToBlob, blobToBase64, peopleFromBackup, peopleToBackup } from "./backup";

describe("saved analysis migration", () => {
  it("treats a v1 analysis as stale and a current one as ready", () => {
    expect(analysisIsStale(null)).toBe(true);
    expect(analysisIsStale(analysis(1, false))).toBe(true);
    expect(analysisIsStale(analysis(ANALYSIS_VERSION, false))).toBe(true);
    expect(analysisIsStale(analysis(ANALYSIS_VERSION, true))).toBe(false);
  });

  it("rebuilds every saved photo when forced, and only stale ones otherwise", () => {
    const person = familyMember();
    expect(photosToRebuild(person, false)).toEqual(["front"]);
    expect(photosToRebuild(person, true)).toEqual(["front", "left"]);
    expect(countPhotosToRebuild([person], false)).toBe(1);
  });

  it("round-trips people and photo bytes without the measurements", async () => {
    const jpeg = new Blob([Uint8Array.from([1, 2, 3, 4, 255])], { type: "image/jpeg" });
    const person: Person = {
      ...familyMember(),
      photos: {
        front: {
          angle: "front",
          blob: jpeg,
          width: 4,
          height: 2,
          createdAt: 5,
          analysis: analysis(ANALYSIS_VERSION, true),
        },
      },
    };
    const backup = await peopleToBackup([person]);
    expect(backup.app).toBe("baby-features");
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    const restored = await peopleFromBackup(JSON.stringify(backup));
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe(person.name);
    expect(restored[0].schemaVersion).toBe(1);
    expect(restored[0].photos.front?.analysis).toBeNull();
    const bytes = new Uint8Array(await restored[0].photos.front!.blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 255]);
    expect(await blobToBase64(base64ToBlob(await blobToBase64(jpeg)))).toBe(await blobToBase64(jpeg));
  });
});

function analysis(version: number, withShape: boolean): PhotoAnalysis {
  return {
    version,
    pose: { kind: "front", widerSide: "left", turned: 0, rollDeg: 0, eyeRatio: 1, widthRatio: 0.8 },
    issues: [],
    features: [
      {
        id: "eyes",
        friendly: "Eyes",
        detail: "",
        confidence: 0.9,
        shape: withShape ? [0, 0, 1, 0] : undefined as unknown as number[],
        geometry: [0.3],
        appearance: [1, 0],
        contour: [],
        cropBlob: new Blob(),
        cropWidth: 1,
        cropHeight: 1,
      },
    ],
    sharpness: 1,
    brightness: 0.5,
  };
}

function familyMember(): Person {
  return {
    id: "mom",
    kind: "family",
    name: "Mom",
    relationship: "Mom",
    createdAt: 1,
    schemaVersion: 1,
    photos: {
      front: {
        angle: "front",
        blob: new Blob(["a"]),
        width: 1,
        height: 1,
        createdAt: 1,
        analysis: analysis(1, false),
      },
      left: {
        angle: "left",
        blob: new Blob(["b"]),
        width: 1,
        height: 1,
        createdAt: 1,
        analysis: analysis(ANALYSIS_VERSION, true),
      },
    },
  };
}
