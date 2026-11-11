import type { AnalyzedFeature, Angle, DetectedFace, FeatureId, Issue, PhotoAnalysis } from "../types";
import { ANALYSIS_VERSION, hasBlockingIssue } from "../types";
import { describeFeature } from "./describe";
import { earConfidence, estimateEarBox, refineEarRoi } from "./ears";
import {
  CHEEKS,
  CHIN,
  CHIN_JAW,
  FACE_OVAL,
  FOREHEAD,
  FOREHEAD_TOP,
  LEFT_BROW,
  LEFT_EYE,
  LIPS,
  LOWER_INNER,
  LOWER_LIP,
  MOUTH_LEFT,
  MOUTH_RIGHT,
  NOSE,
  NOSE_BOTTOM,
  NOSE_ROOT,
  NOSE_TIP,
  RIGHT_BROW,
  RIGHT_EYE,
  UPPER_INNER,
  UPPER_LIP,
} from "./landmarks";
import { angleDeg, bboxOf, dist, midpoint, normalizeContour, outsideFraction, pointLineDistance, type Px, type Rect } from "./math";
import { classifyPose, poseIssues, type PoseSignals } from "./pose";
import { assessRegion, expressionIssues } from "./quality";
import { fourierMagnitudes } from "./descriptors";
import { appearanceFromCanvas, cropCanvas, flipSceneH, regionPixels, rotateScene, skinFraction } from "../vision/imageutil";

interface Draft {
  id: FeatureId;
  geometry: number[];
  crop: HTMLCanvasElement | null;
  contour: number[];
  confidence: number;
}

export async function measurePhoto(source: HTMLCanvasElement, faces: DetectedFace[], expected: Angle): Promise<PhotoAnalysis> {
  const issues: Issue[] = [];
  if (!faces.length || faces[0].landmarks.length < 300) {
    return {
      version: ANALYSIS_VERSION,
      pose: classifyPose({ eyeRatio: 0, widerSide: "left", widthRatio: 0, rollDeg: 0 }),
      issues: [
        {
          severity: "error",
          code: "no-face",
          message: "We couldn't find a face. Try a closer photo with the face clearly visible.",
        },
      ],
      features: [],
      sharpness: 0,
      brightness: 0,
    };
  }

  const face = largestFace(faces, source.width, source.height);
  if (faces.length > 1) {
    issues.push({
      severity: "warn",
      code: "many-faces",
      message: "We used the largest face. Crop closer if that wasn't the right person.",
    });
  }

  let points = toPixels(face, source.width, source.height);
  const pose = classifyPose(signalsFrom(points));
  issues.push(...poseIssues(expected, pose));
  issues.push(...expressionIssues(face.blendshapes));

  const faceBox = bboxOf(points, FACE_OVAL, 0.04, 0.06);
  let sharpness = 0;
  let brightness = 0;
  if (faceBox) {
    const sample = regionPixels(source, faceBox, 200);
    const clipped = FACE_OVAL.some((index) => {
      const point = points[index];
      return point.x < 2 || point.y < 2 || point.x > source.width - 2 || point.y > source.height - 2;
    });
    if (sample) {
      const quality = assessRegion(sample.rgba, sample.width, sample.height, faceBox.h / source.height, clipped);
      issues.push(...quality.issues);
      sharpness = quality.sharpness;
      brightness = quality.brightness;
    }
  }

  if (hasBlockingIssue(issues)) {
    return { version: ANALYSIS_VERSION, pose, issues, features: [], sharpness, brightness };
  }

  const aligned =
    expected === "front" ? uprightByEyes(source, points) : uprightByChin(source, points);
  points = aligned.points;
  let canvas = aligned.canvas;

  if (expected !== "front") {
    const side = expected;
    const tragion = points[side === "left" ? 454 : 234];
    if (tragion && points[NOSE_TIP] && tragion.x < points[NOSE_TIP].x) {
      const flipped = flipSceneH(canvas, points);
      canvas = flipped.canvas;
      points = flipped.points;
    }
  }

  const drafts = expected === "front" ? frontDrafts(canvas, points, issues) : profileDrafts(canvas, points, expected, issues);
  const features = await finishDrafts(drafts);
  return { version: ANALYSIS_VERSION, pose, issues, features, sharpness, brightness };
}

