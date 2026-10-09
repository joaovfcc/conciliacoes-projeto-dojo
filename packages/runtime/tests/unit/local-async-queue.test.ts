import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryCompletedReconciliationRepository } from "@conciliacao/core";
import { loadRuntimeConfig } from "../../src/config";
import { LocalObjectStore } from "../../src/object-store";
import { MemorySessionStore } from "../../src/session-store";
import { RuntimeServices } from "../../src/services";
import type { ReconciliationSession } from "../../src/types";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTestRuntime() {
  const path = await mkdtemp(join(tmpdir(), "reconciliation_local_async_"));
  temporaryDirectories.push(path);
  const config = { ...loadRuntimeConfig({}), localStoragePath: path, heartbeatGraceSeconds: 60 };
  delete config.redisUrl; // Garante modo local sem Redis
  const sessions = new MemorySessionStore(config);
  const objects = new LocalObjectStore(config);
  const history = new InMemoryCompletedReconciliationRepository();
  const services = new RuntimeServices(config, sessions, objects, history);
  return { services, sessions, objects, history };
}

describe("Desacoplamento Assíncrono no Modo Local (sem Redis)", () => {
  it("enqueuePreflight coloca a sessão em QUEUED imediatamente e processa em background até AWAITING_CONFIRMATION", async () => {
    const { services, sessions, objects } = await createTestRuntime();
    const created = await sessions.create("client-1", "user-1", "org-1", "comp-1");
    const session = (await sessions.get(created.session.id))!;

    // Upload ledger
    const ledgerContent = Buffer.from(
      "DATA;CONTA;HISTORICO;DOCUMENTO;VALOR;DC\n" +
      "2026-03-01;1.1.1.01;Pagamento Fornecedor;DOC123;100.00;D\n",
      "utf-8"
    );
    const { file: ledgerFile } = await services.registerUpload(session, {
      kind: "LEDGER",
      originalName: "razao.csv",
      contentType: "text/csv",
      size: ledgerContent.length,
    });
    await objects.put(ledgerFile.objectKey, ledgerContent);
    await services.completeUpload(session, ledgerFile.id);

    // Upload statement
    const statementContent = Buffer.from(
      "DATA;VALOR;DOCUMENTO;HISTORICO\n" +
      "2026-03-01;-100.00;DOC123;Pagamento Fornecedor\n",
      "utf-8"
    );
    const { file: statementFile } = await services.registerUpload(session, {
      kind: "STATEMENT",
      originalName: "extrato.csv",
      contentType: "text/csv",
      size: statementContent.length,
    });
    await objects.put(statementFile.objectKey, statementContent);
    await services.completeUpload(session, statementFile.id);

    // Executa enqueuePreflight
    const sessionBeforeEnqueue = (await sessions.get(session.id))!;
    await services.enqueuePreflight(sessionBeforeEnqueue);

    // Verifica que retornou imediatamente com QUEUED
    const sessionImmediatelyAfter = (await sessions.get(session.id))!;
    expect(sessionImmediatelyAfter.status).toBe("QUEUED");
    expect(sessionImmediatelyAfter.pendingAction).toBe("PREFLIGHT");

    // Aguarda o término das tarefas locais assíncronas
    await services.drainLocalTasks();

    // Verifica que a sessão avançou para AWAITING_CONFIRMATION
    const sessionAfterAsync = (await sessions.get(session.id))!;
    expect(sessionAfterAsync.status).toBe("AWAITING_CONFIRMATION");
    expect(sessionAfterAsync.preflight).toBeDefined();
    expect(sessionAfterAsync.ledgers).toHaveLength(1);
    expect(sessionAfterAsync.statements).toHaveLength(1);
  });

  it("enqueue coloca a sessão em QUEUED imediatamente e processa em background até COMPLETED", async () => {
    const { services, sessions, objects } = await createTestRuntime();
    const created = await sessions.create("client-2", "user-2", "org-2", "comp-2");
    const session = (await sessions.get(created.session.id))!;

    // Upload ledger
    const ledgerContent = Buffer.from(
      "DATA;CONTA;HISTORICO;DOCUMENTO;VALOR;DC\n" +
      "2026-03-01;1.1.1.01;Pagamento Fornecedor;DOC123;100.00;D\n",
      "utf-8"
    );
    const { file: ledgerFile } = await services.registerUpload(session, {
      kind: "LEDGER",
      originalName: "razao.csv",
      contentType: "text/csv",
      size: ledgerContent.length,
    });
    await objects.put(ledgerFile.objectKey, ledgerContent);
    await services.completeUpload(session, ledgerFile.id);

    // Upload statement
    const statementContent = Buffer.from(
      "DATA;VALOR;DOCUMENTO;HISTORICO\n" +
      "2026-03-01;-100.00;DOC123;Pagamento Fornecedor\n",
      "utf-8"
    );
    const { file: statementFile } = await services.registerUpload(session, {
      kind: "STATEMENT",
      originalName: "extrato.csv",
      contentType: "text/csv",
      size: statementContent.length,
    });
    await objects.put(statementFile.objectKey, statementContent);
    await services.completeUpload(session, statementFile.id);

    // Pré-análise direta síncrona para preparar a sessão para confirmação
    await services.preflight(session);
    const sessionReady = (await sessions.get(session.id))!;
    expect(sessionReady.status).toBe("AWAITING_CONFIRMATION");

    const confirmation = {
      company: sessionReady.preflight!.companies[0] || "",
      period: "202603",
      valueTolerance: "0.00",
      dateToleranceDays: 0,
      mappings: [
        {
          ledgerAccount: "1.1.1.01",
          statementFileIds: [statementFile.id],
          signProfile: "BANK_LIABILITY" as const,
        },
      ],
      idempotencyKey: "idemp-test-1",
    };

    // Executa enqueue
    await services.enqueue(sessionReady, confirmation);

    // Verifica que retornou imediatamente com QUEUED
    const sessionImmediatelyAfter = (await sessions.get(session.id))!;
    expect(sessionImmediatelyAfter.status).toBe("QUEUED");
    expect(sessionImmediatelyAfter.pendingAction).toBe("PROCESS");

    // Aguarda o processamento em background terminar
    await services.drainLocalTasks();

    // Verifica que a sessão foi concluída com resultado
    const sessionAfterAsync = (await sessions.get(session.id))!;
    expect(["COMPLETED", "COMPLETED_WITH_ISSUES"]).toContain(sessionAfterAsync.status);
    expect(sessionAfterAsync.result).toBeDefined();
    expect(sessionAfterAsync.result?.summaries).toHaveLength(1);
  });
});
