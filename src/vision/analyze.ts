import type { Angle, DetectedFace, PhotoAnalysis } from "../types";
import { FACE_OVAL } from "../analysis/landmarks";
import { measurePhoto } from "../analysis/measure";
import { detectFaces, getLandmarker } from "./engine";

export { subscribeModel } from "./engine";
import { decodeImage, rotateScene } from "./imageutil";

const SEARCH_DEGREES = [0, -15, 15, -30, 30, -45, 45, -60, 60, 90, -90];

/**
 * Face detectors miss a side view when the phone was tilted. Try a handful of
 * rotations and keep the one with the largest face. A straight-on photo with a
 * decent face returns immediately.
 */
export async function analyzePhotoBlob(blob: Blob, angle: Angle): Promise<{ canvas: HTMLCanvasElement; analysis: PhotoAnalysis }> {
  const base = await decodeImage(blob);
  const landmarker = await getLandmarker();
  let chosen = base;
  let faces = detectFaces(landmarker, base);
  let bestArea = largestFaceArea(faces, base.width, base.height);
  const enough = bestArea > base.width * base.height * 0.1;
  if (!enough) {
    for (const degrees of SEARCH_DEGREES) {
      if (degrees === 0) continue;
      const rotated = rotateScene(base, [], (degrees * Math.PI) / 180, base.width / 2, base.height / 2).canvas;
      const found = detectFaces(landmarker, rotated);
      const area = largestFaceArea(found, rotated.width, rotated.height);
      if (area > bestArea) {
        bestArea = area;
        chosen = rotated;
        faces = found;
      }
    }
  }
  const analysis = await measurePhoto(chosen, faces, angle);
  return { canvas: chosen, analysis };
}

function largestFaceArea(faces: DetectedFace[], width: number, height: number): number {
  let best = 0;
  for (const face of faces) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const index of FACE_OVAL) {
      const point = face.landmarks[index];
      if (!point) continue;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    best = Math.max(best, (maxX - minX) * width * (maxY - minY) * height);
  }
  return best;
}
