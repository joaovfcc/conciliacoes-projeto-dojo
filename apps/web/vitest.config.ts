import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "jsdom", include: ["tests/{unit,components}/**/*.test.{ts,tsx}"], setupFiles: [] },
  resolve: {
    alias: {
      "@": path.resolve(currentDirectory, "src"),
      "@conciliacao/core": path.resolve(currentDirectory, "../../packages/core/src/index.ts"),
      "@conciliacao/runtime": path.resolve(currentDirectory, "../../packages/runtime/src/index.ts"),
    },
  },
});
