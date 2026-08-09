import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/balance.ts",
        "src/statement-gates.ts",
        "src/reconciliation/domain/ReconciliationEngine.ts",
        "src/shared/domain/Decimal.ts",
        "src/statements/generic-statement-parser.ts",
        "src/statements/layout-detector.ts",
      ],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 85,
      },
      reporter: ["text", "json-summary"],
    },
  },
});
