import { copyFileSync, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = join(root, "public", "models");
const wasmOut = join(root, "public", "wasm");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const modelPath = join(modelDir, "face_landmarker.task");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

mkdirSync(modelDir, { recursive: true });
mkdirSync(wasmOut, { recursive: true });

for (const name of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  copyFileSync(join(wasmSrc, name), join(wasmOut, name));
}

function modelReady() {
  if (!existsSync(modelPath)) return false;
  return statSync(modelPath).size > 1_000_000;
}

async function downloadModel() {
  let lastError = "download failed";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Downloading face landmarker model (attempt ${attempt})...`);
      const response = await fetch(modelUrl);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(modelPath));
      if (!modelReady()) throw new Error("Model file looks incomplete");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(lastError);
    }
  }
  throw new Error(`Could not download face landmarker model: ${lastError}`);
}

if (!modelReady()) {
  await downloadModel();
}

console.log("Face model and wasm files are ready.");
