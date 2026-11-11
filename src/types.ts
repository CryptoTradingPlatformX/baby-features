export const ANALYSIS_VERSION = 1;

export type Angle = "front" | "left" | "right";

export type FeatureId =
  | "faceShape"
  | "forehead"
  | "eyebrows"
  | "eyes"
  | "nose"
  | "lips"
  | "chin"
  | "cheeks"
  | "leftEar"
  | "rightEar"
  | "noseProfile"
  | "chinProfile";

export type FeatureNeed = "front" | "left" | "right" | "profile";

export interface FeatureMeta {
  id: FeatureId;
  label: string;
  needs: FeatureNeed;
}

export const FEATURES: FeatureMeta[] = [
  { id: "faceShape", label: "Face shape", needs: "front" },
  { id: "forehead", label: "Forehead", needs: "front" },
  { id: "eyebrows", label: "Eyebrows", needs: "front" },
  { id: "eyes", label: "Eyes", needs: "front" },
  { id: "nose", label: "Nose", needs: "front" },
  { id: "lips", label: "Lips", needs: "front" },
  { id: "chin", label: "Chin & jaw", needs: "front" },
  { id: "cheeks", label: "Cheeks", needs: "front" },
  { id: "leftEar", label: "Left ear", needs: "left" },
  { id: "rightEar", label: "Right ear", needs: "right" },
  { id: "noseProfile", label: "Nose profile", needs: "profile" },
  { id: "chinProfile", label: "Chin profile", needs: "profile" },
];

export function featureMeta(id: FeatureId): FeatureMeta {
  const found = FEATURES.find((feature) => feature.id === id);
  if (!found) throw new Error(`Unknown feature ${id}`);
  return found;
}

export interface Issue {
  severity: "error" | "warn";
  code: string;
  message: string;
}

export interface PoseEstimate {
  kind: "front" | "left" | "right" | "three-quarter" | "unknown";
  widerSide: "left" | "right";
  turned: number;
  rollDeg: number;
  eyeRatio: number;
  widthRatio: number;
}

export interface AnalyzedFeature {
  id: FeatureId;
  friendly: string;
  detail: string;
  confidence: number;
  geometry: number[];
  appearance: number[];
  contour: number[];
  cropBlob: Blob;
  cropWidth: number;
  cropHeight: number;
}

export interface PhotoAnalysis {
  version: number;
  pose: PoseEstimate;
  issues: Issue[];
  features: AnalyzedFeature[];
  sharpness: number;
  brightness: number;
}

export interface StoredPhoto {
  angle: Angle;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
  analysis: PhotoAnalysis | null;
}

export interface Person {
  id: string;
  kind: "baby" | "family";
  name: string;
  relationship: string;
  createdAt: number;
  photos: Partial<Record<Angle, StoredPhoto>>;
}

export interface DetectedFace {
  landmarks: { x: number; y: number; z: number }[];
  blendshapes: Record<string, number>;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function hasBlockingIssue(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
