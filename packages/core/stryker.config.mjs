/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  mutate: [
    "src/balance.ts",
    "src/statement-gates.ts",
    "src/reconciliation/domain/ReconciliationEngine.ts",
    "src/shared/domain/Decimal.ts",
  ],
  coverageAnalysis: "perTest",
  reporters: ["progress", "json", "html"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/index.html" },
  thresholds: { high: 80, low: 65, break: 55 },
  incremental: true,
  incrementalFile: "reports/mutation/incremental.json",
  concurrency: 4,
  timeoutMS: 15000,
  cleanTempDir: true,
};
