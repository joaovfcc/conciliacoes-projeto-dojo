import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  ImportLedgerUseCase,
  ImportStatementUseCase,
  InMemoryAuditRepository,
  InMemoryEvidenceRepository,
  InMemoryImportBatchRepository,
  InMemoryLedgerRepository,
  InMemoryTransactionRepository,
} from "../../src/index.js";

async function statementBuffer(closingBalance = "590.00"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("lançamentos");
  [
    ["Itaú Empresas"],
    ["Agência: 0191", "Conta: 0026775-6"],
    [],
    ["data", "lançamento", "documento", "valor (R$)", "saldo (R$)"],
    ["02/12/2025", "SALDO ANTERIOR", "", "0.00", "100.00"],
    ["03/12/2025", "TARIFA BANCARIA", "12345", "-10.00", "90.00"],
    ["04/12/2025", "RECEBIMENTO PIX", "54321", "500.00", closingBalance],
  ].forEach((values) => sheet.addRow(values));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("BR-03/BR-04/BR-08 — pipeline de importação", () => {
  it("registra, valida, persiste e audita um extrato Itaú", async () => {
    const transactions = new InMemoryTransactionRepository();
    const batches = new InMemoryImportBatchRepository();
    const audit = new InMemoryAuditRepository();
    const evidences = new InMemoryEvidenceRepository();
    const useCase = new ImportStatementUseCase(transactions, undefined, batches, audit, evidences);

    const result = await useCase.execute({
      companyId: "company-1",
      accountId: "account-1",
      originalName: "extrato.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileBuffer: await statementBuffer(),
      actorId: "preparer-1",
    });

    expect(result.status).toBe("VALIDATED");
    expect(result.transactions).toHaveLength(2);
    expect(transactions.transactions.map((transaction) => transaction.amount)).toEqual(["10.00", "500.00"]);
    expect((await batches.findById(result.importBatchId))?.status).toBe("VALIDATED");
    expect((await audit.list("IMPORT_BATCH", result.importBatchId)).map((event) => event.action)).toContain("IMPORT_VALIDATED");
    expect(await evidences.listByImportBatch(result.importBatchId)).toHaveLength(2);
  });

  it("bloqueia a segunda importação da mesma empresa, conta e hash", async () => {
    const batches = new InMemoryImportBatchRepository();
    const useCase = new ImportStatementUseCase(new InMemoryTransactionRepository(), undefined, batches);
    const input = { companyId: "company-1", accountId: "account-1", originalName: "extrato.xlsx", fileBuffer: await statementBuffer() };
    const first = await useCase.execute(input);
    const duplicate = await useCase.execute(input);
    expect(first.status).toBe("VALIDATED");
    expect(duplicate.status).toBe("REJECTED");
    expect(duplicate.duplicateOf).toBe(first.importBatchId);
    expect(batches.batches.size).toBe(1);
  });

  it("rejeita divergência crítica de saldo sem persistir transações", async () => {
    const transactions = new InMemoryTransactionRepository();
    const useCase = new ImportStatementUseCase(transactions);
    const result = await useCase.execute({
      companyId: "company-1", accountId: "account-1", originalName: "extrato.xlsx",
      fileBuffer: await statementBuffer("600.00"),
    });
    expect(result.status).toBe("REJECTED");
    expect(result.warnings.map((warning) => warning.code)).toContain("BALANCE_INTEGRITY_FAILED");
    expect(transactions.transactions).toHaveLength(0);
  });

  it("não persiste razão enquanto a conta contábil não estiver mapeada", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Razão");
    sheet.addRow(["Data", "Conta", "Histórico", "Valor"]);
    sheet.addRow(["01/12/2025", "11102027", "PAGAMENTO", "-10,00"]);
    const ledgers = new InMemoryLedgerRepository();
    const useCase = new ImportLedgerUseCase(ledgers);
    const result = await useCase.execute({
      companyId: "company-1", originalName: "razao.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
    expect(["NEEDS_MAPPING", "REJECTED"]).toContain(result.status);
    expect(ledgers.entries).toHaveLength(0);
  });
});