function largestFace(faces: DetectedFace[], width: number, height: number): DetectedFace {
  let best = faces[0];
  let bestArea = -1;
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
    const area = (maxX - minX) * width * (maxY - minY) * height;
    if (area > bestArea) {
      best = face;
      bestArea = area;
    }
  }
  return best;
}

function toPixels(face: DetectedFace, width: number, height: number): Px[] {
  return face.landmarks.map((landmark) => ({
    x: landmark.x * width,
    y: landmark.y * height,
    z: landmark.z,
  }));
}

function signalsFrom(points: Px[]): PoseSignals {
  const leftW = dist(points[263], points[362]);
  const rightW = dist(points[33], points[133]);
  const eyeRatio = Math.min(leftW, rightW) / (Math.max(leftW, rightW) || 1);
  const distSide = dist(points[1], points[454]) >= dist(points[1], points[234]) ? "left" : "right";
  const widerSide = distSide;
  const faceW = dist(points[234], points[454]);
  const faceH = dist(points[10], points[152]) || 1;
  const rightC = midpoint(points[33], points[133]);
  const leftC = midpoint(points[263], points[362]);
  const rollDeg = (Math.atan2(leftC.y - rightC.y, leftC.x - rightC.x) * 180) / Math.PI;
  return { eyeRatio, widerSide, widthRatio: faceW / faceH, rollDeg };
}

function uprightByEyes(src: HTMLCanvasElement, points: Px[]) {
  const rightC = midpoint(points[33], points[133]);
  const leftC = midpoint(points[263], points[362]);
  const radians = -Math.atan2(leftC.y - rightC.y, leftC.x - rightC.x);
  return rotateScene(src, points, radians, (rightC.x + leftC.x) / 2, (rightC.y + leftC.y) / 2);
}

function uprightByChin(src: HTMLCanvasElement, points: Px[]) {
  const top = points[FOREHEAD_TOP];
  const chin = points[CHIN];
  const radians = -Math.atan2(top.x - chin.x, -(top.y - chin.y));
  return rotateScene(src, points, radians, (top.x + chin.x) / 2, (top.y + chin.y) / 2);
}

