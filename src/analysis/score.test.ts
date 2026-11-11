import { describe, expect, it } from "vitest";
import { decideShares, featureDistances, procrustesDistance, shareSentence, softmax } from "./score";
import type { AnalyzedFeature } from "../types";

describe("procrustes shape distance", () => {
  it("is zero for the same points", () => {
    const shape = [0, 0, 2, 0, 2, 1, 0, 1];
    expect(procrustesDistance(shape, shape)).toBeCloseTo(0, 6);
  });

  it("ignores translation, scale, and rotation", () => {
    const shape = [0, 0, 2, 0.2, 1.6, 1.4, -0.2, 1];
    const transformed: number[] = [];
    for (let i = 0; i < shape.length; i += 2) {
      const x = shape[i];
      const y = shape[i + 1];
      const rx = x * Math.cos(0.8) - y * Math.sin(0.8);
      const ry = x * Math.sin(0.8) + y * Math.cos(0.8);
      transformed.push(rx * 3 + 10, ry * 3 - 4);
    }
    expect(procrustesDistance(shape, transformed)).toBeLessThan(1e-6);
  });

  it("is larger for a different shape than for a near copy", () => {
    const eye = [0, 0, 1, 0, 1, 0.3, 0, 0.3];
    const close = [0, 0, 1.02, 0.01, 1.01, 0.32, 0.01, 0.29];
    const other = [0, 0, 1, 0, 1, 1.4, 0, 1.4];
    const near = procrustesDistance(eye, close) ?? 1;
    const far = procrustesDistance(eye, other) ?? 0;
    expect(far).toBeGreaterThan(near * 3);
  });
});

describe("relative shares", () => {
  it("gives one relative no fake split", () => {
    const decision = decideShares("eyes", [parts(0.2)], []);
    expect(decision.shares).toEqual([null]);
    expect(decision.driver).toBe("only-one");
    expect(shareSentence("Eyes", [{ name: "Mom", share: null }], false)).toBe("Eyes: only Mom to compare");
  });

  it("splits two relatives from distances and flags a tiny gap", () => {
    const close = decideShares("eyes", [parts(0.4), parts(0.43)], [0.9]);
    expect(close.tooClose).toBe(true);
    expect(close.shares[0]! + close.shares[1]!).toBeCloseTo(1, 5);
    expect(shareSentence("Eyes", [{ name: "Mom", share: close.shares[0] }, { name: "Dad", share: close.shares[1] }], true)).toContain(
      "too close to call",
    );

    const separated = decideShares("eyes", [parts(0.05), parts(0.9)], [1.1]);
    expect(separated.tooClose).toBe(false);
    expect(separated.shares[0]!).toBeGreaterThan(0.7);
    expect(separated.shares[1]!).toBeLessThan(0.3);
    expect(softmax([0.05, 0.9], 0.4).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
  });

  it("names the signal that actually separated the pair", () => {
    const sameLook = [1, 0, 0, 0, 0, 0, 0, 0];
    const otherLook = [0, 1, 0, 0, 0, 0, 0, 0];
    const baby = sample({ shape: [0, 0, 1, 0, 1, 0.3, 0, 0.3], appearance: sameLook });
    const byShape = sample({ shape: [0, 0, 1, 0, 1,2, 0, 1.2], appearance: sameLook });
    const byLook = sample({ shape: [0, 0, 1, 0, 1, 0.3, 0, 0.3], appearance: otherLook });
    const shapeGap = featureDistances("eyes", baby, byShape);
    const lookGap = featureDistances("eyes", baby, byLook);
    const decision = decideShares("eyes", [shapeGap!, lookGap!], [1.2]);
    expect(decision.driver === "shape" || decision.driver === "appearance").toBe(true);
    expect(shapeGap!.shape!).toBeGreaterThan(lookGap!.shape!);
    expect(lookGap!.appearance!).toBeGreaterThan(shapeGap!.appearance!);
  });
});

function parts(combined: number) {
  return { shape: combined, appearance: null, contour: null, ratio: null, combined };
}

function sample(input: { shape: number[]; appearance: number[] }): AnalyzedFeature {
  return {
    id: "eyes",
    friendly: "eyes",
    detail: "",
    confidence: 0.9,
    shape: input.shape,
    geometry: [0.3, 0],
    appearance: input.appearance,
    contour: [],
    cropBlob: new Blob(),
    cropWidth: 1,
    cropHeight: 1,
  };
}
