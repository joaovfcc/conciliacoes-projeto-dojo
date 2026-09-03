import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryCompletedReconciliationRepository } from "@conciliacao/core";
import { loadRuntimeConfig } from "../../src/config";
import { LocalObjectStore } from "../../src/object-store";
import { MemorySessionStore } from "../../src/session-store";
import { parseTsv, RuntimeServices, validateOfficeArchive } from "../../src/services";
import type { ReconciliationSession } from "../../src/types";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function runtime() {
  const path = await mkdtemp(join(tmpdir(), "reconciliation_test_")); temporaryDirectories.push(path);
  const config = { ...loadRuntimeConfig({}), localStoragePath: path, heartbeatGraceSeconds: 1 };
  const sessions = new MemorySessionStore(config);
  return new RuntimeServices(config, sessions, new LocalObjectStore(config), new InMemoryCompletedReconciliationRepository());
}

describe("isolamento de sessões autenticadas", () => {
  it("usa 256 bits, vincula o usuário e impede que o token de outra sessão conceda acesso", async () => {
    const services = await runtime();
    const first = await services.sessions.create("cliente-a", "user-a", "org-a", "company-a");
    const second = await services.sessions.create("cliente-b", "user-b", "org-b", "company-b");
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(await services.sessions.authorize(first.session.id, second.token)).toBeNull();
    expect(await services.sessions.authorize(first.session.id, first.token)).toMatchObject({ actorId: "user-a" });
    expect(JSON.stringify(first.session)).not.toContain(first.token);
    expect(first.session).not.toHaveProperty("actorId");
    expect(await services.sessions.countActive("cliente-a")).toBe(1);
    expect(await services.sessions.countCreatedLastHour("cliente-a")).toBe(1);
  });

  it("elimina a sessão após a tolerância sem heartbeat", async () => {
    const services = await runtime();
    const created = await services.sessions.create("cliente-c", "user-c", "org-c", "company-c");
    const session = (await services.sessions.get(created.session.id))!;
    session.lastHeartbeatAt = new Date(Date.now() - 2_000).toISOString();
    await services.sessions.save(session);
    expect(await services.sweep()).toBe(1);
    expect(await services.sessions.get(session.id)).toBeNull();
  });
});

