import type { FeatureId } from "../types";
import { cosine } from "./math";

export type Signal = "shape" | "appearance" | "contour" | "ratio";

export type Driver = Signal | "only-one" | "none";

/** Typical size of each raw distance, so the weights below mean what they say. */
export const SIGNAL_SCALE: Record<Signal, number> = {
  shape: 0.14,
  appearance: 0.28,
  contour: 0.22,
  ratio: 0.45,
};

export interface DistanceParts {
  shape: number | null;
  appearance: number | null;
  contour: number | null;
  ratio: number | null;
  combined: number;
}

const SIGNALS: Signal[] = ["shape", "appearance", "contour", "ratio"];

export function weightsFor(id: FeatureId): Record<Signal, number> {
  if (id === "leftEar" || id === "rightEar") {
    return { shape: 0.22, appearance: 0.43, contour: 0.25, ratio: 0.1 };
  }
  if (id === "noseProfile" || id === "chinProfile") {
    return { shape: 0.58, appearance: 0.27, contour: 0, ratio: 0.15 };
  }
  return { shape: 0.62, appearance: 0.23, contour: 0, ratio: 0.15 };
}

/** 2D Procrustes distance: translation, scale, and rotation removed. 0 means the same shape. */
export function procrustesDistance(a: number[], b: number[]): number | null {
  if (a.length < 4 || a.length !== b.length || a.length % 2 !== 0) return null;
  const left = centerAndScale(a);
  const right = centerAndScale(b);
  if (!left || !right) return null;
  const count = a.length / 2;
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < count; i++) {
    const ax = left[i * 2];
    const ay = left[i * 2 + 1];
    const bx = right[i * 2];
    const by = right[i * 2 + 1];
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
  }
  const theta = Math.atan2(cross, dot);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let error = 0;
  for (let i = 0; i < count; i++) {
    const ax = left[i * 2];
    const ay = left[i * 2 + 1];
    const rx = ax * cos - ay * sin;
    const ry = ax * sin + ay * cos;
    const dx = rx - right[i * 2];
    const dy = ry - right[i * 2 + 1];
    error += dx * dx + dy * dy;
  }
  return Math.sqrt(error / count);
}

export function ratioDistance(a: number[], b: number[]): number | null {
  if (!a.length || a.length !== b.length) return null;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const scale = Math.max(Math.abs(a[i]), Math.abs(b[i]), 0.05);
    const rel = (a[i] - b[i]) / scale;
    acc += rel * rel;
  }
  return Math.sqrt(acc / a.length);
}

/** 0 is an identical embedding. */
export function embeddingDistance(a: number[], b: number[]): number | null {
  if (a.length < 8 || b.length < 8) return null;
  return 1 - cosine(a, b);
}

export function featureDistances(
  id: FeatureId,
  baby: { shape: number[]; appearance: number[]; contour: number[]; geometry: number[] },
  other: { shape: number[]; appearance: number[]; contour: number[]; geometry: number[] },
): DistanceParts | null {
  const shape = procrustesDistance(baby.shape, other.shape);
  const appearance = embeddingDistance(baby.appearance, other.appearance);
  const contour = embeddingDistance(baby.contour, other.contour);
  const ratio = ratioDistance(baby.geometry, other.geometry);
  if (shape == null && appearance == null && contour == null && ratio == null) return null;
  return {
    shape,
    appearance,
    contour,
    ratio,
    combined: combine(id, { shape, appearance, contour, ratio }),
  };
}

export function combine(id: FeatureId, parts: Omit<DistanceParts, "combined">): number {
  const weights = weightsFor(id);
  let num = 0;
  let den = 0;
  for (const signal of SIGNALS) {
    const value = parts[signal];
    const weight = weights[signal];
    if (value == null || weight <= 0) continue;
    num += weight * (value / SIGNAL_SCALE[signal]);
    den += weight;
  }
  return den ? num / den : Number.POSITIVE_INFINITY;
}

export interface ShareDecision {
  shares: (number | null)[];
  tooClose: boolean;
  driver: Driver;
  yardstick: number | null;
}

/**
 * Turn distances into shares of 1. Temperature uses the adult-to-adult
 * distance as the yardstick for a meaningful gap. One relative has no share.
 */
