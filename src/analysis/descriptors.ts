/** Unsigned HOG plus rotation-normalized Fourier magnitudes of a closed contour. */

export function contrastStretch(gray: Float32Array): Float32Array {
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
  const hi = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
  const span = hi - lo || 1;
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const value = (gray[i] - lo) / span;
    out[i] = value < 0 ? 0 : value > 1 ? 1 : value;
  }
  return out;
}

export function hogDescriptor(gray: Float32Array, width: number, height: number): number[] {
  const cell = 8;
  const bins = 9;
  const cellsX = Math.floor(width / cell);
  const cellsY = Math.floor(height / cell);
  if (cellsX < 2 || cellsY < 2) return [];
  const hist = new Float32Array(cellsX * cellsY * bins);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx = gray[y * width + x + 1] - gray[y * width + x - 1];
      const gy = gray[(y + 1) * width + x] - gray[(y - 1) * width + x];
      const mag = Math.hypot(gx, gy);
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      const binFloat = (angle / Math.PI) * bins;
      let bin0 = Math.floor(binFloat) % bins;
      if (bin0 < 0) bin0 += bins;
      const bin1 = (bin0 + 1) % bins;
      const t = binFloat - Math.floor(binFloat);
      const cx = Math.min(cellsX - 1, Math.floor(x / cell));
      const cy = Math.min(cellsY - 1, Math.floor(y / cell));
      const base = (cy * cellsX + cx) * bins;
      hist[base + bin0] += mag * (1 - t);
      hist[base + bin1] += mag * t;
    }
  }

  const out: number[] = [];
  for (let by = 0; by < cellsY - 1; by++) {
    for (let bx = 0; bx < cellsX - 1; bx++) {
      const block: number[] = [];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const base = ((by + dy) * cellsX + (bx + dx)) * bins;
          for (let k = 0; k < bins; k++) block.push(hist[base + k]);
        }
      }
      let norm = 0;
      for (const value of block) norm += value * value;
      norm = Math.sqrt(norm) + 1e-6;
      const clipped = block.map((value) => Math.min(value / norm, 0.2));
      let norm2 = 0;
      for (const value of clipped) norm2 += value * value;
      norm2 = Math.sqrt(norm2) + 1e-6;
      for (const value of clipped) out.push(value / norm2);
    }
  }
  return out;
}

export function resampleClosed(points: { x: number; y: number }[], count: number): { x: number; y: number }[] {
  if (points.length < 3) return [];
  const loop = [...points, points[0]];
  const seg = [0];
  for (let i = 1; i < loop.length; i++) {
    seg.push(seg[i - 1] + Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y));
  }
  const total = seg[seg.length - 1];
  if (total < 1) return [];
  const out: { x: number; y: number }[] = [];
  let j = 1;
  for (let i = 0; i < count; i++) {
    const distance = (i / count) * total;
    while (j < seg.length - 1 && seg[j] < distance) j++;
    const span = seg[j] - seg[j - 1] || 1;
    const t = (distance - seg[j - 1]) / span;
    const a = loop[j - 1];
    const b = loop[j];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Magnitudes of Fourier coefficients 2..harmonics, divided by the first harmonic. */
export function fourierMagnitudes(points: { x: number; y: number }[], harmonics = 10): number[] {
  const samples = resampleClosed(points, 64);
  if (samples.length < 8) return [];
  const mags: number[] = [];
  const n = samples.length;
  for (let k = 0; k <= harmonics; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const angle = (-2 * Math.PI * k * i) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      re += samples[i].x * c - samples[i].y * s;
      im += samples[i].x * s + samples[i].y * c;
    }
    mags.push(Math.hypot(re, im) / n);
  }
  const scale = mags[1] || 1;
  return mags.slice(2).map((mag) => mag / scale);
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export function traceContour(mask: Uint8Array, width: number, height: number): { x: number; y: number }[] {
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const sx = start % width;
  const sy = Math.floor(start / width);
  const contour: { x: number; y: number }[] = [];
  let x = sx;
  let y = sy;
  let dir = 7;
  const limit = Math.min(width * height, 8000);
  for (let step = 0; step < limit; step++) {
    contour.push({ x, y });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nextDir = (dir + 6 + k) % 8;
      const nx = x + NEIGHBORS[nextDir][0];
      const ny = y + NEIGHBORS[nextDir][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!mask[ny * width + nx]) continue;
      dir = nextDir;
      x = nx;
      y = ny;
      found = true;
      break;
    }
    if (!found) break;
    if (x === sx && y === sy && contour.length > 8) break;
  }
  return contour;
}