describe("defesa de arquivos públicos", () => {
  it("rejeita componente de macro oculto dentro de um XLSX e remove o objeto", async () => {
    const services = await runtime();
    const created = await services.sessions.create("cliente-d", "user-d", "org-d", "company-d");
    const session = (await services.sessions.get(created.session.id))!;
    const payload = fakeZipCentralDirectory("xl/vbaProject.bin");
    const registration = await services.registerUpload(session, { kind: "LEDGER", originalName: "razao.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: payload.length });
    await services.objects.put(registration.file.objectKey, payload, registration.file.contentType);
    await expect(services.completeUpload(session, registration.file.id)).rejects.toMatchObject({ code: "MACRO_REJEITADA" });
    await expect(services.objects.get(registration.file.objectKey)).rejects.toBeDefined();
  });

  it("preserva a referência quando um upload rejeitado não pode ser eliminado", async () => {
    const services = await runtime();
    const created = await services.sessions.create("cliente-e", "user-e", "org-e", "company-e");
    const session = (await services.sessions.get(created.session.id))!;
    const payload = Buffer.from("not-an-xlsx");
    const registration = await services.registerUpload(session, { kind: "LEDGER", originalName: "razao.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: payload.length });
    await services.objects.put(registration.file.objectKey, payload, registration.file.contentType);
    services.objects.delete = async () => { throw new Error("s3 unavailable"); };

    await expect(services.completeUpload(session, registration.file.id)).rejects.toMatchObject({ code: "TEMPORARY_FILE_CLEANUP_FAILED" });

    expect((await services.sessions.get(session.id))?.files).toContainEqual(expect.objectContaining({
      id: registration.file.id,
      objectKey: registration.file.objectKey,
    }));
  });
});

describe("OCR em TSV", () => {
  it("preserva linhas com o mesmo line_num em blocos diferentes", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\t29/01",
      "5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t94\tTRIBUTO",
      "5\t1\t2\t1\t1\t1\t0\t0\t1\t1\t93\t30/01",
      "5\t1\t2\t1\t1\t2\t0\t0\t1\t1\t92\tPIX",
    ].join("\n");

    expect(parseTsv(tsv).text).toBe("29/01 TRIBUTO\n30/01 PIX");
  });

  it("exige que o idioma português esteja configurado", () => {
    expect(() => loadRuntimeConfig({ PDF_OCR_LANGUAGE: "eng" })).toThrow("idioma português");
    expect(loadRuntimeConfig({ PDF_OCR_LANGUAGE: "por" }).ocrLanguage).toBe("por");
  });
});

function fakeZipCentralDirectory(name: string): Buffer {
  const filename = Buffer.from(name);
  const buffer = Buffer.alloc(46 + filename.length);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt32LE(10, 20);
  buffer.writeUInt32LE(10, 24);
  buffer.writeUInt16LE(filename.length, 28);
  filename.copy(buffer, 46);
  return buffer;
}

describe("estrutura OOXML", () => {
  it("rejeita planilha corrompida antes dos parsers", () => {
    const payload = fakeZipCentralDirectory("xl/worksheets/sheet1.xml");
    expect(() => validateOfficeArchive({ originalName: "extrato.xlsx" }, payload)).toThrowError(
      expect.objectContaining({ code: "ARQUIVO_OOXML_INVALIDO" }),
    );
  });
});

describe("integração do motor PRD no runtime", () => {
  it("rejeita tolerância de data acima do teto do PRD antes da execução", async () => {
    const services = await runtime();
    const session = {
      id: "runtime-invalid-tolerance", tokenHash: "hash", clientKey: "client", actorId: "user", organizationId: "org", companyId: "company", createdAt: "2026-01-31T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", lastHeartbeatAt: "2026-01-31T00:00:00.000Z", status: "AWAITING_CONFIRMATION", progress: 35, progressMessage: "", files: [], closed: false,
      ledgers: [], statements: [],
      preflight: { companies: ["EMPRESA"], branches: ["01"], detectedPeriods: [{ period: "202601", recordCount: 2 }], ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "1", bankAccount: "2", recordCount: 1 }], statements: [{ fileId: "statement", originalName: "extrato.xlsx", bank: "ITAU", agency: "1", account: "2", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }], investments: [], issues: [], requiresUserInput: false },
    } as ReconciliationSession;

    await expect(services.process(session, {
      company: "EMPRESA", period: "202601", valueTolerance: "0.00", dateToleranceDays: 4,
      mappings: [{ ledgerAccount: "111", statementFileIds: ["statement"], signProfile: "BANK_ASSET" }],
      idempotencyKey: "invalid-tolerance",
    })).rejects.toMatchObject({ code: "TOLERANCIA_DATA_INVALIDA" });
  });

  it("não aceita uma declaração de escopo lógico que não reproduz a identidade do extrato", async () => {
    const services = await runtime();
    const session = {
      id: "runtime-invalid-linked-account", tokenHash: "hash", clientKey: "client", actorId: "user", organizationId: "org", companyId: "company", createdAt: "2026-01-31T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", lastHeartbeatAt: "2026-01-31T00:00:00.000Z", status: "AWAITING_CONFIRMATION", progress: 35, progressMessage: "", files: [], closed: false,
      ledgers: [], statements: [],
      preflight: { companies: ["EMPRESA"], branches: ["01"], detectedPeriods: [{ period: "202601", recordCount: 2 }], ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "1", bankAccount: "999", recordCount: 1 }], statements: [{ fileId: "statement", originalName: "extrato.xlsx", bank: "ITAU", agency: "1", account: "2", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }], investments: [], issues: [], requiresUserInput: false },
    } as ReconciliationSession;

    await expect(services.process(session, {
      company: "EMPRESA", period: "202601", valueTolerance: "0.00", dateToleranceDays: 0,
      mappings: [{ ledgerAccount: "111", statementFileIds: ["statement"], signProfile: "BANK_ASSET", linkedPhysicalAccounts: [{ statementFileId: "statement", bank: "ITAU", agency: "1", account: "3", role: "LINKED" }] }],
      idempotencyKey: "invalid-linked-account",
    })).rejects.toMatchObject({ code: "BANK_ACCOUNT_MISMATCH" });
  });

  it("persiste progresso por regras e controles wire-safe no resultado", async () => {
    const services = await runtime();
    const saves: string[] = [];
    const originalSave = services.sessions.save.bind(services.sessions);
    services.sessions.save = async (current) => { saves.push(current.progressMessage); await originalSave(current); };
    const originalComplete = services.sessions.complete.bind(services.sessions);
    services.sessions.complete = async (current) => { saves.push(current.progressMessage); return originalComplete(current); };
    const confirmation = { company: "EMPRESA", branch: "01", period: "202601", valueTolerance: "0.00", dateToleranceDays: 0, mappings: [{ ledgerAccount: "111", statementFileIds: ["statement"], signProfile: "BANK_ASSET" as const, linkedPhysicalAccounts: [{ statementFileId: "statement", bank: "ITAU", agency: "1", account: "2", role: "LINKED" as const }] }], idempotencyKey: "runtime-process", evaluatedAt: "2026-01-31T00:00:00.000Z" };
    const session = {
      id: "runtime-process", tokenHash: "hash", clientKey: "client", actorId: "user", organizationId: "org", companyId: "company", createdAt: confirmation.evaluatedAt, expiresAt: "2026-02-01T00:00:00.000Z", lastHeartbeatAt: confirmation.evaluatedAt, status: "AWAITING_CONFIRMATION", progress: 35, progressMessage: "", files: [
        { id: "ledger", kind: "LEDGER", originalName: "razao.xlsx", contentType: "application/octet-stream", size: 1, objectKey: "private/ledger", sha256: "ledger-hash" },
        { id: "statement", kind: "STATEMENT", originalName: "extrato.xlsx", contentType: "application/octet-stream", size: 1, objectKey: "private/statement", sha256: "statement-hash" },
      ], closed: false,
      ledgers: [{ id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02", document: "", history: "PAGAMENTO", value: "10.00", sourceId: "l1", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 2 } }],
      statements: [{ id: "s1", bank: "ITAU", agency: "1", bankAccount: "2", date: "2026-01-02", document: "", history: "PAGAMENTO", value: "-10.00", sourceId: "s1", evidence: { fileId: "statement", originalName: "extrato.xlsx", extractionMethod: "TABULAR", line: 2 } }],
      preflight: { companies: ["EMPRESA"], branches: ["01"], detectedPeriods: [{ period: "202601", recordCount: 2 }], ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "1", bankAccount: "999", recordCount: 1 }], statements: [{ fileId: "statement", originalName: "extrato.xlsx", bank: "ITAU", agency: "1", account: "2", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }], investments: [], issues: [], requiresUserInput: false },
    } as ReconciliationSession;
    await services.sessions.save(session);

    await services.process(session, confirmation);

    expect(saves).toContain("Iniciando pela RF-01: segregação de aplicações automáticas.");
    expect(saves).toContain("RF-02 a RF-09 concluídas; consolidando controles e evidências.");
    expect(session.result?.controls.movements).toEqual({ bankConciliable: "-10.00", ledger: "-10.00", difference: "0.00", status: "PASSED" });
    expect(() => JSON.stringify(session.result)).not.toThrow();
    const completed = await services.completedReconciliations.findById(session.id, ["company"], new Date());
    expect(completed).toMatchObject({ organizationId: "org", companyId: "company", userId: "user" });
    expect(completed?.sourceFiles).toEqual([
      { id: "ledger", kind: "LEDGER", originalName: "razao.xlsx", sha256: "ledger-hash" },
      { id: "statement", kind: "STATEMENT", originalName: "extrato.xlsx", sha256: "statement-hash" },
    ]);
    expect(JSON.stringify(completed)).not.toContain("objectKey");
    expect(saves.indexOf("Conciliação concluída.")).toBeGreaterThan(saves.indexOf("RF-02 a RF-09 concluídas; consolidando controles e evidências."));
  });

  it("não expõe conclusão quando a persistência anual falha", async () => {
    const path = await mkdtemp(join(tmpdir(), "reconciliation_failure_")); temporaryDirectories.push(path);
    const config = { ...loadRuntimeConfig({}), localStoragePath: path };
    const sessions = new MemorySessionStore(config);
    const objects = new LocalObjectStore(config);
    const repository = new InMemoryCompletedReconciliationRepository();
    repository.save = async () => { throw new Error("postgres unavailable"); };
    const services = new RuntimeServices(config, sessions, objects, repository);
    const confirmation = { company: "EMPRESA", period: "202601", valueTolerance: "0.00", dateToleranceDays: 0, mappings: [{ ledgerAccount: "111", statementFileIds: ["statement"], signProfile: "BANK_ASSET" as const }], idempotencyKey: "persistence-failure" };
    const session = {
      id: "persistence-failure", tokenHash: "hash", clientKey: "client", actorId: "user", organizationId: "org", companyId: "company", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), lastHeartbeatAt: new Date().toISOString(), status: "AWAITING_CONFIRMATION", progress: 35, progressMessage: "", files: [{ id: "statement", kind: "STATEMENT", originalName: "extrato.xlsx", contentType: "application/octet-stream", size: 1, objectKey: "private/statement", sha256: "hash" }], closed: false,
      ledgers: [{ id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02", document: "", history: "PAGAMENTO", value: "10.00", sourceId: "l1", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 2 } }],
      statements: [{ id: "s1", bank: "ITAU", agency: "1", bankAccount: "2", date: "2026-01-02", document: "", history: "PAGAMENTO", value: "-10.00", sourceId: "s1", evidence: { fileId: "statement", originalName: "extrato.xlsx", extractionMethod: "TABULAR", line: 2 } }],
      preflight: { companies: ["EMPRESA"], branches: ["01"], detectedPeriods: [{ period: "202601", recordCount: 2 }], ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "1", bankAccount: "2", recordCount: 1 }], statements: [{ fileId: "statement", originalName: "extrato.xlsx", bank: "ITAU", agency: "1", account: "2", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }], investments: [], issues: [], requiresUserInput: false },
    } as ReconciliationSession;
    await objects.put("private/statement", Buffer.from("x"));
    await sessions.save(session);

    await expect(services.process(session, confirmation)).rejects.toThrow("postgres unavailable");

    expect(session.status).toBe("FAILED");
    expect(session.result).toBeUndefined();
    await expect(objects.get("private/statement")).rejects.toBeDefined();
  });

  it("rejeita confirmação concorrente diferente sem sobrescrever a primeira", async () => {
    const services = await runtime();
    const created = await services.sessions.create("client", "user", "org", "company");
    const session = (await services.sessions.get(created.session.id))!;
    const first = { company: "EMPRESA", period: "202601", valueTolerance: "0.00", dateToleranceDays: 0, mappings: [], idempotencyKey: "first" };
    const second = { ...first, valueTolerance: "0.01" };

    await expect(services.sessions.claimConfirmation(session.id, first)).resolves.toBe("CLAIMED");
    await expect(services.sessions.claimConfirmation(session.id, first)).resolves.toBe("SAME");
    await expect(services.sessions.claimConfirmation(session.id, second)).resolves.toBe("CONFLICT");
    expect((await services.sessions.get(session.id))?.confirmation?.idempotencyKey).toBe("first");
  });

  it("um save obsoleto não apaga confirmação nem regride o estado", async () => {
    const services = await runtime();
    const created = await services.sessions.create("client-stale", "user", "org", "company");
    const stale = (await services.sessions.get(created.session.id))!;
    const confirmation = { company: "EMPRESA", period: "202601", valueTolerance: "0.00", dateToleranceDays: 0, mappings: [], idempotencyKey: "claimed" };
    expect(await services.sessions.claimConfirmation(stale.id, confirmation)).toBe("CLAIMED");
    const current = (await services.sessions.get(stale.id))!;
    current.status = "QUEUED";
    current.progress = 50;
    current.progressMessage = "Execução aguardando o worker.";
    await services.sessions.save(current);

    stale.status = "UPLOADING";
    stale.progressMessage = "Recebendo arquivos.";
    await services.sessions.save(stale);

    expect(await services.sessions.get(stale.id)).toMatchObject({
      status: "QUEUED",
      progress: 50,
      confirmation: { idempotencyKey: "claimed" },
    });
  });

  it("um save atrasado não ressuscita sessão eliminada", async () => {
    const services = await runtime();
    const created = await services.sessions.create("client-deleted", "user", "org", "company");
    const stale = (await services.sessions.get(created.session.id))!;

    await services.sessions.delete(stale.id);
    await services.sessions.save(stale);

    expect(await services.sessions.get(stale.id)).toBeNull();
  });

  it("um save falho atrasado não sobrescreve uma conclusão", async () => {
    const services = await runtime();
    const created = await services.sessions.create("client-completed", "user", "org", "company");
    const stale = (await services.sessions.get(created.session.id))!;
    const completed = structuredClone(stale);
    completed.status = "COMPLETED";
    completed.progress = 100;
    completed.progressMessage = "Conciliação concluída.";
    expect(await services.sessions.complete(completed)).toBe(true);

    stale.status = "FAILED";
    stale.progressMessage = "O processamento falhou de forma segura.";
    stale.errorCode = "PROCESSAMENTO_FALHOU";
    stale.errorMessage = "Falha atrasada.";
    await services.sessions.save(stale);

    expect(await services.sessions.get(stale.id)).toMatchObject({
      status: "COMPLETED",
      progress: 100,
      progressMessage: "Conciliação concluída.",
    });
    expect(await services.sessions.get(stale.id)).not.toHaveProperty("errorCode");
  });

  it("uma tentativa substituída não salva nem conclui sobre a tentativa atual", async () => {
    const services = await runtime();
    const created = await services.sessions.create("client-fenced", "user", "org", "company");
    expect(await services.sessions.claimProcessing(created.session.id, "attempt-a")).toEqual({ claimed: true, generation: 1 });
    const stale = (await services.sessions.get(created.session.id))!;
    expect(await services.sessions.claimProcessing(created.session.id, "attempt-b")).toEqual({ claimed: true, generation: 2 });

    stale.status = "FAILED";
    stale.errorCode = "STALE";
    await services.sessions.save(stale);
    stale.status = "COMPLETED";

    expect(await services.sessions.complete(stale)).toBe(false);
    expect(await services.sessions.get(stale.id)).toMatchObject({ processingAttemptId: "attempt-b" });
    expect(await services.sessions.get(stale.id)).not.toHaveProperty("errorCode");
  });

  it("cancelamento atômico fecha o snapshot atual antes de tentar remover arquivos", async () => {
    const services = await runtime();
    const created = await services.sessions.create("client-cancel-fence", "user", "org", "company");
    const stale = (await services.sessions.get(created.session.id))!;
    stale.files.push({
      id: "statement",
      kind: "STATEMENT",
      originalName: "extrato.xlsx",
      contentType: "application/octet-stream",
      size: 1,
      objectKey: "cancel-fence/statement",
    });
    await services.sessions.save(stale);
    await services.sessions.claimProcessing(stale.id, "active-attempt");
    services.objects.delete = async () => { throw new Error("storage unavailable"); };

    await expect(services.cleanup(stale)).rejects.toMatchObject({ code: "TEMPORARY_FILE_CLEANUP_FAILED" });

    expect(await services.sessions.get(stale.id)).toMatchObject({
      closed: true,
      status: "CANCELLED",
      processingAttemptId: "active-attempt",
    });
  });

  it("compensa o histórico quando a sessão é cancelada durante a persistência", async () => {
    const services = await runtime();
    const confirmation = { company: "EMPRESA", period: "202601", valueTolerance: "0.00", dateToleranceDays: 0, mappings: [{ ledgerAccount: "111", statementFileIds: ["statement"], signProfile: "BANK_ASSET" as const }], idempotencyKey: "cancel-race" };
    const session = processableSession("cancel-race");
    await services.sessions.save(session);
    const originalSave = services.completedReconciliations.save.bind(services.completedReconciliations);
    services.completedReconciliations.save = async (record, processingAttemptId, processingGeneration) => {
      const created = await originalSave(record, processingAttemptId, processingGeneration);
      await services.sessions.delete(session.id);
      return created;
    };

    await expect(services.process(session, confirmation)).rejects.toMatchObject({ code: "PROCESSAMENTO_CANCELADO" });

    expect(await services.completedReconciliations.findById(session.id, ["company"], new Date())).toBeNull();
  });
});

function processableSession(id: string): ReconciliationSession {
  return {
    id, tokenHash: "hash", clientKey: "client", actorId: "user", organizationId: "org", companyId: "company", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), lastHeartbeatAt: new Date().toISOString(), status: "AWAITING_CONFIRMATION", progress: 35, progressMessage: "", files: [], closed: false,
    ledgers: [{ id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02", document: "", history: "PAGAMENTO", value: "10.00", sourceId: "l1", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 2 } }],
    statements: [{ id: "s1", bank: "ITAU", agency: "1", bankAccount: "2", date: "2026-01-02", document: "", history: "PAGAMENTO", value: "-10.00", sourceId: "s1", evidence: { fileId: "statement", originalName: "extrato.xlsx", extractionMethod: "TABULAR", line: 2 } }],
    preflight: { companies: ["EMPRESA"], branches: ["01"], detectedPeriods: [{ period: "202601", recordCount: 2 }], ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "1", bankAccount: "2", recordCount: 1 }], statements: [{ fileId: "statement", originalName: "extrato.xlsx", bank: "ITAU", agency: "1", account: "2", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }], investments: [], issues: [], requiresUserInput: false },
  };
}
