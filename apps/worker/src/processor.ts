import type { Job } from "bullmq";
import type { RuntimeServices } from "@conciliacao/runtime";

export type ProcessingJob = { sessionId: string; action: "preflight" | "process" };
export type ProcessingRuntime = Pick<RuntimeServices, "sessions" | "preflight" | "process">;

export function createJobProcessor(runtime: ProcessingRuntime) {
  return async (job: Job<ProcessingJob>): Promise<void> => {
    const session = await runtime.sessions.get(job.data.sessionId);
    if (!session || session.closed) return;
    if (job.data.action === "preflight") {
      await runtime.preflight(session);
      return;
    }
    if (session.confirmation) await runtime.process(session, session.confirmation);
  };
}
