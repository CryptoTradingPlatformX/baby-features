import { traceContour } from "./descriptors";
import { clamp, dist, type Px, type Rect } from "./math";
import { FOREHEAD_TOP, LEFT_EDGE, NOSE_BOTTOM, NOSE_TIP, RIGHT_EDGE, CHIN } from "./landmarks";

export type EarSide = "left" | "right";

/**
 * Place an ear box from the visible tragion.
 * MediaPipe's face mesh stops at the ear canal, so the pinna is estimated
 * just behind that point, with a length close to the brow-to-nose span.
 * The box is axis-aligned; callers should upright the head first.
 */
export function estimateEarBox(points: Px[]): { side: EarSide; box: Rect; agreement: boolean } | null {
  const nose = points[NOSE_TIP];
  const forehead = points[FOREHEAD_TOP];
  const chin = points[CHIN];
  const left = points[LEFT_EDGE];
  const right = points[RIGHT_EDGE];
  if (!nose || !forehead || !chin || !left || !right) return null;

  const faceH = dist(forehead, chin);
  if (faceH < 12) return null;

  const distSide: EarSide = dist(nose, left) >= dist(nose, right) ? "left" : "right";
  const zSide: EarSide = left.z <= right.z ? "left" : "right";
  const side = distSide;
  const tragion = side === "left" ? left : right;
  const browIndex = side === "left" ? 285 : 55;
  const brow = points[browIndex] ?? forehead;
  const noseBottom = points[NOSE_BOTTOM] ?? nose;

  let backX = tragion.x - nose.x;
  let backY = tragion.y - nose.y;
  const backLen = Math.hypot(backX, backY) || 1;
  backX /= backLen;
  backY /= backLen;

  const anthrop = dist(brow, noseBottom);
  const earH = Math.max(faceH * 0.36, anthrop * 1.12);
  const earW = earH * 0.72;
  const midY = brow.y * 0.42 + noseBottom.y * 0.58;
  const cx = tragion.x + backX * earW * 0.42;
  const cy = tragion.y * 0.5 + midY * 0.5;
  const padX = earW * 0.78;
  const padY = earH * 0.68;

  return {
    side,
    agreement: distSide === zSide,
    box: { x: cx - padX, y: cy - padY, w: padX * 2, h: padY * 2 },
  };
}

export interface EarRefinement {
  box: Rect | null;
  contour: { x: number; y: number }[];
  edgeMean: number;
  skinFraction: number;
  usedSkin: boolean;
}

/**
 * Tighten a canonical ear crop (posterior is toward +x) using skin color,
 * falling back to strong edges when the photo is grayscale or very dark.
 */
export function refineEarRoi(rgba: Uint8ClampedArray, width: number, height: number): EarRefinement {
  const count = width * height;
  const skin = new Uint8Array(count);
  const gray = new Float32Array(count);
  let skinCount = 0;
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    if (isSkin(r, g, b)) {
      skin[i] = 1;
      skinCount++;
    }
  }
  const skinFraction = skinCount / (count || 1);
  const edges = sobel(gray, width, height);

  const usedSkin = skinFraction > 0.04;
  const mask = usedSkin ? skin : thresholdEdges(edges, width, height);

  const component = largestPosteriorComponent(mask, width, height);
  let box: Rect | null = null;
  let contour: { x: number; y: number }[] = [];
  if (component.area > count * 0.04 && component.area < count * 0.82 && component.box) {
    box = expand(component.box, 0.14, width, height);
    contour = traceContour(component.mask, width, height);
  }

  let edgeSum = 0;
  let edgeN = 0;
  const sample = component.area > 20 ? component.mask : mask;
  for (let i = 0; i < count; i++) {
    if (!sample[i]) continue;
    edgeSum += edges[i];
    edgeN++;
  }
  return {
    box,
    contour,
    edgeMean: edgeN ? edgeSum / edgeN : 0,
    skinFraction,
    usedSkin,
  };
}

export function earConfidence(refined: boolean, edgeMean: number, clipped: boolean, agreement: boolean): number {
  let score = refined ? 0.8 : 0.5;
  if (edgeMean < 6) score -= 0.28;
  else if (edgeMean < 12) score -= 0.1;
  if (clipped) score -= 0.18;
  if (!agreement) score -= 0.08;
  return clamp(score, 0.05, 0.95);
}

function isSkin(r: number, g: number, b: number): boolean {
  if (r < 45 && g < 35 && b < 30) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 10) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const ycc = cr > 128 && cr < 188 && cb > 70 && cb < 145 && r + 8 > b;
  const rgb = r > g && r > b && r - min > 10 && max - min > 12 && r > 60;
  return ycc || rgb;
}

function sobel(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(gray.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] + gray[i - width + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + width - 1] + gray[i + width + 1];
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] + gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function thresholdEdges(edges: Float32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(edges.length);
  const minX = Math.floor(width * 0.28);
  const values: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = minX; x < width; x++) values.push(edges[y * width + x]);
  }
  values.sort((a, b) => a - b);
  const cutoff = values[Math.floor(values.length * 0.72)] ?? 10;
  for (let y = 0; y < height; y++) {
    for (let x = minX; x < width; x++) {
      const i = y * width + x;
      if (edges[i] >= cutoff && edges[i] > 8) mask[i] = 1;
    }
  }
  return mask;
}

function largestPosteriorComponent(mask: Uint8Array, width: number, height: number): {
  area: number;
  box: Rect | null;
  mask: Uint8Array;
} {
  const seen = new Uint8Array(mask.length);
  const minSeedX = Math.floor(width * 0.3);
  const anteriorCut = Math.floor(width * 0.12);
  let bestArea = 0;
  let bestPixels: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = minSeedX; x < width; x++) {
      const start = y * width + x;
      if (!mask[start] || seen[start]) continue;
      const stack = [start];
      seen[start] = 1;
      const pixels: number[] = [];
      while (stack.length) {
        const current = stack.pop() as number;
        pixels.push(current);
        const cx = current % width;
        const cy = (current / width) | 0;
        const neighbors = [current - 1, current + 1, current - width, current + width];
        for (const next of neighbors) {
          if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
          const nx = next % width;
          const ny = (next / width) | 0;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          if (nx < anteriorCut) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      if (pixels.length > bestArea) {
        bestArea = pixels.length;
        bestPixels = pixels;
      }
    }
  }

  const component = new Uint8Array(mask.length);
  if (!bestPixels.length) return { area: 0, box: null, mask: component };
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const index of bestPixels) {
    component[index] = 1;
    const x = index % width;
    const y = (index / width) | 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    area: bestPixels.length,
    box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    mask: component,
  };
}

function expand(box: Rect, fraction: number, width: number, height: number): Rect {
  const px = box.w * fraction;
  const py = box.h * fraction;
  const x = Math.max(0, box.x - px);
  const y = Math.max(0, box.y - py);
  const right = Math.min(width, box.x + box.w + px);
  const bottom = Math.min(height, box.y + box.h + py);
  return { x, y, w: right - x, h: bottom - y };
}
