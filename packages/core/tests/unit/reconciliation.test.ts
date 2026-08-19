import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/reconciliation.js";
import type { ConfirmProcessingRequest, LedgerRecord, StatementRecord } from "../../src/types.js";

const evidence = { fileId: "ledger-file", originalName: "razao.xlsx", extractionMethod: "TABULAR" as const };
const confirmation: ConfirmProcessingRequest = {
  company: "EMPRESA",
  branch: "01",
  period: "202601",
  valueTolerance: "999.99",
  dateToleranceDays: 0,
  mappings: [{ ledgerAccount: "111", statementFileIds: ["statement-file"], signProfile: "BANK_ASSET" }],
  idempotencyKey: "test",
  evaluatedAt: "2026-01-31T00:00:00.000Z",
};

function ledger(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return { id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-05", document: "10", history: "PIX", value: "100.00", sourceId: "l1", evidence: { ...evidence, line: 7 }, ...overrides };
}

function statement(overrides: Partial<StatementRecord> = {}): StatementRecord {
  return { id: "s1", bank: "BANCO", agency: "0001", bankAccount: "123", date: "2026-01-05", document: "10", history: "PIX", value: "-100.00", sourceId: "s1", evidence: { ...evidence, fileId: "statement-file", originalName: "extrato.pdf", extractionMethod: "TEXT", page: 3 }, ...overrides };
}

describe("fachada de reconciliação", () => {
  it("filtra competência e partições mapeadas antes de chamar o motor", () => {
    const output = reconcile(
      [ledger(), ledger({ id: "l2", ledgerAccount: "222" }), ledger({ id: "l3", date: "2025-12-31" })],
      [statement(), statement({ id: "s2", evidence: { ...statement().evidence, fileId: "other-file" } })],
      confirmation,
    );

    expect(output.results).toContainEqual(expect.objectContaining({ status: "AUTO_MATCH_EXACT" }));
    expect(output.results).toContainEqual(expect.objectContaining({ status: "LEDGER_WITHOUT_STATEMENT", ledger: expect.objectContaining({ id: "l2" }) }));
    expect(output.results).toContainEqual(expect.objectContaining({ status: "STATEMENT_WITHOUT_LEDGER", statement: expect.objectContaining({ id: "s2" }) }));
    expect(output.issues).toContainEqual(expect.objectContaining({ code: "RAZAO_FORA_COMPETENCIA" }));
  });

  it("ignora tolerância monetária pública e exige igualdade estrita em centavos", () => {
    const output = reconcile([ledger()], [statement({ value: "-100.01" })], confirmation);

    expect(output.results.some((item) => item.status.startsWith("AUTO_MATCH"))).toBe(false);
    expect(output.results.map((item) => item.status).sort()).toEqual(["LEDGER_WITHOUT_STATEMENT", "STATEMENT_WITHOUT_LEDGER"]);
  });

  it("normaliza sinais assinados diretamente sem comparar valor absoluto", () => {
    const output = reconcile([ledger({ value: "-100.00" })], [statement({ value: "-100.00" })], confirmation);

    expect(output.results.some((item) => item.status.startsWith("AUTO_MATCH"))).toBe(false);
  });

  it("projeta grupos automáticos e auditoria sem perder os campos públicos antigos", () => {
    const output = reconcile(
      [ledger({ id: "l1", value: "60.00" }), ledger({ id: "l2", value: "40.00", evidence: { ...evidence, line: 8 } })],
      [statement({ value: "-100.00" })],
      confirmation,
    );
    const result = output.results.find((item) => item.status === "AUTO_MATCH_GROUP");

    expect(result).toMatchObject({ decisionLevel: "AUTOMATIC", valueTolerance: "0.00", ruleVersion: "1.0" });
    expect(result?.ledgers?.map((item) => item.id)).toEqual(["l1", "l2"]);
    expect(result?.statement?.id).toBe("s1");
    expect(result?.audit?.differenceCents).toBe("0");
  });

  it("deriva sourceRow de line, page e fallback estável", () => {
    const fallbackStatementEvidence = { fileId: "statement-file", originalName: "extrato.pdf", extractionMethod: "TEXT" as const };
    const first = reconcile(
      [ledger(), ledger({ id: "l2", value: "200.00", evidence: { ...evidence } })],
      [statement(), statement({ id: "s2", value: "-200.00", evidence: fallbackStatementEvidence })],
      confirmation,
    );
    const second = reconcile(
      [ledger({ id: "l2", value: "200.00", evidence: { ...evidence } }), ledger()],
      [statement({ id: "s2", value: "-200.00", evidence: fallbackStatementEvidence }), statement()],
      confirmation,
    );
    const rows = Object.fromEntries(first.reconciliation!.transactions.map((item) => [item.id, item.sourceRow]));

    expect(rows).toMatchObject({ l1: 7, s1: 3 });
    expect(second.reconciliation?.transactions.map((item) => [item.id, item.sourceRow])).toEqual(
      first.reconciliation?.transactions.map((item) => [item.id, item.sourceRow]),
    );
  });

  it("produz resultados idênticos sob permutação das entradas", () => {
    const ledgers = [ledger(), ledger({ id: "l2", value: "200.00" })];
    const statements = [statement(), statement({ id: "s2", value: "-200.00" })];
    const first = reconcile(ledgers, statements, confirmation);
    const second = reconcile([...ledgers].reverse(), [...statements].reverse(), confirmation);

    expect(second.results).toEqual(first.results);
    expect(second.reconciliation).toEqual(first.reconciliation);
  });

  it("produz golden BANK_ASSET com controles consolidados e saldos na ótica bancária", () => {
    const output = reconcile(
      [ledger({ value: "100.00" })],
      [statement({ value: "-100.00" })],
      confirmation,
      {
        ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "BANCO", agency: "0001", bankAccount: "123", recordCount: 1, openingBalance: "500.00", closingBalance: "400.00", balanceMovementEffect: "SUBTRACTS_FROM_BALANCE" }],
        statements: [{ fileId: "statement-file", originalName: "extrato.pdf", bank: "BANCO", agency: "0001", account: "123", periods: ["202601"], recordCount: 1, extractionMethod: "TEXT", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true, openingBalance: "500.00", closingBalance: "400.00" }],
      },
    );

    expect(output.results[0]?.status).toBe("AUTO_MATCH_EXACT");
    expect(output.controls).toMatchObject({
      tolerance: "0.05",
      signProfiles: ["BANK_ASSET"],
      movements: { bankConciliable: "-100.00", ledger: "-100.00", difference: "0.00", status: "PASSED" },
      balances: { bankOpening: "500.00", ledgerOpening: "500.00", openingDifference: "0.00", openingStatus: "PASSED", bankClosing: "400.00", ledgerClosing: "400.00", closingDifference: "0.00", closingStatus: "PASSED" },
      coverage: {
        lines: { covered: "2", total: "2", percentage: "100.00" },
        absoluteValue: { covered: "200.00", total: "200.00", percentage: "100.00" },
        ledger: {
          lines: { covered: "1", total: "1", percentage: "100.00" },
          absoluteValue: { covered: "100.00", total: "100.00", percentage: "100.00" },
        },
        statementOperational: {
          lines: { covered: "1", total: "1", percentage: "100.00" },
          absoluteValue: { covered: "100.00", total: "100.00", percentage: "100.00" },
        },
      },
      countsByStatus: [{ status: "AUTO_MATCH_EXACT", count: "1" }],
      pendingByDate: [],
    });
    expect(JSON.stringify(output)).not.toContain("bigint");
  });

  it("calcula saldos do razão pelas linhas da competência confirmada", () => {
    const liabilityConfirmation = {
      ...confirmation,
      mappings: [{ ...confirmation.mappings[0]!, signProfile: "BANK_LIABILITY" as const }],
    };
    const output = reconcile(
      [
        ledger({ id: "l1", value: "100.00", runningBalance: "-600.00", evidence: { ...evidence, line: 10 } }),
        ledger({ id: "l2", date: "2026-01-31", value: "-50.00", runningBalance: "-550.00", evidence: { ...evidence, line: 20 } }),
      ],
      [statement({ value: "100.00" }), statement({ id: "s2", date: "2026-01-31", value: "-50.00" })],
      liabilityConfirmation,
      {
        ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "BANCO", agency: "0001", bankAccount: "123", recordCount: 2, openingBalance: "-999.00", closingBalance: "-999.00", balanceMovementEffect: "SUBTRACTS_FROM_BALANCE" }],
        statements: [{ fileId: "statement-file", originalName: "extrato.pdf", bank: "BANCO", agency: "0001", account: "123", periods: ["202601"], recordCount: 2, extractionMethod: "TEXT", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true, openingBalance: "500.00", closingBalance: "550.00" }],
      },
    );

    expect(output.controls?.balances).toMatchObject({
      ledgerOpening: "500.00",
      ledgerClosing: "550.00",
      openingDifference: "0.00",
      closingDifference: "0.00",
    });
  });

  it("não considera BANK_NET_ZERO reconciliado na cobertura", () => {
    const output = reconcile(
      [],
      [
        statement({ id: "s1", value: "50.00" }),
        statement({ id: "s2", value: "-50.00" }),
      ],
      confirmation,
    );

    expect(output.results).toContainEqual(expect.objectContaining({ status: "BANK_NET_ZERO" }));
    expect(output.controls?.coverage).toMatchObject({
      lines: { covered: "0", total: "2", percentage: "0.00" },
      absoluteValue: { covered: "0.00", total: "100.00", percentage: "0.00" },
    });
    expect(output.summaries[0]).toMatchObject({
      reconciledCount: 0,
      reconciledValue: "0.00",
      status: "COM_DIVERGENCIAS",
    });
  });

  it("mantém exclusão automática fora da contagem conciliada", () => {
    const output = reconcile(
      [],
      [statement({ history: "APL APLIC AUT MAIS", value: "-100.00" })],
      confirmation,
    );

    expect(output.results).toContainEqual(expect.objectContaining({
      status: "AUTO_APPLICATION_EXCLUDED",
      decisionLevel: "AUTOMATIC",
    }));
    expect(output.summaries[0]).toMatchObject({
      reconciledCount: 0,
      reconciledValue: "0.00",
      status: "COM_DIVERGENCIAS",
    });
  });

  it("soma métricas de âncoras repetidas entre partições", () => {
    const output = reconcile(
      [ledger({ value: "100.00" })],
      [
        statement({ id: "s1", value: "-60.00" }),
        statement({ id: "s2", value: "-40.00" }),
        statement({ id: "s3", value: "-70.00", evidence: { ...statement().evidence, fileId: "statement-file-2" } }),
        statement({ id: "s4", value: "-30.00", evidence: { ...statement().evidence, fileId: "statement-file-2" } }),
      ],
      {
        ...confirmation,
        mappings: [
          { ledgerAccount: "111", statementFileIds: ["statement-file"], signProfile: "BANK_ASSET" },
          { ledgerAccount: "111", statementFileIds: ["statement-file-2"], signProfile: "BANK_ASSET" },
        ],
      },
    );

    expect(output.reconciliation?.metrics.combinationsEvaluated).toBe(2);
    expect(output.reconciliation?.metrics.combinationsEvaluatedByAnchor.l1).toBe(2);
    expect(output.reconciliation?.transactions.filter((transaction) => transaction.id === "l1")).toHaveLength(1);
    const groupedIds = output.reconciliation?.matchGroups.flatMap((group) => [
      ...group.bankTransactionIds,
      ...group.ledgerTransactionIds,
    ]) ?? [];
    expect(new Set(groupedIds).size).toBe(groupedIds.length);
  });

  it("calcula saldos uma vez quando vários extratos usam a mesma conta contábil", () => {
    const output = reconcile(
      [ledger({ value: "100.00" })],
      [
        statement({ id: "s1", value: "-60.00" }),
        statement({ id: "s2", value: "-40.00", evidence: { ...statement().evidence, fileId: "statement-file-2" } }),
      ],
      {
        ...confirmation,
        mappings: [
          { ledgerAccount: "111", statementFileIds: ["statement-file"], signProfile: "BANK_ASSET" },
          { ledgerAccount: "111", statementFileIds: ["statement-file-2"], signProfile: "BANK_ASSET" },
        ],
      },
      {
        ledgerAccounts: [{
          account: "111", company: "EMPRESA", branch: "01", bank: "BANCO", agency: "0001", bankAccount: "123",
          recordCount: 1, openingBalance: "500.00", closingBalance: "400.00", balanceMovementEffect: "SUBTRACTS_FROM_BALANCE",
        }],
        statements: [
          { fileId: "statement-file", originalName: "extrato-1.pdf", bank: "BANCO", agency: "0001", account: "123", periods: ["202601"], recordCount: 1, extractionMethod: "TEXT", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true, openingBalance: "300.00", closingBalance: "240.00" },
          { fileId: "statement-file-2", originalName: "extrato-2.pdf", bank: "BANCO", agency: "0001", account: "456", periods: ["202601"], recordCount: 1, extractionMethod: "TEXT", parser: "TEST", classification: "CURRENT_ACCOUNT", reconciliationEligible: true, openingBalance: "200.00", closingBalance: "160.00" },
        ],
      },
    );

    expect(output.controls?.balances).toMatchObject({
      ledgerOpening: "500.00",
      ledgerClosing: "400.00",
      bankOpening: "500.00",
      bankClosing: "400.00",
      openingStatus: "PASSED",
      closingStatus: "PASSED",
    });
  });

  it("rejeita tolerância de data acima do teto de três dias do PRD", () => {
    expect(() => reconcile([ledger()], [statement()], { ...confirmation, dateToleranceDays: 4 }))
      .toThrow(/entre 0 e 3 dias/);
  });
});
