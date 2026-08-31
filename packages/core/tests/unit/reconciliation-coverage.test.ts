import { describe, it, expect } from "vitest";
import { reconcile } from "../../src/reconciliation.js";
import { generateXlsx } from "../../src/reporting.js";
import ExcelJS from "exceljs";
import type { LedgerRecord, StatementRecord, ConfirmProcessingRequest } from "../../src/types.js";

const confirmation: ConfirmProcessingRequest = {
  company: "EMPRESA",
  branch: "01",
  period: "202512",
  valueTolerance: "0.01",
  dateToleranceDays: 2,
  mappings: [
    {
      ledgerAccount: "11102012",
      statementFileIds: ["stmt-1"],
      signProfile: "BANK_LIABILITY",
    },
  ],
  idempotencyKey: "test-coverage-key-1",
};

function ledger(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    id: overrides.id || "ldg-1",
    company: "EMPRESA",
    branch: "01",
    ledgerAccount: "11102012",
    date: "2025-12-08",
    document: "001",
    history: "LANCAMENTO",
    value: "-185.00",
    sourceId: "src-1",
    evidence: {
      fileId: "ldg-file",
      originalName: "razao.xlsx",
      line: 1,
      extractionMethod: "TABULAR",
    },
    ...overrides,
  };
}

function statement(overrides: Partial<StatementRecord> = {}): StatementRecord {
  return {
    id: overrides.id || "stmt-1",
    bank: "033",
    agency: "3377",
    bankAccount: "130002439",
    date: "2025-12-08",
    document: "001",
    history: "MOVIMENTO",
    value: "-185.00",
    sourceId: "src-1",
    evidence: {
      fileId: "stmt-1",
      originalName: "extrato.xlsx",
      line: 1,
      extractionMethod: "TABULAR",
    },
    ...overrides,
  };
}

