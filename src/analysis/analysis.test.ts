import { describe, expect, it } from "vitest";
import { appearanceScore, cosine, geometryScore, normalizeContour } from "./math";
import { classifyPose, poseIssues, turnAmount } from "./pose";
import { estimateEarBox, refineEarRoi } from "./ears";
import { fourierMagnitudes, hogDescriptor } from "./descriptors";
import { compareFamily, featureScore, rankingSentence } from "./compare";
import type { AnalyzedFeature, Person } from "../types";
import { ANALYSIS_VERSION } from "../types";
import type { Px } from "./math";

describe("similarity math", () => {
  it("scores identical geometry as a perfect match", () => {
    expect(geometryScore([0.2, 0.8, -0.1], [0.2, 0.8, -0.1])).toBeGreaterThan(0.99);
  });

  it("scores a very different shape lower", () => {
    const same = geometryScore([0.8, 0.3], [0.8, 0.3]);
    const different = geometryScore([0.8, 0.3], [0.2, 1.4]);
    expect(different).toBeLessThan(same);
    expect(different).toBeLessThan(0.5);
  });

  it("treats a rotated contour as the same face shape", () => {
    const oval = Array.from({ length: 36 }, (_, i) => {
      const t = (i / 36) * Math.PI * 2;
      return { x: Math.cos(t) * 40, y: Math.sin(t) * 55 };
    });
    const rotated = oval.map((point) => ({
      x: point.x * Math.cos(0.7) - point.y * Math.sin(0.7),
      y: point.x * Math.sin(0.7) + point.y * Math.cos(0.7),
    }));
    const score = geometryScore(normalizeContour(oval), normalizeContour(rotated));
    expect(score).toBeGreaterThan(0.95);
  });

  it("maps a perfect appearance cosine to 1 and a weak one near 0", () => {
    expect(appearanceScore(1)).toBe(1);
    expect(appearanceScore(0.58)).toBe(0);
    expect(appearanceScore(cosine([1, 2, 3], [1, 2, 3]))).toBe(1);
  });
});

describe("descriptors", () => {
  it("matches HOG of the same image", () => {
    const gray = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) gray[y * 64 + x] = ((x * 3 + y * 5) % 17) / 17;
    }
    const a = hogDescriptor(gray, 64, 64);
    const b = hogDescriptor(gray, 64, 64);
    expect(a.length).toBeGreaterThan(100);
    expect(cosine(a, b)).toBeGreaterThan(0.999);
  });

  it("separates a circle contour from a tall rectangle", () => {
    const circle = Array.from({ length: 40 }, (_, i) => {
      const t = (i / 40) * Math.PI * 2;
      return { x: Math.cos(t), y: Math.sin(t) };
    });
    const rect = [
      { x: -0.4, y: -1 },
      { x: 0.4, y: -1 },
      { x: 0.4, y: 1 },
      { x: -0.4, y: 1 },
    ];
    const a = fourierMagnitudes(circle);
    const b = fourierMagnitudes(rect);
    expect(a.length).toBeGreaterThan(4);
    expect(cosine(a, b)).toBeLessThan(0.995);
  });
});

describe("pose", () => {
  it("calls a wide, even face straight-on", () => {
    const pose = classifyPose({ eyeRatio: 0.96, widerSide: "left", widthRatio: 0.8, rollDeg: 2 });
    expect(pose.kind).toBe("front");
    expect(turnAmount({ eyeRatio: 0.96, widerSide: "left", widthRatio: 0.8, rollDeg: 2 })).toBeLessThan(0.34);
  });

  it("calls a foreshortened face a side view and names the closer side", () => {
    const left = classifyPose({ eyeRatio: 0.32, widerSide: "left", widthRatio: 0.48, rollDeg: 4 });
    const right = classifyPose({ eyeRatio: 0.32, widerSide: "right", widthRatio: 0.48, rollDeg: 0 });
    expect(left.kind).toBe("left");
    expect(right.kind).toBe("right");
  });

  it("asks for a retake when a front slot gets a profile", () => {
    const pose = classifyPose({ eyeRatio: 0.3, widerSide: "left", widthRatio: 0.46, rollDeg: 0 });
    const issues = poseIssues("front", pose);
    expect(issues.some((issue) => issue.severity === "error" && issue.code === "not-front")).toBe(true);
  });

  it("names the other ear when the sides are swapped", () => {
    const pose = classifyPose({ eyeRatio: 0.3, widerSide: "right", widthRatio: 0.46, rollDeg: 0 });
    const issues = poseIssues("left", pose);
    expect(issues.some((issue) => issue.code === "wrong-side")).toBe(true);
    expect(issues[0].message).toContain("right");
  });
});

