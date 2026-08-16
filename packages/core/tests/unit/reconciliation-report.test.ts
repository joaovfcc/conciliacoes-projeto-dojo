import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { generateReconciliationRunXlsx, summarizeReconciliationRun, type ReconciliationRun } from "../../src/index.js";

describe("BR-10/BR-11/BR-13 — relatório auditável", () => {
  it("usa a mesma execução e apresenta todos os valores categóricos em português", async () => {
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
        {
          id: "bank-net-zero-1",
          reconciliationRunId: "run-1",
          ruleId: "RULE_8_BANK_NET_ZERO",
          cardinality: "ONE_TO_MANY",
          confidence: 1,
          matchedStatementIds: ["statement-4", "statement-5"],
          matchedLedgerIds: [],
          amountDifference: "0.00" as NonNullable<ReconciliationRun["matchGroups"][number]["amountDifference"]>,
          status: "AUTO_CONFIRMED",
          createdAt: now,
        },
        {
          id: "rejected-1",
          reconciliationRunId: "run-1",
          ruleId: "RULE_4_GROUPING",
          cardinality: "ONE_TO_MANY",
          confidence: 0.5,
          matchedStatementIds: ["statement-6"],
          matchedLedgerIds: ["ledger-6", "ledger-7"],
          amountDifference: "0.00" as NonNullable<ReconciliationRun["matchGroups"][number]["amountDifference"]>,
          status: "REJECTED",
          createdAt: now,
        },
        {
          id: "rejected-bank-net-zero-1",
          reconciliationRunId: "run-1",
          ruleId: "RULE_8_BANK_NET_ZERO",
          cardinality: "ONE_TO_MANY",
          confidence: 1,
          matchedStatementIds: ["statement-7", "statement-8"],
          matchedLedgerIds: [],
          amountDifference: "0.00" as NonNullable<ReconciliationRun["matchGroups"][number]["amountDifference"]>,
          status: "REJECTED",
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
      "Conciliações",
      "Compensados no extrato",
      "Sugestões",
      "Exceções",
      "Evidências",
      "Auditoria",
    ]);
    expect(workbook.getWorksheet("Resumo")?.getCell("B6").value).toBe("Em preparação");
    expect(workbook.getWorksheet("Conciliações")?.getCell("B2").value).toBe("Regra 1 — documento, data e valor exatos");
    expect(workbook.getWorksheet("Conciliações")?.getCell("C2").value).toBe("Um para um");
    expect(workbook.getWorksheet("Conciliações")?.getCell("J2").value).toBe("Confirmada automaticamente");
    expect(workbook.getWorksheet("Conciliações")?.rowCount).toBe(2);
    expect(workbook.getWorksheet("Compensados no extrato")?.getCell("A2").value).toBe("bank-net-zero-1");
    expect(workbook.getWorksheet("Compensados no extrato")?.rowCount).toBe(2);
    expect(workbook.getWorksheet("Sugestões")?.getCell("H2").value).toBe("Sugerida para revisão");
    expect(workbook.getWorksheet("Exceções")?.getCell("B2").value).toBe("Possível conciliação");
    expect(workbook.getWorksheet("Exceções")?.getCell("C2").value).toBe("Aberta");
    expect(workbook.getWorksheet("Exceções")?.getCell("G2").value).toBe("'=HYPERLINK(\"https://invalid\")");
  });
});
