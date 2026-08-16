import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "../../packages/core/node_modules/exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryCompletedReconciliationRepository } from "../../packages/core/src/index";
import { loadRuntimeConfig } from "../../packages/runtime/src/config";
import { LocalObjectStore } from "../../packages/runtime/src/object-store";
import { MemorySessionStore } from "../../packages/runtime/src/session-store";
import { RuntimeServices } from "../../packages/runtime/src/services";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("sessão de conciliação", () => {
  it("executa upload, pré-análise, mapeamento, matching e exportação sem conciliar apenas por valor", async () => {
    const storagePath = await mkdtemp(join(tmpdir(), "conciliacao_e2e_"));
    temporaryDirectories.push(storagePath);
    const config = { ...loadRuntimeConfig({}), localStoragePath: storagePath };
    const sessions = new MemorySessionStore(config);
    const objects = new LocalObjectStore(config);
    const completed = new InMemoryCompletedReconciliationRepository();
    const runtime = new RuntimeServices(config, sessions, objects, completed);
    const created = await sessions.create("e2e-client", "e2e-user", "e2e-org", "e2e-company");
    const session = (await sessions.authorize(created.session.id, created.token))!;
    const ledger = await ledgerWorkbook();
    const statement = ofxStatement();

    const uploadedLedger = await runtime.registerUpload(session, { kind: "LEDGER", originalName: "razao.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: ledger.length });
    await objects.put(uploadedLedger.file.objectKey, ledger);
    await runtime.completeUpload(session, uploadedLedger.file.id);
    const uploadedStatement = await runtime.registerUpload(session, { kind: "STATEMENT", originalName: "extrato.ofx", contentType: "application/x-ofx", size: statement.length });
    await objects.put(uploadedStatement.file.objectKey, statement);
    await runtime.completeUpload(session, uploadedStatement.file.id);

    await runtime.preflight(session);
    await runtime.process(session, {
      company: "EMPRESA",
      branch: "01",
      period: "202601",
      valueTolerance: "0.01",
      dateToleranceDays: 2,
      mappings: [{ ledgerAccount: "11102027", statementFileIds: [uploadedStatement.file.id], signProfile: "BANK_ASSET" }],
      idempotencyKey: "e2e-session",
    });

    expect(session.result?.results).toContainEqual(expect.objectContaining({ status: "AUTO_MATCH_EXACT", decisionLevel: "AUTOMATIC" }));
    expect(await completed.findById(session.id, ["e2e-company"], new Date())).toMatchObject({
      organizationId: "e2e-org",
      companyId: "e2e-company",
      userId: "e2e-user",
    });
    await expect(runtime.export(session)).resolves.toMatchObject({ length: expect.any(Number) });
  });
});

async function ledgerWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Razão");
  sheet.addRow(["CONTA - 1.1.1.0.2027 - BANCO ITAU AG. 8363 C/C00378-4"]);
  sheet.addRow(["EMPRESA", "FILIAL", "CONTA", "DATA", "DOCUMENTO", "HISTORICO", "VALOR"]);
  sheet.addRow(["EMPRESA", "01", "11102027", "2026-01-02", "1", "PAGAMENTO", "-10.00"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function ofxStatement(): Buffer {
  return Buffer.from([
    "<OFX>", "<BANKID>341", "<BRANCHID>8363", "<ACCTID>00378-4", "<BANKTRANLIST>",
    "<STMTTRN><DTPOSTED>20260102<TRNAMT>10.00<FITID>1<MEMO>PAGAMENTO</STMTTRN>", "</BANKTRANLIST>",
  ].join("\n"));
}
