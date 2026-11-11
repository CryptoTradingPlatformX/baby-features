import type { Issue } from "../types";
import type { Rect } from "./math";

export interface QualityReport {
  issues: Issue[];
  sharpness: number;
  brightness: number;
}

export function assessRegion(rgba: Uint8ClampedArray, width: number, height: number, faceFraction: number, clipped: boolean): QualityReport {
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const value = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    gray[i] = value;
    sum += value;
  }
  const brightness = sum / (gray.length * 255 || 1);
  const sharpness = laplacianVariance(gray, width, height);
  const issues: Issue[] = [];

  if (faceFraction < 0.15) {
    issues.push({
      severity: "error",
      code: "small-face",
      message: "The face is too small. Move closer so it fills more of the photo.",
    });
  } else if (faceFraction < 0.22) {
    issues.push({
      severity: "warn",
      code: "small-face",
      message: "A closer photo will make the features easier to compare.",
    });
  }

  if (clipped) {
    issues.push({
      severity: "warn",
      code: "clipped",
      message: "Part of the face is cut off. Leave a little room around the chin and forehead.",
    });
  }

  if (sharpness < 18) {
    issues.push({
      severity: "error",
      code: "blur",
      message: "This photo looks blurry. Hold steady, tap to focus, and retake.",
    });
  } else if (sharpness < 45) {
    issues.push({
      severity: "warn",
      code: "blur",
      message: "This photo is a little soft. A sharper one will score more fairly.",
    });
  }

  if (brightness < 0.16) {
    issues.push({
      severity: "error",
      code: "dark",
      message: "The face is too dark. Face a window or turn on a lamp and retake.",
    });
  } else if (brightness < 0.28) {
    issues.push({
      severity: "warn",
      code: "dark",
      message: "A bit more light on the face would help.",
    });
  } else if (brightness > 0.93) {
    issues.push({
      severity: "error",
      code: "bright",
      message: "The face is washed out. Avoid strong backlight and direct flash.",
    });
  } else if (brightness > 0.84) {
    issues.push({
      severity: "warn",
      code: "bright",
      message: "The face is very bright. Soft, even light works better.",
    });
  }

  return { issues, sharpness, brightness };
}

function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let count = 0;
  let mean = 0;
  const values: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = gray[i - width] + gray[i - 1] + gray[i + 1] + gray[i + width] - 4 * gray[i];
      values.push(value);
      mean += value;
      count++;
    }
  }
  mean /= count || 1;
  let variance = 0;
  for (const value of values) variance += (value - mean) * (value - mean);
  return variance / (count || 1);
}

export function expressionIssues(blendshapes: Record<string, number>): Issue[] {
  const issues: Issue[] = [];
  const blink = Math.max(blendshapes.eyeBlinkLeft ?? 0, blendshapes.eyeBlinkRight ?? 0);
  if (blink > 0.6) {
    issues.push({
      severity: "warn",
      code: "eyes-closed",
      message: "The eyes look closed. An open-eyed photo matches eyes more fairly.",
    });
  }
  if ((blendshapes.jawOpen ?? 0) > 0.45) {
    issues.push({
      severity: "warn",
      code: "mouth-open",
      message: "The mouth is open, so the lips and chin will be less reliable. A relaxed closed mouth is best.",
    });
  }
  return issues;
}

export function sampleBox(box: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const right = Math.min(width, Math.ceil(box.x + box.w));
  const bottom = Math.min(height, Math.ceil(box.y + box.h));
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}
