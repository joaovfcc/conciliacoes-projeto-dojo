import { Worker } from "../../../apps/worker/node_modules/bullmq/dist/cjs/index.js";
import {
  PrismaCompletedReconciliationRepository,
  prisma,
} from "../../../packages/core/dist/src/index.js";
import {
  createObjectStore,
  RedisSessionStore,
  loadRuntimeConfig,
  RuntimeServices,
} from "../../../packages/runtime/dist/src/index.js";
import { createJobProcessor } from "../../../apps/worker/dist/processor.js";

const mode = process.argv[2];
if (mode !== "crash" && mode !== "recover") throw new Error("Modo de worker inválido.");

const config = loadRuntimeConfig();
const sessions = new RedisSessionStore(config);
const persistentRepository = new PrismaCompletedReconciliationRepository(prisma);
const repository = mode === "crash"
  ? {
      save: async (record, processingAttemptId, processingGeneration) => {
        await persistentRepository.save(record, processingAttemptId, processingGeneration);
        process.send?.({ type: "history-persisted" });
        await new Promise(() => undefined);
      },
      list: (...arguments_) => persistentRepository.list(...arguments_),
      findById: (...arguments_) => persistentRepository.findById(...arguments_),
      delete: (id, processingAttemptId) => persistentRepository.delete(id, processingAttemptId),
      deleteExpired: (now) => persistentRepository.deleteExpired(now),
    }
  : persistentRepository;
const runtime = new RuntimeServices(config, sessions, createObjectStore(config), repository);
const worker = new Worker(
  "reconciliation",
  createJobProcessor(runtime),
  {
    connection: { url: config.redisUrl },
    concurrency: 1,
    autorun: false,
    lockDuration: mode === "crash" ? 1_000 : 10_000,
    stalledInterval: 500,
    maxStalledCount: 1,
  },
);

worker.on("stalled", () => process.send?.({ type: "stalled" }));
worker.on("completed", async () => {
  process.send?.({ type: "completed" });
  await shutdown(0);
});
worker.on("failed", async (_job, error) => {
  process.send?.({ type: "failed", error: error.message });
  await shutdown(1);
});

await worker.waitUntilReady();
process.send?.({ type: "ready" });
await worker.run();

async function shutdown(exitCode) {
  await worker.close();
  await sessions.close();
  await prisma.$disconnect();
  process.exit(exitCode);
}

process.on("SIGTERM", () => { void shutdown(0); });
process.on("SIGINT", () => { void shutdown(0); });
