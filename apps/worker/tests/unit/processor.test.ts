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
    actorId: "user-1",
    organizationId: "org-1",
    companyId: "company-1",
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

  it.each([
    session({ closed: true }),
    session({ status: "COMPLETED" }),
    session({ status: "COMPLETED_WITH_ISSUES" }),
  ])("ignora sessões ausentes, encerradas ou concluídas", async (current) => {
    const runtime = {
      sessions: { get: vi.fn().mockResolvedValue(current) },
      preflight: vi.fn(),
      process: vi.fn(),
    } as unknown as ProcessingRuntime;

    await createJobProcessor(runtime)(job("process"));

    expect(runtime.preflight).not.toHaveBeenCalled();
    expect(runtime.process).not.toHaveBeenCalled();
  });

  it("despacha a action process com a confirmação já persistida sem alterar o protocolo", async () => {
    const confirmation = { company: "EMPRESA", period: "202601", valueTolerance: "0.00", dateToleranceDays: 0, mappings: [], idempotencyKey: "worker-process" };
    const current = session({ confirmation });
    const runtime = {
      sessions: { get: vi.fn().mockResolvedValue(current) },
      preflight: vi.fn(),
      process: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProcessingRuntime;

    await createJobProcessor(runtime)(job("process"));

    expect(runtime.process).toHaveBeenCalledWith(current, confirmation);
    expect(runtime.preflight).not.toHaveBeenCalled();
  });
});
