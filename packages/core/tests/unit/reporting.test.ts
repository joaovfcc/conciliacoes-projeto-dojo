import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { generateXlsx } from "../../src/reporting";
import type { ProcessingResult } from "../../src/types";

describe("exportação XLSX", () => {
  it("gera as treze abas auditáveis e neutraliza fórmulas do conteúdo", async () => {
    const result: ProcessingResult = {
      company: "EMPRESA",
      branch: "01",
      period: "202601",
      executedAt: "2026-01-31T12:00:00.000Z",
      summaries: [{ ledgerAccount: "111", statementAccounts: ["ITAU 1/2"], ledgerBalance: "1.00", statementBalance: "0.00", balanceDifference: "1.00", reconciledCount: 0, reconciledValue: "0.00", divergenceCount: 0, ledgerWithoutStatementCount: 1, statementWithoutLedgerCount: 0, ambiguityCount: 0, duplicateCount: 0, status: "COM_DIVERGENCIAS" }],
      results: [{ id: "REC-1", status: "LEDGER_WITHOUT_STATEMENT", rule: "RULE_7_LEDGER_WITHOUT_STATEMENT", decisionLevel: "REVIEW_REQUIRED", reason: "Sem par.", valueTolerance: "0.01", ledger: { id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-01", document: "1", history: "=HYPERLINK(\"https://invalid\")", value: "1.00", sourceId: "l1", evidence: { fileId: "f1", originalName: "razao.csv", extractionMethod: "TABULAR", line: 2 } } }],
      issues: [],
      files: [{ fileId: "statement-file", originalName: "extrato.pdf", bank: "ITAU", agency: "1234", account: "5678-9", periods: ["202601"], recordCount: 2, extractionMethod: "TEXT", parser: "ITAU_CC_V1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true, balanceCheck: { status: "PASSED", openingBalance: "100.00", creditTotal: "10.00", debitTotal: "-5.00", movementTotal: "5.00", expectedClosingBalance: "105.00", extractedClosingBalance: "105.00", difference: "0.00", tolerance: "0.01" } }],
      investments: [{ id: "inv-1", fileId: "investment-file", originalName: "investimento.pdf", bank: "ITAU", agency: "1234", account: "5678-9", date: "2026-01-31", kind: "POSITION", amount: "10.00", description: "Saldo final", evidence: { fileId: "investment-file", originalName: "investimento.pdf", extractionMethod: "TEXT", page: 1, parser: "TEST" } }],
    };
    const buffer = await generateXlsx(result);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumo", "Controles_de_Integridade", "Conciliados_Automaticos", "Sugestoes", "Divergencias",
      "Razao_Sem_Extrato", "Extrato_Sem_Razao", "Ambiguidades", "Duplicidades", "Documentos_Processados",
      "Documentos_Bloqueados", "Investimentos_Posicoes", "Erros_Tecnicos",
    ]);
    expect(workbook.getWorksheet("Razao_Sem_Extrato")?.getCell("I2").value).toBe("'=HYPERLINK(\"https://invalid\")");
    expect(workbook.getWorksheet("Investimentos_Posicoes")?.getCell("A2").value).toBe("investimento.pdf");
    expect(workbook.getWorksheet("Investimentos_Posicoes")?.getCell("G2").value).toBe(10);
    const documents = workbook.getWorksheet("Documentos_Processados")!;
    expect(documents.getRow(1).values).toContain("Saldo final calculado");
    expect(documents.getRow(1).values).toContain("Status de saldo");
    expect(documents.getCell("P2").value).toBe(105);
  });
});
