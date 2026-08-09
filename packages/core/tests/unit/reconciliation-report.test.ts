import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { generateReconciliationRunXlsx, summarizeReconciliationRun, type ReconciliationRun } from "../../src/index.js";

describe("BR-10/BR-11/BR-13 — relatório auditável", () => {
  it("usa a mesma execução para resumo, matches, sugestões, exceções e evidências", async () => {
    const now = new Date("2025-12-31T12:00:00.000Z");
    const run: ReconciliationRun = {
      id: "run-1",
      companyId: "company-1",
      profileId: "profile-1",
      periodId: "period-1",
      preparerId: "preparer-1",
      status: "PREPARING",
      createdAt: now,
      updatedAt: now,
      matchGroups: [
        {
          id: "match-1",
          reconciliationRunId: "run-1",
          ruleId: "RULE_1_EXACT",
          cardinality: "ONE_TO_ONE",
          confidence: 1,
          matchedStatementIds: ["statement-1"],
          matchedLedgerIds: ["ledger-1"],
          amountDifference: "0.00" as NonNullable<ReconciliationRun["matchGroups"][number]["amountDifference"]>,
          status: "AUTO_CONFIRMED",
          createdAt: now,
        },
        {
          id: "suggestion-1",
          reconciliationRunId: "run-1",
          ruleId: "RULE_4_GROUPING",
          cardinality: "ONE_TO_MANY",
          confidence: 0.75,
          matchedStatementIds: ["statement-2", "statement-3"],
          matchedLedgerIds: ["ledger-2"],
          amountDifference: "0.00" as NonNullable<ReconciliationRun["matchGroups"][number]["amountDifference"]>,
          status: "SUGGESTED",
          createdAt: now,
        },
      ],
      exceptions: [{
        id: "exception-1",
        reconciliationRunId: "run-1",
        type: "POSSIBLE_MATCH",
        status: "OPEN",
        explanation: "=HYPERLINK(\"https://invalid\")",
        candidateIds: ["statement-2", "statement-3"],
        evidenceIds: ["evidence-1"],
        createdAt: now,
        updatedAt: now,
      }],
    };

    expect(summarizeReconciliationRun(run)).toEqual({
      automaticMatches: 1,
      manualMatches: 0,
      suggestions: 1,
      openExceptions: 1,
      resolvedExceptions: 0,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateReconciliationRunXlsx(run) as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumo",
      "Matches",
      "Sugestoes",
      "Excecoes",
      "Evidencias",
      "Auditoria",
    ]);
    expect(workbook.getWorksheet("Excecoes")?.getCell("G2").value).toBe("'=HYPERLINK(\"https://invalid\")");
  });
});