describe("ears", () => {
  it("places the ear box behind the visible tragion", () => {
    const points: Px[] = Array.from({ length: 478 }, () => ({ x: 180, y: 200, z: 0 }));
    points[1] = { x: 120, y: 200, z: 0 };
    points[2] = { x: 110, y: 230, z: 0 };
    points[10] = { x: 170, y: 80, z: 0 };
    points[152] = { x: 170, y: 330, z: 0 };
    points[285] = { x: 190, y: 110, z: 0 };
    points[55] = { x: 150, y: 120, z: 0 };
    points[454] = { x: 260, y: 190, z: -0.25 };
    points[234] = { x: 160, y: 200, z: 0.3 };
    const ear = estimateEarBox(points);
    expect(ear).not.toBeNull();
    expect(ear?.side).toBe("left");
    expect(ear && ear.box.x + ear.box.w / 2).toBeGreaterThan(260);
    expect(ear?.agreement).toBe(true);
  });

  it("tightens onto a skin-colored ear sitting toward the back of the crop", () => {
    const width = 80;
    const height = 100;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        const inEar = (x - 58) ** 2 / 18 ** 2 + (y - 48) ** 2 / 30 ** 2 <= 1;
        rgba[p] = inEar ? 214 : 236;
        rgba[p + 1] = inEar ? 150 : 236;
        rgba[p + 2] = inEar ? 128 : 240;
        rgba[p + 3] = 255;
      }
    }
    const refined = refineEarRoi(rgba, width, height);
    expect(refined.usedSkin).toBe(true);
    expect(refined.box).not.toBeNull();
    expect(refined.box && refined.box.x).toBeGreaterThan(25);
    expect(refined.contour.length).toBeGreaterThan(8);
  });
});

describe("comparison", () => {
  it("writes the ranked sentence the parents read", () => {
    expect(
      rankingSentence("Ears", [
        { name: "Grandpa", score: 0.824 },
        { name: "Dad", score: 0.714 },
      ]),
    ).toBe("Ears: most like Grandpa (82%), then Dad (71%)");
  });

  it("marks a missing angle as not enough photos and ranks the rest", () => {
    const baby = person("baby", "Baby", {
      front: feature("eyes", [0.4, 2, 0.4, 0.2], [1, 0, 0, 1]),
      left: feature("leftEar", [1.5, 1.6], [0, 1, 0, 1], [0.2, 0.1, 0.05]),
    });
    const mom = person("mom", "Mom", {
      front: feature("eyes", [0.41, 3, 0.41, 0.21], [1, 0.1, 0, 1]),
    });
    const grandpa = person("grandpa", "Grandpa", {
      front: feature("eyes", [0.7, -8, 0.3, 0.15], [0, 1, 0, 0]),
      left: feature("leftEar", [1.52, 1.58], [0, 0.9, 0.1, 1], [0.2, 0.11, 0.04]),
    });
    const result = compareFamily(baby, [mom, grandpa]);
    const eyes = result.features.find((feature) => feature.id === "eyes");
    const ear = result.features.find((feature) => feature.id === "leftEar");
    expect(eyes?.ranked[0].name).toBe("Mom");
    expect(eyes?.unavailable.some((row) => row.name === "Grandpa")).toBe(false);
    expect(ear?.ranked.map((row) => row.name)).toEqual(["Grandpa"]);
    expect(ear?.unavailable[0]).toEqual({ name: "Mom", reason: "Not enough photos" });
    expect(ear?.sentence.startsWith("Left ear: most like Grandpa")).toBe(true);
    expect(result.headline).toContain("Baby");
  });

  it("returns null when a feature is too uncertain to score", () => {
    const clear = feature("nose", [0.2, 0.3, 0.4], [1, 0, 0]);
    const shaky = feature("nose", [0.2, 0.3, 0.4], [1, 0, 0]);
    shaky.confidence = 0.2;
    expect(featureScore(clear, shaky)).toBeNull();
  });
});

function feature(id: AnalyzedFeature["id"], geometry: number[], appearance: number[], contour: number[] = []): AnalyzedFeature {
  return {
    id,
    friendly: id,
    detail: "",
    confidence: 0.9,
    geometry,
    appearance,
    contour,
    cropBlob: new Blob(["x"], { type: "image/jpeg" }),
    cropWidth: 8,
    cropHeight: 8,
  };
}

function person(id: string, name: string, slots: { front?: AnalyzedFeature; left?: AnalyzedFeature }): Person {
  const photos: Person["photos"] = {};
  for (const angle of ["front", "left"] as const) {
    const found = slots[angle];
    if (!found) continue;
    photos[angle] = {
      angle,
      blob: new Blob(["p"], { type: "image/jpeg" }),
      width: 20,
      height: 20,
      createdAt: 1,
      analysis: {
        version: ANALYSIS_VERSION,
        pose: {
          kind: angle === "front" ? "front" : "left",
          widerSide: "left",
          turned: angle === "front" ? 0.1 : 0.8,
          rollDeg: 0,
          eyeRatio: 0.9,
          widthRatio: 0.7,
        },
        issues: [],
        features: [found],
        sharpness: 100,
        brightness: 0.5,
      },
    };
  }
  return {
    id,
    kind: id === "baby" ? "baby" : "family",
    name,
    relationship: name,
    createdAt: 1,
    photos,
  };
}
