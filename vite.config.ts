import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// GitHub Pages project site: https://<user>.github.io/baby-features/
export default defineConfig({
  base: "/baby-features/",
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