describe("Reconciliation Coverage Metrics & Automatic Investment Classification", () => {
  // Test case matching the exact Santander mock scenario
  const mockLedgers: LedgerRecord[] = [
    ledger({ id: "l1", date: "2025-12-08", history: "TAR. BANC. - 033 3377 13000243", value: "-185.00" }),
    ledger({ id: "l2", date: "2025-12-26", history: "TRANSF. BANC. - 033 3377 13000243", value: "1000.00" }),
    ledger({ id: "l3", date: "2025-12-29", history: "MOV. BANCARIO 033 3377 13000243", value: "0.01" }),
  ];

  const mockStatements: StatementRecord[] = [
    statement({ id: "s1", date: "2025-12-08", history: "TARIFA MENSALIDADE PACOTE SERVICOS NOVEMBRO / 2025", value: "-185.00" }),
    statement({ id: "s2", date: "2025-12-08", history: "RESGATE CONTAMAX AUTOMATICO", value: "185.00" }),
    statement({ id: "s3", date: "2025-12-26", history: "PIX RECEBIDO 19138940000170", value: "1000.00" }),
    statement({ id: "s4", date: "2025-12-26", history: "APLICACAO CONTAMAX", value: "-1000.00" }),
  ];

  it("1. tracks and explains the old vs new formula", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    const controls = result.controls;
    expect(controls).toBeDefined();

    // Old formula was simply 2 / 4 = 50.00% (statement only)
    // New total statement coverage preserves this as statementTotal
    expect(controls.coverage.statementTotal?.lines.covered).toBe("2");
    expect(controls.coverage.statementTotal?.lines.total).toBe("4");
    expect(controls.coverage.statementTotal?.lines.percentage).toBe("50.00");
  });

  it("2 & 3. calculates ledger coverage as 2/3 (66.67%) with R$ 0.01 pending", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    const ledgerCov = result.controls.coverage.ledger;

    expect(ledgerCov).toBeDefined();
    expect(ledgerCov?.lines.covered).toBe("2");
    expect(ledgerCov?.lines.total).toBe("3");
    expect(ledgerCov?.lines.pending).toBe("1");
    expect(ledgerCov?.lines.percentage).toBe("66.67");

    expect(ledgerCov?.absoluteValue.covered).toBe("1185.00");
    expect(ledgerCov?.absoluteValue.total).toBe("1185.01");
    expect(ledgerCov?.absoluteValue.pending).toBe("0.01");
    expect(ledgerCov?.absoluteValue.percentage).toBe("100.00"); // 99.999% rounded to 100.00%
  });

  it("4. calculates statement operational coverage as 2/2 (100.00%)", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    const opCov = result.controls.coverage.statementOperational;

    expect(opCov).toBeDefined();
    expect(opCov?.lines.covered).toBe("2");
    expect(opCov?.lines.total).toBe("2");
    expect(opCov?.lines.pending).toBe("0");
    expect(opCov?.lines.percentage).toBe("100.00");

    expect(opCov?.absoluteValue.covered).toBe("1185.00");
    expect(opCov?.absoluteValue.total).toBe("1185.00");
    expect(opCov?.absoluteValue.pending).toBe("0.00");
    expect(opCov?.absoluteValue.percentage).toBe("100.00");
  });

  it("5. calculates statement total coverage as 2/4 (50.00%)", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    const stmtTot = result.controls.coverage.statementTotal;

    expect(stmtTot).toBeDefined();
    expect(stmtTot?.lines.covered).toBe("2");
    expect(stmtTot?.lines.total).toBe("4");
    expect(stmtTot?.lines.percentage).toBe("50.00");

    expect(stmtTot?.absoluteValue.covered).toBe("1185.00");
    expect(stmtTot?.absoluteValue.total).toBe("2370.00");
    expect(stmtTot?.absoluteValue.percentage).toBe("50.00");
  });

  it("6. calculates overall operational coverage as 4/5 (80.00%)", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    const overallOp = result.controls.coverage.overallOperational;

    expect(overallOp).toBeDefined();
    // 2 ledger reconciled + 2 operational statement reconciled = 4
    // 3 ledger eligible + 2 operational statement eligible = 5
    expect(overallOp?.lines.covered).toBe("4");
    expect(overallOp?.lines.total).toBe("5");
    expect(overallOp?.lines.pending).toBe("1");
    expect(overallOp?.lines.percentage).toBe("80.00");

    expect(overallOp?.absoluteValue.covered).toBe("2370.00");
    expect(overallOp?.absoluteValue.total).toBe("2370.01");
    expect(overallOp?.absoluteValue.pending).toBe("0.01");
    expect(overallOp?.absoluteValue.percentage).toBe("100.00");
  });

  it("7. uses absolute sum for value coverage, not net sum", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    // Net sum of operational statement is 1000 - 185 = 815, but absolute sum is 1185.00
    expect(result.controls.coverage.statementOperational?.absoluteValue.total).toBe("1185.00");
    expect(result.controls.coverage.ledger?.absoluteValue.total).toBe("1185.01");
  });

  it("8. preserves the R$ 0.01 pending amount in controls and results", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    expect(result.controls.coverage.ledger?.absoluteValue.pending).toBe("0.01");

    const pendingResults = result.results.filter((r) => r.status === "LEDGER_WITHOUT_STATEMENT");
    expect(pendingResults.length).toBe(1);
    expect(pendingResults[0]?.ledger?.value).toBe("0.01");
  });

  it("9 & 10 & 12. classifies RESGATE CONTAMAX and APLICACAO CONTAMAX as EXCLUDED_AUTO_APPLICATION", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    const autoApps = result.results.filter((r) => r.status === "AUTO_APPLICATION_EXCLUDED");

    expect(autoApps.length).toBe(2);
    expect(autoApps.some((a) => a.statement?.history.includes("RESGATE CONTAMAX"))).toBe(true);
    expect(autoApps.some((a) => a.statement?.history.includes("APLICACAO CONTAMAX"))).toBe(true);

    // Exact matches must match the true operational items
    const exacts = result.results.filter((r) => r.status === "AUTO_MATCH_EXACT");
    expect(exacts.length).toBe(2);
    expect(exacts.some((e) => e.statement?.history.includes("TARIFA MENSALIDADE") && e.ledger?.history.includes("TAR. BANC."))).toBe(true);
    expect(exacts.some((e) => e.statement?.history.includes("PIX RECEBIDO") && e.ledger?.history.includes("TRANSF. BANC."))).toBe(true);
  });

  it("13 & 14. ensures coverage.lines and coverage.absoluteValue point to overallOperational for backwards compatibility", () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    expect(result.controls.coverage.lines.percentage).toBe("80.00");
    expect(result.controls.coverage.lines.covered).toBe("4");
    expect(result.controls.coverage.lines.total).toBe("5");
    expect(result.controls.coverage.absoluteValue.covered).toBe("2370.00");
    expect(result.controls.coverage.absoluteValue.total).toBe("2370.01");
  });

  it("15. verifies that the exported XLSX report includes all breakdown metrics and formulas", async () => {
    const result = reconcile(mockLedgers, mockStatements, confirmation);
    const buffer = await generateXlsx(result);
    expect(buffer).toBeDefined();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("Cobertura e status");
    expect(sheet).toBeDefined();

    const rows: string[][] = [];
    sheet?.eachRow((row) => {
      rows.push(row.values ? (row.values as unknown[]).slice(1).map(String) : []);
    });

    expect(rows.some((r) => r[0] === "Cobertura geral operacional" && r[4] === "80.00%")).toBe(true);
    expect(rows.some((r) => r[0] === "Cobertura do razão" && r[4] === "66.67%")).toBe(true);
    expect(rows.some((r) => r[0] === "Cobertura do extrato operacional" && r[4] === "100.00%")).toBe(true);
    expect(rows.some((r) => r[0] === "Cobertura do extrato total" && r[4] === "50.00%")).toBe(true);
  });
});
