import { describe, expect, it } from "vitest";
import { appearanceScore, cosine, geometryScore, normalizeContour } from "./math";
import { classifyPose, poseIssues, turnAmount } from "./pose";
import { estimateEarBox, refineEarRoi } from "./ears";
import { fourierMagnitudes, hogDescriptor } from "./descriptors";
import { compareFamily } from "./compare";
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
  it("splits a feature across relatives and skips a missing angle", () => {
    const eye = [0, 0, 1, 0, 1, 0.35, 0.5, 0.5, 0, 0.35];
    const baby = person("baby", "Baby", {
      front: feature("eyes", eye, [0.3, 0.2], unit([1, 0, 0, 1])),
      left: feature("leftEar", [0, 0, 0.2, 1, 0.5, 1.2, 0.4, 0.2], [1.5], unit([0, 1, 0]), [0.2, 0.4, 0.1]),
    });
    const mom = person("mom", "Mom", {
      front: feature("eyes", eye.map((value, index) => value + (index % 2 === 0 ? 0.01 : 0)), [0.31, 0.21], unit([1, 0.05, 0, 1])),
    });
    const grandpa = person("grandpa", "Grandpa", {
      front: feature("eyes", [0, 0, 1, 0, 1, 1.3, 0.5, 1.5, 0, 1.2], [0.9, -0.4], unit([0, 1, 0, 0])),
      left: feature("leftEar", [0, 0, 0.2, 1.05, 0.55, 1.15, 0.42, 0.18], [1.55], unit([0, 0.95, 0.1]), [0.22, 0.38, 0.12]),
    });
    const result = compareFamily(baby, [mom, grandpa]);
    const eyes = result.features.find((item) => item.id === "eyes");
    const ear = result.features.find((item) => item.id === "leftEar");
    expect(eyes?.ranked[0].name).toBe("Mom");
    expect((eyes?.ranked[0].share ?? 0) > (eyes?.ranked[1].share ?? 0)).toBe(true);
    expect(eyes?.sentence.startsWith("Eyes: Mom")).toBe(true);
    expect(eyes?.unavailable).toEqual([]);
    expect(ear?.ranked.map((row) => row.name)).toEqual(["Grandpa"]);
    expect(ear?.sentence).toBe("Left ear: only Grandpa to compare");
    expect(ear?.unavailable[0]).toEqual({ name: "Mom", reason: "Not enough photos" });
    expect(result.headline).toContain("Baby");
    expect(result.overall.reduce((sum, row) => sum + row.score, 0)).toBeCloseTo(1, 5);
  });

  it("drops a feature that is too uncertain to score", () => {
    const shape = [0, 0, 1, 0, 1, 0.4, 0, 0.4];
    const baby = person("baby", "Baby", { front: feature("nose", shape, [0.2], unit([1, 0])) });
    const shaky = person("mom", "Mom", { front: feature("nose", shape, [0.2], unit([1, 0])) });
    const photo = shaky.photos.front?.analysis?.features[0];
    if (photo) photo.confidence = 0.2;
    const result = compareFamily(baby, [shaky]);
    const nose = result.features.find((item) => item.id === "nose");
    expect(nose?.ranked).toEqual([]);
    expect(nose?.unavailable[0].reason).toBe("Not clear enough in the photo");
  });
});

function unit(values: number[]): number[] {
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return values.map((value) => value / norm);
}

function feature(
  id: AnalyzedFeature["id"],
  shape: number[],
  geometry: number[],
  appearance: number[],
  contour: number[] = [],
): AnalyzedFeature {
  return {
    id,
    friendly: id,
    detail: "",
    confidence: 0.9,
    shape,
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
