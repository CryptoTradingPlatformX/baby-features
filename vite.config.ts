import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The ONNX loader imports its .mjs with a ?import query. Vite refuses to
// transform files in public/, so the dev server has to hand those files back raw.
function onnxRaw() {
  return {
    name: "onnx-raw",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use((req: { url?: string }, res: { setHeader: (name: string, value: string) => void; end: (body: Buffer) => void }, next: () => void) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.includes("/onnx/ort-wasm")) return next();
        const file = join(process.cwd(), "public", url.replace(/^.*\/onnx\//, "onnx/"));
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.end(readFileSync(file));
      });
    },
  };
}

// GitHub Pages project site: https://<user>.github.io/baby-features/
export default defineConfig({
  base: "/baby-features/",
  plugins: [onnxRaw(), react()],
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision", "@huggingface/transformers"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