function frontDrafts(canvas: HTMLCanvasElement, points: Px[], issues: Issue[]): Draft[] {
  const faceW = dist(points[234], points[454]) || 1;
  const faceH = dist(points[10], points[152]) || 1;
  const jawW = dist(points[172], points[397]);
  const foreheadW = dist(points[54], points[284]) || faceW;
  const iod = dist(midpoint(points[33], points[133]), midpoint(points[263], points[362])) || 1;
  const oval = FACE_OVAL.map((index) => points[index]);

  const rightH = dist(points[159], points[145]);
  const rightW = dist(points[33], points[133]) || 1;
  const leftH = dist(points[386], points[374]);
  const leftW = dist(points[263], points[362]) || 1;
  const aspect = (rightH / rightW + leftH / leftW) / 2;
  const rightTilt = (Math.atan2(points[133].y - points[33].y, Math.abs(points[133].x - points[33].x)) * 180) / Math.PI;
  const leftTilt = (Math.atan2(points[362].y - points[263].y, Math.abs(points[362].x - points[263].x)) * 180) / Math.PI;

  const mouthW = dist(points[MOUTH_LEFT], points[MOUTH_RIGHT]) || 1;
  const midY = (points[UPPER_LIP].y + points[LOWER_LIP].y) / 2;
  const rightBulge = pointLineDistance(points[205], points[116], points[172]) / faceW;
  const leftBulge = pointLineDistance(points[425], points[345], points[397]) / faceW;
  const browMid = midpoint(points[107], points[336]);

  const foreheadCrop = cropCanvas(canvas, bboxOf(points, FOREHEAD, 0.12, 0.2) as Rect, 280);
  let foreheadConfidence = 0.78;
  if (foreheadCrop) {
    const ctx = foreheadCrop.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      const data = ctx.getImageData(0, 0, foreheadCrop.width, foreheadCrop.height).data;
      let chroma = 0;
      let samples = 0;
      for (let offset = 0; offset < data.length; offset += 16) {
        chroma += Math.max(data[offset], data[offset + 1], data[offset + 2]) - Math.min(data[offset], data[offset + 1], data[offset + 2]);
        samples++;
      }
      const colorful = chroma / (samples || 1) > 14;
      if (colorful && skinFraction(data) < 0.28) {
        foreheadConfidence = 0.48;
        issues.push({
          severity: "warn",
          code: "forehead-covered",
          message: "The forehead looks covered. Hats and bangs make that comparison less sure.",
        });
      }
    }
  }

  return [
    {
      id: "faceShape",
      geometry: [faceW / faceH, jawW / foreheadW, ...normalizeContour(oval)],
      crop: cropCanvas(canvas, bboxOf(points, FACE_OVAL, 0.12, 0.1) as Rect, 320),
      contour: [],
      confidence: 0.84,
    },
    {
      id: "forehead",
      geometry: [dist(points[10], browMid) / faceH, foreheadW / faceW],
      crop: foreheadCrop,
      contour: [],
      confidence: foreheadConfidence,
    },
    {
      id: "eyebrows",
      geometry: [(arch(points, [70, 63, 105, 66, 107]) + arch(points, [300, 293, 334, 296, 336])) / 2, dist(points[107], points[336]) / iod],
      crop: cropCanvas(canvas, bboxOf(points, [...LEFT_BROW, ...RIGHT_BROW], 0.2, 0.55) as Rect, 300),
      contour: [],
      confidence: 0.8,
    },
    {
      id: "eyes",
      geometry: [aspect, (rightTilt + leftTilt) / 2, iod / faceW, (rightW + leftW) / 2 / faceW],
      crop: cropCanvas(canvas, bboxOf(points, [...LEFT_EYE, ...RIGHT_EYE], 0.25, 0.9) as Rect, 320),
      contour: [],
      confidence: 0.86,
    },
    {
      id: "nose",
      geometry: [
        dist(points[98], points[327]) / faceW,
        dist(points[NOSE_ROOT], points[NOSE_BOTTOM]) / faceH,
        dist(points[45], points[275]) / (dist(points[98], points[327]) || 1),
      ],
      crop: cropCanvas(canvas, bboxOf(points, NOSE, 0.35, 0.25) as Rect, 280),
      contour: [],
      confidence: 0.82,
    },
    {
      id: "lips",
      geometry: [
        mouthW / faceW,
        dist(points[UPPER_LIP], points[LOWER_LIP]) / mouthW,
        dist(points[UPPER_LIP], points[UPPER_INNER]) / (dist(points[LOWER_INNER], points[LOWER_LIP]) || 1),
        ((points[MOUTH_LEFT].y + points[MOUTH_RIGHT].y) / 2 - midY) / mouthW,
      ],
      crop: cropCanvas(canvas, bboxOf(points, LIPS, 0.28, 0.45) as Rect, 300),
      contour: [],
      confidence: 0.8,
    },
    {
      id: "chin",
      geometry: [jawW / faceW, dist(points[148], points[377]) / (jawW || 1)],
      crop: cropCanvas(canvas, bboxOf(points, CHIN_JAW, 0.16, 0.28) as Rect, 300),
      contour: [],
      confidence: 0.78,
    },
    {
      id: "cheeks",
      geometry: [(rightBulge + leftBulge) / 2, Math.abs(rightBulge - leftBulge)],
      crop: cropCanvas(canvas, bboxOf(points, CHEEKS, 0.18, 0.28) as Rect, 320),
      contour: [],
      confidence: 0.74,
    },
  ];
}

