export interface Px {
  x: number;
  y: number;
  z: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Px, b: Px): Px {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 };
}

export function pointLineDistance(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

export function angleDeg(a: Px, b: Px, c: Px): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const d1 = Math.hypot(v1x, v1y) || 1;
  const d2 = Math.hypot(v2x, v2y) || 1;
  const cos = clamp((v1x * v2x + v1y * v2y) / (d1 * d2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

export function bboxOf(points: Px[], indices: number[], padX = 0.18, padY = 0.22): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const index of indices) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1 && height < 1) return null;
  const px = Math.max(width, 4) * padX;
  const py = Math.max(height, 4) * padY;
  return { x: minX - px, y: minY - py, w: width + px * 2, h: height + py * 2 };
}

export function outsideFraction(box: Rect, width: number, height: number): number {
  const insideW = Math.max(0, Math.min(width, box.x + box.w) - Math.max(0, box.x));
  const insideH = Math.max(0, Math.min(height, box.y + box.h) - Math.max(0, box.y));
  const area = box.w * box.h || 1;
  return 1 - (insideW * insideH) / area;
}

/** Translate to origin, scale to unit RMS, rotate so the first point sits above the middle point. */
export function normalizeContour(points: { x: number; y: number }[]): number[] {
  const count = points.length;
  if (count < 4) return [];
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  cx /= count;
  cy /= count;
  const shifted = points.map((point) => ({ x: point.x - cx, y: point.y - cy }));
  let energy = 0;
  for (const point of shifted) energy += point.x * point.x + point.y * point.y;
  const rms = Math.sqrt(energy / count) || 1;
  const top = shifted[0];
  const bottom = shifted[Math.floor(count / 2)];
  const angle = Math.atan2(top.x - bottom.x, -(top.y - bottom.y));
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const out: number[] = [];
  for (const point of shifted) {
    const x = point.x / rms;
    const y = point.y / rms;
    out.push(x * cos - y * sin, x * sin + y * cos);
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-8 || nb < 1e-8) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Relative-difference kernel. Identical vectors score 1. Scale-free. */
export function geometryScore(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const scale = Math.max(Math.abs(a[i]), Math.abs(b[i]), 0.05);
    const rel = (a[i] - b[i]) / scale;
    acc += rel * rel;
  }
  const rms = Math.sqrt(acc / a.length);
  return Math.exp(-(rms * rms) / (2 * 0.22 * 0.22));
}

/**
 * HOG cosine for different faces often sits high (faces look alike).
 * Stretch the band where real differences show up.
 */
export function appearanceScore(similarity: number): number {
  const low = 0.58;
  const high = 0.992;
  const t = clamp((similarity - low) / (high - low), 0, 1);
  return Math.pow(t, 0.9);
}
