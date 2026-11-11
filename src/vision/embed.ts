import { env, pipeline, RawImage, type ImageFeatureExtractionPipeline, type ProgressInfo } from "@huggingface/transformers";
import { reportProgress } from "./engine";
import { normalizeLighting } from "./imageutil";

const MODEL_ID = "Xenova/dinov2-small";

let extractorPromise: Promise<ImageFeatureExtractionPipeline> | null = null;
let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = true;
  env.localModelPath = `${import.meta.env.BASE_URL}models/`;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    wasm.wasmPaths = `${import.meta.env.BASE_URL}onnx/`;
  }
}

export function getEmbedder(): Promise<ImageFeatureExtractionPipeline> {
  configure();
  if (!extractorPromise) {
    extractorPromise = pipeline("image-feature-extraction", MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      local_files_only: true,
      progress_callback: (info: ProgressInfo) => {
        if (info.status === "progress" && info.total) {
          reportProgress({
            ratio: 0.5 + 0.48 * (info.loaded / info.total),
            label: "Loading the resemblance model…",
          });
        } else if (info.status === "initiate" || info.status === "download") {
          reportProgress({ ratio: 0.5, label: "Loading the resemblance model…" });
        }
      },
    }).catch((error) => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

/** Lighting-normalized DINOv2 embedding, L2-normalized. Empty if the model cannot load. */
export async function embedCanvas(canvas: HTMLCanvasElement): Promise<number[]> {
  const extractor = await getEmbedder();
  const prepared = normalizeLighting(canvas);
  const image = RawImage.fromCanvas(prepared);
  const tensor = await extractor(image);
  const dims = tensor.dims;
  const data = tensor.data as Float32Array;
  const hidden = dims[dims.length - 1] ?? data.length;
  const vector = Array.from(data.slice(0, hidden));
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vector.map((value) => value / norm);
}
