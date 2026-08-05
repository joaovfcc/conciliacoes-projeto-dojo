import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import type { ReconciliationSession } from "@conciliacao/runtime";
import { createJobProcessor, type ProcessingJob, type ProcessingRuntime } from "../../src/processor";

function job(action: ProcessingJob["action"]): Job<ProcessingJob> {
  return { data: { sessionId: "session-1", action } } as Job<ProcessingJob>;
}

function session(overrides: Partial<ReconciliationSession> = {}): ReconciliationSession {
  return {
    id: "session-1",
    tokenHash: "hash",
    clientKey: "client",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T02:00:00.000Z",
    lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    status: "READY",
    progress: 0,
    progressMessage: "",
    files: [],
    closed: false,
    ...overrides,
  };
}

describe("createJobProcessor", () => {
  it("despacha a pré-análise sem iniciar um worker BullMQ", async () => {
    const current = session();
    const runtime = {
      sessions: { get: vi.fn().mockResolvedValue(current) },
      preflight: vi.fn().mockResolvedValue(undefined),
      process: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProcessingRuntime;

    await createJobProcessor(runtime)(job("preflight"));

    expect(runtime.preflight).toHaveBeenCalledWith(current);
    expect(runtime.process).not.toHaveBeenCalled();
  });

  it("ignora sessões ausentes ou encerradas", async () => {
    const runtime = {
      sessions: { get: vi.fn().mockResolvedValue(session({ closed: true })) },
      preflight: vi.fn(),
      process: vi.fn(),
    } as unknown as ProcessingRuntime;

    await createJobProcessor(runtime)(job("process"));

    expect(runtime.preflight).not.toHaveBeenCalled();
    expect(runtime.process).not.toHaveBeenCalled();
  });
});
