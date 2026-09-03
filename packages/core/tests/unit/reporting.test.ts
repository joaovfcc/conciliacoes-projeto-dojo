import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { generateXlsx } from "../../src/reporting";
import type { ProcessingResult } from "../../src/types";

describe("exportação XLSX", () => {
  it("gera as abas públicas em português, traduz os valores exibidos e neutraliza fórmulas", async () => {
    const result: ProcessingResult = {
      company: "EMPRESA",
      branch: "01",
      period: "202601",
      executedAt: "2026-01-31T12:00:00.000Z",
      summaries: [{ ledgerAccount: "111", statementAccounts: ["ITAU 1/2"], ledgerBalance: "1.00", statementBalance: "0.00", balanceDifference: "1.00", reconciledCount: 0, reconciledValue: "0.00", divergenceCount: 0, ledgerWithoutStatementCount: 1, statementWithoutLedgerCount: 0, ambiguityCount: 0, duplicateCount: 0, status: "COM_DIVERGENCIAS" }],
      results: [{ id: "REC-1", status: "LEDGER_WITHOUT_STATEMENT", rule: "RULE_7_LEDGER_WITHOUT_STATEMENT", decisionLevel: "REVIEW_REQUIRED", reason: "Sem par.", valueTolerance: "0.01", ledger: { id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-01", document: "1", history: "=HYPERLINK(\"https://invalid\")", value: "1.00", sourceId: "l1", evidence: { fileId: "f1", originalName: "razao.csv", extractionMethod: "TABULAR", line: 2 } } }],
      issues: [{ severity: "ERROR", code: "LAYOUT_NOT_DETECTED", message: "Não foi possível identificar o leiaute.", fileId: "statement-file" }],
      files: [{ fileId: "statement-file", originalName: "extrato.pdf", bank: "ITAU", agency: "1234", account: "5678-9", periods: ["202601"], recordCount: 2, extractionMethod: "TEXT", parser: "ITAU_CC_V1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true, balanceCheck: { status: "PASSED", openingBalance: "100.00", creditTotal: "10.00", debitTotal: "-5.00", movementTotal: "5.00", expectedClosingBalance: "105.00", extractedClosingBalance: "105.00", difference: "0.00", tolerance: "0.01" } }],
      investments: [{ id: "inv-1", fileId: "investment-file", originalName: "investimento.pdf", bank: "ITAU", agency: "1234", account: "5678-9", date: "2026-01-31", kind: "POSITION", amount: "10.00", description: "Saldo final", evidence: { fileId: "investment-file", originalName: "investimento.pdf", extractionMethod: "TEXT", page: 1, parser: "TEST" } }],
      controls: {
        tolerance: "0.05",
        signProfiles: ["BANK_ASSET"],
        movements: { bankConciliable: "0.00", ledger: "-1.00", difference: "1.00", status: "FAILED" },
        balances: { openingStatus: "NOT_AVAILABLE", closingStatus: "NOT_AVAILABLE" },
        coverage: { lines: { covered: "0", total: "1", percentage: "0.00" }, absoluteValue: { covered: "0.00", total: "1.00", percentage: "0.00" } },
        countsByStatus: [{ status: "LEDGER_WITHOUT_STATEMENT", count: "1" }],
        pendingByDate: [{ date: "2026-01-01", bankCount: "0", ledgerCount: "1", bankValue: "0.00", ledgerValue: "-1.00", difference: "1.00" }],
      },
    };
    const buffer = await generateXlsx(result);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumo", "Controles consolidados", "Cobertura e status", "Pendências por data", "Controles de integridade",
      "Conciliações automáticas", "Conciliações proximidade", "Conciliações em grupo", "Totais diários", "Compensados no extrato", "Aplicações automáticas", "Sugestões de agrupamento", "Sugestões", "Divergências",
      "Razão sem extrato", "Extrato sem razão", "Ambiguidades", "Duplicidades", "Documentos processados",
      "Documentos bloqueados", "Investimentos e posições", "Erros técnicos", "Auditoria do motor",
    ]);
    const withoutStatement = workbook.getWorksheet("Razão sem extrato")!;
    expect(withoutStatement.getCell("B2").value).toBe("Lançamento do razão sem correspondente no extrato");
    expect(withoutStatement.getCell("C2").value).toBe("Revisão necessária");
    expect(withoutStatement.getCell("D2").value).toBe("Regra 7 — lançamento do razão sem correspondente no extrato");
    expect(withoutStatement.getCell("O2").value).toBe("'=HYPERLINK(\"https://invalid\")");
    expect(workbook.getWorksheet("Investimentos e posições")?.getCell("F2").value).toBe("Posição final");
    expect(workbook.getWorksheet("Investimentos e posições")?.getCell("G2").value).toBe(10);
    const documents = workbook.getWorksheet("Documentos processados")!;
    expect(documents.getRow(1).values).toContain("Saldo final calculado");
    expect(documents.getRow(1).values).toContain("Status de saldo");
    expect(documents.getCell("E2").value).toBe("Conta-corrente");
    expect(documents.getCell("H2").value).toBe("Texto do documento");
    expect(documents.getCell("R2").value).toBe("Aprovado");
    expect(documents.getCell("P2").value).toBe(105);
    const controls = workbook.getWorksheet("Controles de integridade")!;
    expect(controls.getCell("A2").value).toBe("Erro");
    expect(controls.getCell("B2").value).toBe("Leiaute não identificado");
    expect(JSON.stringify(workbook.worksheets.flatMap((sheet) => sheet.getSheetValues()))).not.toContain("LAYOUT_NOT_DETECTED");
    expect(workbook.getWorksheet("Controles consolidados")?.getCell("F2").value).toBe("Reprovado");
    expect(workbook.getWorksheet("Pendências por data")?.getCell("F2").value).toBe(1);
  });

  it("expande grupos, registra ressalva de lote diário e auditoria", async () => {
    const baseEvidence = { fileId: "f", originalName: "origem.xlsx", extractionMethod: "TABULAR" as const, line: 2 };
    const ledgers = [
      { id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02", document: "", history: "A", value: "-6.00", sourceId: "l1", evidence: baseEvidence },
      { id: "l2", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02", document: "", history: "B", value: "-4.00", sourceId: "l2", evidence: { ...baseEvidence, line: 3 } },
    ];
    const statements = [{ id: "s1", bank: "ITAU", agency: "1", bankAccount: "2", date: "2026-01-02", document: "", history: "LOTE", value: "-10.00", sourceId: "s1", evidence: baseEvidence }];
    const result = {
      company: "EMPRESA", branch: "01", period: "202601", executedAt: "2026-01-31T00:00:00.000Z", summaries: [], issues: [], files: [], investments: [],
      controls: { tolerance: "0.05", signProfiles: ["BANK_ASSET"], movements: { bankConciliable: "-10.00", ledger: "-10.00", difference: "0.00", status: "PASSED" }, balances: { openingStatus: "NOT_AVAILABLE", closingStatus: "NOT_AVAILABLE" }, coverage: { lines: { covered: "3", total: "3", percentage: "100.00" }, absoluteValue: { covered: "20.00", total: "20.00", percentage: "100.00" } }, countsByStatus: [{ status: "AUTO_MATCH_DAILY_TOTAL", count: "1" }], pendingByDate: [] },
      results: [{ id: "g1", status: "AUTO_MATCH_DAILY_TOTAL", rule: "RF-07", decisionLevel: "AUTOMATIC", reason: "Lote fecha.", valueTolerance: "0.00", ledgers, statements, ledger: ledgers[0]!, statement: statements[0]!, ruleVersion: "1.0", matchGroup: { id: "g1", ruleId: "RF-07", ruleVersion: "1.0", type: "daily-total", bankTransactionIds: ["s1"], ledgerTransactionIds: ["l1", "l2"], bankTotalCents: "-1000", ledgerTotalCents: "-1000", differenceCents: "0", status: "automatic", evaluatedAt: "2026-01-31T00:00:00.000Z" } }],
      reconciliation: { ruleVersion: "1.0", evaluatedAt: "2026-01-31T00:00:00.000Z", transactions: [], matchGroups: [], metrics: { combinationsEvaluated: 0, combinationsEvaluatedByAnchor: {} }, audit: [{ id: "a1", ruleId: "RF-07", ruleVersion: "1.0", transactionIds: ["s1", "l1", "l2"], bankTransactionIds: ["s1"], ledgerTransactionIds: ["l1", "l2"], bankTotalCents: "-1000", ledgerTotalCents: "-1000", differenceCents: "0", outcome: "RECONCILED_DAILY_TOTAL", evaluatedAt: "2026-01-31T00:00:00.000Z" }] },
    } satisfies ProcessingResult;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateXlsx(result) as unknown as ExcelJS.Buffer);

    expect(workbook.getWorksheet("Totais diários")?.rowCount).toBe(4);
    expect(workbook.getWorksheet("Totais diários")?.getCell("F2").value).toContain("não implica pareamento individual");
    expect(workbook.getWorksheet("Auditoria do motor")?.getCell("B2").value).toContain("total diário");
  });
});