export function decideShares(id: FeatureId, distances: DistanceParts[], adultDistances: number[] = []): ShareDecision {
  if (distances.length === 0) return { shares: [], tooClose: false, driver: "none", yardstick: null };
  if (distances.length === 1) return { shares: [null], tooClose: false, driver: "only-one", yardstick: null };

  const yardstick = median(adultDistances.filter((value) => Number.isFinite(value))) ?? spread(distances);
  const temperature = Math.max(0.32, (yardstick ?? 0.8) * 0.5);
  const noise = Math.max(0.1, (yardstick ?? 0.8) * 0.22);
  const shares = softmax(distances.map((row) => row.combined), temperature);
  const order = shares.map((share, index) => ({ share, index })).sort((a, b) => b.share - a.share);
  const gap = distances[order[1].index].combined - distances[order[0].index].combined;
  const tooClose = gap < noise;
  const driver = tooClose ? "none" : signalDriver(id, distances[order[0].index], distances[order[1].index]);
  return { shares, tooClose, driver, yardstick };
}

export function signalDriver(id: FeatureId, closer: DistanceParts, farther: DistanceParts): Signal {
  const weights = weightsFor(id);
  let best: Signal = "shape";
  let bestGap = -Infinity;
  for (const signal of SIGNALS) {
    const weight = weights[signal];
    if (weight <= 0 || closer[signal] == null || farther[signal] == null) continue;
    const gap = weight * ((farther[signal] - closer[signal]) / SIGNAL_SCALE[signal]);
    if (gap > bestGap) {
      bestGap = gap;
      best = signal;
    }
  }
  return best;
}

export function shareSentence(
  label: string,
  ranked: { name: string; share: number | null }[],
  tooClose: boolean,
): string {
  if (!ranked.length) return `${label}: not enough photos`;
  if (ranked.length === 1 || ranked.every((row) => row.share == null)) {
    return `${label}: only ${ranked[0].name} to compare`;
  }
  const parts = ranked.map((row) => `${row.name} ${Math.round((row.share ?? 0) * 100)}%`).join(", ");
  if (tooClose) return `${label}: too close to call — ${parts}`;
  return `${label}: ${parts}`;
}

export function softmax(distances: number[], temperature: number): number[] {
  const temp = Math.max(temperature, 1e-4);
  const shift = Math.min(...distances);
  const weights = distances.map((distance) => Math.exp(-(distance - shift) / temp));
  const sum = weights.reduce((total, weight) => total + weight, 0) || 1;
  return weights.map((weight) => weight / sum);
}

/**
 * Undo the head-pose rotation so a turned face is closer to a frontal point cloud.
 * The matrix is MediaPipe's column-major facial transform. Pairwise Procrustes
 * still removes whatever rotation is left.
 */
export function undoHeadPose(
  landmarks: { x: number; y: number; z: number }[],
  matrix: number[] | null,
): { x: number; y: number }[] {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const point of landmarks) {
    cx += point.x;
    cy += point.y;
    cz += point.z;
  }
  const count = landmarks.length || 1;
  cx /= count;
  cy /= count;
  cz /= count;
  const usable =
    matrix != null &&
    matrix.length >= 11 &&
    Math.hypot(matrix[0], matrix[1], matrix[2]) > 0.2;
  return landmarks.map((point) => {
    const x = point.x - cx;
    const y = point.y - cy;
    const z = point.z - cz;
    if (!usable || !matrix) return { x, y };
    return {
      x: matrix[0] * x + matrix[1] * y + matrix[2] * z,
      y: matrix[4] * x + matrix[5] * y + matrix[6] * z,
    };
  });
}

export function flattenShape(points: { x: number; y: number }[], indices: number[]): number[] {
  const coords: number[] = [];
  for (const index of indices) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    coords.push(point.x, point.y);
  }
  return coords;
}

function centerAndScale(values: number[]): Float64Array | null {
  const count = values.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < count; i++) {
    cx += values[i * 2];
    cy += values[i * 2 + 1];
  }
  cx /= count;
  cy /= count;
  const out = new Float64Array(values.length);
  let energy = 0;
  for (let i = 0; i < count; i++) {
    const x = values[i * 2] - cx;
    const y = values[i * 2 + 1] - cy;
    out[i * 2] = x;
    out[i * 2 + 1] = y;
    energy += x * x + y * y;
  }
  const rms = Math.sqrt(energy / count);
  if (rms < 1e-8) return null;
  for (let i = 0; i < out.length; i++) out[i] /= rms;
  return out;
}

function spread(rows: DistanceParts[]): number | null {
  if (rows.length < 2) return null;
  const values = rows.map((row) => row.combined);
  return Math.max(...values) - Math.min(...values);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function driverLabel(driver: Driver): string {
  if (driver === "shape") return "landmark shape";
  if (driver === "appearance") return "photo embedding";
  if (driver === "contour") return "ear outline";
  if (driver === "ratio") return "proportions";
  if (driver === "only-one") return "only one relative";
  return "too close to call";
}
