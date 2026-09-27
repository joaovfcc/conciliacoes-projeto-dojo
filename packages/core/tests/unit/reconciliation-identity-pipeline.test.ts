import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStatement } from "../../src/preflight.js";
import { parseLedger } from "../../src/parsers/ledger.js";
import { preflightFiles } from "../../src/preflight.js";
import { reconcile } from "../../src/reconciliation.js";
import { generateXlsx } from "../../src/reporting.js";
import ExcelJS from "exceljs";
import type { SourceFileInput } from "../../src/parsers/types.js";
import type { ConfirmProcessingRequest } from "../../src/types.js";

const workspaceRoot = resolve(
  process.cwd(),
  process.cwd().endsWith("packages/core") || process.cwd().endsWith("packages\\core") ? "../.." : ".",
);
const stmtPath = resolve(workspaceRoot, "docs/mocks/santander_130002439.xlsx");
const ldgPath = resolve(workspaceRoot, "docs/mocks/1225_11102012_1808_1847.xlsx");

const stmtFile: SourceFileInput = {
  id: "stmt-file-santander",
  originalName: "santander_130002439.xlsx",
  kind: "STATEMENT",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(stmtPath),
};

const ldgFile: SourceFileInput = {
  id: "ldg-file-protheus",
  originalName: "1225_11102012_1808_1847.xlsx",
  kind: "LEDGER",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(ldgPath),
};

