import { Worker } from "bullmq";
import { PrismaCompletedReconciliationRepository, prisma } from "@conciliacao/core";
import { createObjectStore, createSessionStore, loadRuntimeConfig, RuntimeServices } from "@conciliacao/runtime";
import { createJobProcessor, type ProcessingJob } from "./processor.js";

const config = loadRuntimeConfig();
if (!config.redisUrl) throw new Error("REDIS_URL é obrigatório no worker.");

const runtime = new RuntimeServices(
  config,
  createSessionStore(config),
  createObjectStore(config),
  new PrismaCompletedReconciliationRepository(prisma),
);
const worker = new Worker<ProcessingJob>(
  "reconciliation",
  createJobProcessor(runtime),
  { connection: { url: config.redisUrl }, concurrency: config.maxConcurrentJobs },
);
const sweepTimer = setInterval(() => {
  void runtime.sweep().catch((error) => console.error(JSON.stringify({
    event: "runtime_sweep_failed",
    errorType: error instanceof Error ? error.name : "Unknown",
    timestamp: new Date().toISOString(),
  })));
}, 30_000);
sweepTimer.unref();

worker.on("completed", (job) => console.info(JSON.stringify({ event: "job_completed", jobId: job.id, timestamp: new Date().toISOString() })));
worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "job_failed", jobId: job?.id, reason: job?.failedReason, error: error instanceof Error ? { message: error.message, stack: error.stack } : error, timestamp: new Date().toISOString() })));

async function shutdown(): Promise<void> {
  clearInterval(sweepTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