function profileDrafts(canvas: HTMLCanvasElement, points: Px[], expected: "left" | "right", issues: Issue[]): Draft[] {
  const faceH = dist(points[FOREHEAD_TOP], points[CHIN]) || 1;
  const root = points[NOSE_ROOT];
  const tip = points[NOSE_TIP];
  const base = points[NOSE_BOTTOM];
  const noseLen = dist(root, tip) || 1;
  let convex = 0;
  for (const index of [6, 197, 195, 5, 4]) {
    convex = Math.max(convex, pointLineDistance(points[index], root, tip));
  }
  const noseBox = bboxOf(points, NOSE, 0.45, 0.3);
  if (noseBox) {
    noseBox.x -= noseBox.w * 0.2;
    noseBox.w += noseBox.w * 0.2;
  }

  const chinBox = bboxOf(points, [LOWER_LIP, CHIN, 148, 176, 377, 400], 0.35, 0.45);
  const drafts: Draft[] = [
    {
      id: "noseProfile",
      geometry: [convex / noseLen, angleDeg(root, tip, base) / 180, (root.x - tip.x) / faceH],
      crop: noseBox ? cropCanvas(canvas, noseBox, 280) : null,
      contour: [],
      confidence: 0.74,
    },
    {
      id: "chinProfile",
      geometry: [(points[LOWER_LIP].x - points[CHIN].x) / faceH, (points[CHIN].y - points[LOWER_LIP].y) / faceH],
      crop: chinBox ? cropCanvas(canvas, chinBox, 280) : null,
      contour: [],
      confidence: 0.7,
    },
  ];

  const estimated = estimateEarBox(points);
  if (!estimated || estimated.side !== expected) {
    issues.push({
      severity: "warn",
      code: "ear-missing",
      message: "We found the side view, but not a clear ear. Retake with hair off the ear and a little room behind the head.",
    });
    return drafts;
  }

  const clipped = outsideFraction(estimated.box, canvas.width, canvas.height) > 0.22;
  const roi = cropCanvas(canvas, estimated.box, 420);
  if (!roi) {
    issues.push({
      severity: "warn",
      code: "ear-missing",
      message: "The ear is cut off or too small. Move back a little so the whole ear is in the photo.",
    });
    return drafts;
  }
  const ctx = roi.getContext("2d", { willReadFrequently: true });
  if (!ctx) return drafts;
  const pixels = ctx.getImageData(0, 0, roi.width, roi.height);
  const refined = refineEarRoi(pixels.data, roi.width, roi.height);
  const crop = refined.box ? cropCanvas(roi, refined.box, 320) : roi;
  const confidence = earConfidence(Boolean(refined.box), refined.edgeMean, clipped, estimated.agreement);
  if (!crop || confidence < 0.4) {
    issues.push({
      severity: "warn",
      code: "ear-unclear",
      message: "The ear is hard to see. Use soft light, pull hair back, and include the whole ear.",
    });
    return drafts;
  }
  if (clipped) {
    issues.push({
      severity: "warn",
      code: "ear-clipped",
      message: "The ear may be cut off. Leave a little room behind the head.",
    });
  }
  const aspect = crop.height / (crop.width || 1);
  drafts.push({
    id: expected === "left" ? "leftEar" : "rightEar",
    geometry: [aspect, refined.box ? refined.box.h / (refined.box.w || 1) : aspect],
    crop,
    contour: fourierMagnitudes(refined.contour),
    confidence,
  });
  return drafts;
}

function arch(points: Px[], indices: number[]): number {
  const a = points[indices[0]];
  const b = points[indices[indices.length - 1]];
  const length = dist(a, b) || 1;
  let max = 0;
  for (const index of indices) max = Math.max(max, pointLineDistance(points[index], a, b));
  return max / length;
}

async function finishDrafts(drafts: Draft[]): Promise<AnalyzedFeature[]> {
  const features: AnalyzedFeature[] = [];
  for (const draft of drafts) {
    if (!draft.crop || draft.confidence < 0.4) continue;
    const described = describeFeature(draft.id, draft.geometry);
    features.push({
      id: draft.id,
      friendly: described.friendly,
      detail: described.detail,
      confidence: draft.confidence,
      geometry: draft.geometry,
      appearance: appearanceFromCanvas(draft.crop),
      contour: draft.contour,
      cropBlob: await blobFrom(draft.crop),
      cropWidth: draft.crop.width,
      cropHeight: draft.crop.height,
    });
  }
  return features;
}

function blobFrom(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save a feature crop"))), "image/jpeg", 0.84);
  });
}
