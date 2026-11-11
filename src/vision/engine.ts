import { FaceLandmarker, FilesetResolver, type FaceLandmarker as FaceLandmarkerType } from "@mediapipe/tasks-vision";
import type { DetectedFace } from "../types";

export interface ModelProgress {
  ratio: number;
  label: string;
}

type Listener = (progress: ModelProgress) => void;

const listeners = new Set<Listener>();
let enginePromise: Promise<FaceLandmarkerType> | null = null;
let lastProgress: ModelProgress = { ratio: 0, label: "Getting face tools ready…" };

export function subscribeModel(listener: Listener): () => void {
  listeners.add(listener);
  listener(lastProgress);
  return () => listeners.delete(listener);
}

function emit(progress: ModelProgress) {
  lastProgress = progress;
  for (const listener of listeners) listener(progress);
}

export function getLandmarker(): Promise<FaceLandmarkerType> {
  if (!enginePromise) {
    enginePromise = createLandmarker().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

async function createLandmarker(): Promise<FaceLandmarkerType> {
  emit({ ratio: 0.08, label: "Loading face tools…" });
  const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
  emit({ ratio: 0.22, label: "Loading the face model…" });
  const model = await fetchBuffer(`${import.meta.env.BASE_URL}models/face_landmarker.task`, (ratio) => {
    emit({ ratio: 0.22 + ratio * 0.68, label: "Loading the face model…" });
  });
  emit({ ratio: 0.94, label: "Getting ready…" });
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer: model, delegate: "CPU" },
    runningMode: "IMAGE",
    numFaces: 3,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: 0.4,
    minFacePresenceConfidence: 0.4,
  });
  emit({ ratio: 1, label: "Ready" });
  return landmarker;
}

export function detectFaces(landmarker: FaceLandmarkerType, canvas: HTMLCanvasElement): DetectedFace[] {
  const result = landmarker.detect(canvas);
  return result.faceLandmarks.map((landmarks, index) => {
    const blendshapes: Record<string, number> = {};
    for (const category of result.faceBlendshapes[index]?.categories ?? []) {
      blendshapes[category.categoryName] = category.score;
    }
    return {
      landmarks: landmarks.map((landmark) => ({ x: landmark.x, y: landmark.y, z: landmark.z })),
      blendshapes,
    };
  });
}

async function fetchBuffer(url: string, onProgress: (ratio: number) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the face model (${response.status}).`);
  const length = Number(response.headers.get("content-length") || 0);
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress(1);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (length) onProgress(Math.min(1, received / length));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(1);
  return out;
}
