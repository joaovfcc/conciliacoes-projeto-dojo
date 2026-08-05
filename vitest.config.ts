import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@conciliacao/core": path.resolve(workspaceRoot, "packages/core/src/index.ts"),
      "@conciliacao/runtime": path.resolve(workspaceRoot, "packages/runtime/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
