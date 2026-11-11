import type { Px, Rect } from "../analysis/math";
import { contrastStretch, hogDescriptor } from "../analysis/descriptors";

/** Drop a canvas's pixel buffer. Full-frame phone photos add up across a rebuild. */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export async function decodeImage(blob: Blob, maxEdge = 960): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Could not read that photo. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not draw that photo.");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save image"))), "image/jpeg", quality);
  });
}

export function rotateScene(
  src: HTMLCanvasElement,
  points: Px[],
  radians: number,
  cx: number,
  cy: number,
): { canvas: HTMLCanvasElement; points: Px[] } {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const map = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  const corners = [map(0, 0), map(src.width, 0), map(src.width, src.height), map(0, src.height)];
  const minX = Math.min(...corners.map((corner) => corner[0]));
  const minY = Math.min(...corners.map((corner) => corner[1]));
  const maxX = Math.max(...corners.map((corner) => corner[0]));
  const maxY = Math.max(...corners.map((corner) => corner[1]));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(maxX - minX));
  canvas.height = Math.max(1, Math.ceil(maxY - minY));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not rotate the photo.");
  ctx.fillStyle = "#fffaf6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(-minX, -minY);
  ctx.translate(cx, cy);
  ctx.rotate(radians);
  ctx.translate(-cx, -cy);
  ctx.drawImage(src, 0, 0);
  return {
    canvas,
    points: points.map((point) => {
      const [x, y] = map(point.x, point.y);
      return { x: x - minX, y: y - minY, z: point.z };
    }),
  };
}

export function flipSceneH(src: HTMLCanvasElement, points: Px[]): { canvas: HTMLCanvasElement; points: Px[] } {
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not flip the photo.");
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return {
    canvas,
    points: points.map((point) => ({ x: src.width - point.x, y: point.y, z: point.z })),
  };
}

export function cropCanvas(src: HTMLCanvasElement, box: Rect, maxEdge = 320): HTMLCanvasElement | null {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const right = Math.min(src.width, box.x + box.w);
  const bottom = Math.min(src.height, box.y + box.h);
  const width = right - x;
  const height = bottom - y;
  if (width < 8 || height < 8) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function regionPixels(src: HTMLCanvasElement, box: Rect, maxEdge = 180): { rgba: Uint8ClampedArray; width: number; height: number } | null {
  const cropped = cropCanvas(src, box, maxEdge);
  if (!cropped) return null;
  const ctx = cropped.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, cropped.width, cropped.height);
  return { rgba: data.data, width: cropped.width, height: cropped.height };
}

export function appearanceFromCanvas(src: HTMLCanvasElement, size = 64): number[] {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(src, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const gray = new Float32Array(size * size);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
  }
  return hogDescriptor(contrastStretch(gray), size, size);
}

/**
 * Flatten slow lighting (a window, a flash) and keep local contrast.
 * The displayed crop stays untouched; this copy is only for the embedding.
 */
export function normalizeLighting(src: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = Math.max(1, src.width);
  copy.height = Math.max(1, src.height);
  const ctx = copy.getContext("2d", { willReadFrequently: true });
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, copy.width, copy.height);
  const data = image.data;
  const count = copy.width * copy.height;
  const luminance = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    luminance[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
  }
  const radius = Math.max(2, Math.round(Math.min(copy.width, copy.height) / 10));
  const blur = boxBlur(luminance, copy.width, copy.height, radius);
  const residual = new Float32Array(count);
  for (let i = 0; i < count; i++) residual[i] = luminance[i] - blur[i];
  const sorted = Array.from(residual).sort((a, b) => a - b);
  const lo = sorted[Math.floor(count * 0.02)] ?? -0.2;
  const hi = sorted[Math.floor(count * 0.98)] ?? 0.2;
  const span = hi - lo || 1;
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const flat = Math.min(1, Math.max(0, (residual[i] - lo) / span));
    const base = luminance[i] > 0.04 ? luminance[i] : 0.04;
    const gain = Math.min(2.4, Math.max(0.35, flat / base));
    data[p] = Math.min(255, Math.max(0, data[p] * gain));
    data[p + 1] = Math.min(255, Math.max(0, data[p + 1] * gain));
    data[p + 2] = Math.min(255, Math.max(0, data[p + 2] * gain));
  }
  ctx.putImageData(image, 0, 0);
  return copy;
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  const window = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += source[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / window;
      const leave = x - radius;
      const enter = x + radius + 1;
      sum -= source[y * width + Math.min(width - 1, Math.max(0, leave))];
      sum += source[y * width + Math.min(width - 1, Math.max(0, enter))];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      output[y * width + x] = sum / window;
      const leave = y - radius;
      const enter = y + radius + 1;
      sum -= horizontal[Math.min(height - 1, Math.max(0, leave)) * width + x];
      sum += horizontal[Math.min(height - 1, Math.max(0, enter)) * width + x];
    }
  }
  return output;
}

export function skinFraction(rgba: Uint8ClampedArray): number {
  let skin = 0;
  const pixels = rgba.length / 4;
  for (let p = 0; p < rgba.length; p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (r > 70 && r > g && r > b && max - min > 12) skin++;
  }
  return pixels ? skin / pixels : 0;
}
