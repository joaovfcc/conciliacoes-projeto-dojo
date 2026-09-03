import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@conciliacao/core/bank-directory": path.resolve(workspaceRoot, "packages/core/src/bank-directory.ts"),
      "@conciliacao/core": path.resolve(workspaceRoot, "packages/core/src/index.ts"),
    },
  },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