describe("Reconciliation Identity Pipeline & Coverage Audit", () => {
  it("1. extracts full 9-digit account 130002439 in statement parser metadata", async () => {
    const parsed = await parseStatement(stmtFile);
    expect(parsed.metadata.bank).toBe("033");
    expect(parsed.metadata.agency).toBe("3377");
    expect(parsed.metadata.account).toBe("130002439");
    expect(parsed.metadata.account).not.toBe("13000243");
    expect(parsed.records.length).toBeGreaterThan(0);
  });

  it("2. extracts full 9-digit bank account 130002439 from ledger header metadata", async () => {
    const parsed = await parseLedger(ldgFile);
    expect(parsed.metadata.ledgerAccount).toBe("11102012");
    expect(parsed.metadata.agency).toBe("3377");
    expect(parsed.metadata.bankAccount).toBe("130002439");
    expect(parsed.metadata.bankAccount).not.toBe("13000243");
  });

  it("3. negative test: verifies that truncated history text in ledger does NOT overwrite official metadata", async () => {
    const parsed = await parseLedger(ldgFile);
    // The raw ledger entry histories in Protheus contain "13000243" (truncated by ERP memo field)
    const hasTruncatedTextInHistory = parsed.records.some((r) => r.history.includes("13000243"));
    expect(hasTruncatedTextInHistory).toBe(true);

    // But the official bank account metadata remains intact as 130002439
    expect(parsed.metadata.bankAccount).toBe("130002439");
    expect(parsed.metadata.bankAccount).not.toBe("13000243");
  });

  it("4. preserves full account 130002439 in preflight bundle", async () => {
    const bundle = await preflightFiles(ldgFile, [stmtFile]);

    // Statement in preflight
    const pfStmt = bundle.preflight.statements.find((s) => s.fileId === stmtFile.id);
    expect(pfStmt).toBeDefined();
    expect(pfStmt?.agency).toBe("3377");
    expect(pfStmt?.account).toBe("130002439");
    expect(pfStmt?.account).not.toBe("13000243");

    // Ledger account in preflight
    const pfLdg = bundle.preflight.ledgerAccounts.find((l) => l.account === "11102012");
    expect(pfLdg).toBeDefined();
    expect(pfLdg?.agency).toBe("3377");
    expect(pfLdg?.bankAccount).toBe("130002439");
    expect(pfLdg?.bankAccount).not.toBe("13000243");
  });

  it("5. executes end-to-end reconciliation and preserves correct coverage metrics", async () => {
    const bundle = await preflightFiles(ldgFile, [stmtFile]);
    const confirmation: ConfirmProcessingRequest = {
      company: bundle.preflight.companies[0] || "",
      branch: bundle.preflight.branches[0] || "",
      period: "202512",
      valueTolerance: "0.01",
      dateToleranceDays: 2,
      mappings: [
        {
          ledgerAccount: "11102012",
          statementFileIds: [stmtFile.id],
          signProfile: "BANK_LIABILITY",
        },
      ],
      idempotencyKey: "test-pipeline-key-1",
    };

    const result = reconcile(bundle.ledgers, bundle.statements, confirmation, bundle.preflight);
    const controls = result.controls;
    expect(controls).toBeDefined();

    // 1. Overall Operational Line Coverage: 4 / 5 = 80.00%
    expect(controls?.coverage.overallOperational?.lines.covered).toBe("4");
    expect(controls?.coverage.overallOperational?.lines.total).toBe("5");
    expect(controls?.coverage.overallOperational?.lines.pending).toBe("1");
    expect(controls?.coverage.overallOperational?.lines.percentage).toBe("80.00");

    // 2. Overall Operational Value Coverage: 2370.00 / 2370.01 = 100.00% (with 0.01 pending)
    expect(controls?.coverage.overallOperational?.absoluteValue.covered).toBe("2370.00");
    expect(controls?.coverage.overallOperational?.absoluteValue.total).toBe("2370.01");
    expect(controls?.coverage.overallOperational?.absoluteValue.pending).toBe("0.01");
    expect(controls?.coverage.overallOperational?.absoluteValue.percentage).toBe("100.00");

    // 3. Ledger Line Coverage: 2 / 3 = 66.67%
    expect(controls?.coverage.ledger?.lines.covered).toBe("2");
    expect(controls?.coverage.ledger?.lines.total).toBe("3");
    expect(controls?.coverage.ledger?.lines.pending).toBe("1");
    expect(controls?.coverage.ledger?.lines.percentage).toBe("66.67");

    // 4. Statement Operational Line Coverage: 2 / 2 = 100.00%
    expect(controls?.coverage.statementOperational?.lines.covered).toBe("2");
    expect(controls?.coverage.statementOperational?.lines.total).toBe("2");
    expect(controls?.coverage.statementOperational?.lines.pending).toBe("0");
    expect(controls?.coverage.statementOperational?.lines.percentage).toBe("100.00");

    // 5. Statement Total Line Coverage: 2 / 4 = 50.00%
    expect(controls?.coverage.statementTotal?.lines.covered).toBe("2");
    expect(controls?.coverage.statementTotal?.lines.total).toBe("4");
    expect(controls?.coverage.statementTotal?.lines.percentage).toBe("50.00");

    // 6. Backwards compatibility check
    expect(controls?.coverage.lines.percentage).toBe("80.00");
    expect(controls?.coverage.absoluteValue.covered).toBe("2370.00");

    // 7. Auto application classification
    const autoApps = result.results.filter((r) => r.status === "AUTO_APPLICATION_EXCLUDED");
    expect(autoApps.length).toBe(2);

    // 8. Exact match classification
    const exacts = result.results.filter((r) => r.status === "AUTO_MATCH_EXACT");
    expect(exacts.length).toBe(2);

    // 9. Ledger pending line R$ 0.01
    const pendingLedger = result.results.filter((r) => r.status === "LEDGER_WITHOUT_STATEMENT");
    expect(pendingLedger.length).toBe(1);
    expect(pendingLedger[0]?.ledger?.value).toBe("0.01");
  });

  it("6. validates that the exported XLSX report preserves full formulas and metrics", async () => {
    const bundle = await preflightFiles(ldgFile, [stmtFile]);
    const confirmation: ConfirmProcessingRequest = {
      company: bundle.preflight.companies[0] || "",
      branch: bundle.preflight.branches[0] || "",
      period: "202512",
      valueTolerance: "0.01",
      dateToleranceDays: 2,
      mappings: [
        {
          ledgerAccount: "11102012",
          statementFileIds: [stmtFile.id],
          signProfile: "BANK_LIABILITY",
        },
      ],
      idempotencyKey: "test-pipeline-key-2",
    };

    const result = reconcile(bundle.ledgers, bundle.statements, confirmation, bundle.preflight);
    const buffer = await generateXlsx(result);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const sheet = workbook.getWorksheet("Cobertura e status");
    expect(sheet).toBeDefined();

    const rows: string[][] = [];
    sheet?.eachRow((row) => {
      rows.push(row.values ? (row.values as unknown[]).slice(1).map(String) : []);
    });

    // Check rows and formulas
    expect(rows.some((r) => r[0] === "Cobertura geral operacional" && r[4] === "80.00%")).toBe(true);
    expect(rows.some((r) => r[0] === "Cobertura do razão" && r[4] === "66.67%")).toBe(true);
    expect(rows.some((r) => r[0] === "Cobertura do extrato operacional" && r[4] === "100.00%")).toBe(true);
    expect(rows.some((r) => r[0] === "Cobertura do extrato total" && r[4] === "50.00%")).toBe(true);
  });
});
