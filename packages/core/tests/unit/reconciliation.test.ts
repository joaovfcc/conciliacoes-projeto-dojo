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

  it("concilia valor único dentro da competência mesmo quando as datas são diferentes", () => {
    const output = reconcile(
      [ledger({ id: "l-valor-unico", date: "2026-01-01" })],
      [statement({ id: "s-valor-unico", date: "2026-01-31" })],
      confirmation,
    );

    expect(output.results).toContainEqual(expect.objectContaining({
      status: "AUTO_MATCH_UNIQUE_VALUE",
      ledger: expect.objectContaining({ id: "l-valor-unico" }),
      statement: expect.objectContaining({ id: "s-valor-unico" }),
    }));
    expect(output.controls.coverage.overallOperational).toMatchObject({
      lines: { covered: "2", total: "2", pending: "0", percentage: "100.00" },
      absoluteValue: { covered: "200.00", total: "200.00", pending: "0.00", percentage: "100.00" },
    });
  });

  it("mantém valores repetidos como ambiguidade, sem escolher pares automaticamente", () => {
    const output = reconcile(
      [
        ledger({ id: "l-duplicado-1", value: "100.00", history: "BAIXA TIT. A" }),
        ledger({ id: "l-duplicado-2", value: "100.00", history: "BAIXA TIT. B", evidence: { ...evidence, line: 8 } }),
      ],
      [
        statement({ id: "s-duplicado-1", value: "-100.00", history: "PAGAMENTO A" }),
        statement({ id: "s-duplicado-2", value: "-100.00", history: "PAGAMENTO B", evidence: { ...evidence, fileId: "statement-file", page: 4 } }),
      ],
      confirmation,
    );

    expect(output.results).toHaveLength(4);
    expect(output.results.every((item) => item.status === "AMBIGUOUS_MATCH")).toBe(true);
    expect(new Set(output.results.map((item) => item.ambiguityGroup?.id)).size).toBe(1);
    expect(output.results[0]?.ambiguityGroup).toMatchObject({
      ledgerCandidateIds: ["l-duplicado-1", "l-duplicado-2"],
      statementCandidateIds: ["s-duplicado-1", "s-duplicado-2"],
    });
    expect(output.results.filter((item) => item.ledger).every((item) => item.candidates?.map((candidate) => candidate.id).join(",") === "s-duplicado-1,s-duplicado-2")).toBe(true);
    expect(output.summaries[0]?.reconciledCount).toBe(0);
    expect(output.controls.countsByStatus).toContainEqual({ status: "AMBIGUOUS_MATCH", count: "4" });
  });

  it("sugere grupos determinísticos sem incluí-los nos totais automáticos", () => {
    const output = reconcile(
      [
        ledger({ id: "l1", value: "60.00", history: "BAIXA TIT. fornecedor A" }),
        ledger({ id: "l2", value: "40.00", history: "BAIXA TIT. fornecedor B", evidence: { ...evidence, line: 8 } }),
      ],
      [statement({ value: "-100.00", history: "PAGAMENTO FORNECEDORES" })],
      confirmation,
    );
    const result = output.results.find((item) => item.status === "GROUP_SUGGESTION");

    expect(result).toMatchObject({ decisionLevel: "REVIEW_REQUIRED", valueTolerance: "0.00", ruleVersion: "1.0" });
    expect(result?.ledgers?.map((item) => item.id)).toEqual(["l1", "l2"]);
    expect(result?.statement?.id).toBe("s1");
    expect(result?.matchGroup?.differenceCents).toBe("0");
    expect(output.summaries[0]?.reconciledCount).toBe(0);
    expect(output.results.map((item) => item.status)).toEqual(["GROUP_SUGGESTION"]);
    expect(output.controls.coverage.suggested?.overallOperational.lines).toMatchObject({
      covered: "3",
      total: "3",
      percentage: "100.00",
    });
    expect(output.controls.coverage.potential?.overallOperational.lines).toMatchObject({
      covered: "3",
      total: "3",
      pending: "0",
      percentage: "100.00",
    });
    expect(output.controls.pendingByDate).toEqual([]);
    expect(output.results.some((item) => item.status === "AUTO_MATCH_GROUP" || item.status === "AUTO_MATCH_DAILY_TOTAL")).toBe(false);
  });

  it("sugere um pagamento Protheus consolidado em 45 baixas, sem conciliá-lo automaticamente", () => {
    const payments = Array.from({ length: 45 }, (_, index) => ledger({
      id: `baixa-${index + 1}`,
      value: index === 44 ? "2.00" : "1.00",
      history: "BAIXA TIT. lote de pagamento",
      evidence: { ...evidence, line: index + 11 },
    }));
    const output = reconcile(
      payments,
      [statement({ id: "pagamento-consolidado", value: "-46.00", history: "PAGAMENTO FUNCIONARIOS" })],
      confirmation,
    );

    const suggestion = output.results.find((item) => item.status === "GROUP_SUGGESTION");
    expect(suggestion?.matchGroup).toMatchObject({ type: "one-to-many", status: "suggested", bankTotalCents: "-4600", ledgerTotalCents: "-4600" });
    expect(suggestion?.ledgers).toHaveLength(45);
    expect(output.summaries[0]?.reconciledCount).toBe(0);
    expect(output.summaries[0]?.suggestedGroupCount).toBe(1);
    expect(output.summaries[0]?.suggestedLedgerCount).toBe(45);
    expect(output.summaries[0]?.suggestedStatementCount).toBe(1);
    expect(output.results).toHaveLength(1);
    expect(output.controls.coverage.lines.covered).toBe("0");
    expect(output.controls.coverage.suggested?.overallOperational.lines.covered).toBe("46");
    expect(output.controls.coverage.potential?.overallOperational.lines.percentage).toBe("100.00");
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

  it("não procura combinações de grupo entre partições no fluxo automático", () => {
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

    expect(output.reconciliation?.metrics.combinationsEvaluated).toBe(0);
    expect(output.reconciliation?.metrics.combinationsEvaluatedByAnchor.l1).toBeUndefined();
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

  it("concilia automaticamente lançamentos de mesmo valor quando as datas coincidem 1:1, sem cair em ambiguidade", () => {
    const output = reconcile(
      [
        ledger({ id: "l-dia-05", date: "2026-01-05", value: "500.00", history: "PGTO KALUNGA" }),
        ledger({ id: "l-dia-20", date: "2026-01-20", value: "500.00", history: "PGTO POSTO SHELL", evidence: { ...evidence, line: 8 } }),
      ],
      [
        statement({ id: "s-dia-05", date: "2026-01-05", value: "-500.00", history: "KALUNGA COMERCIO" }),
        statement({ id: "s-dia-20", date: "2026-01-20", value: "-500.00", history: "POSTO SHELL BRASIL", evidence: { ...evidence, fileId: "statement-file", page: 4 } }),
      ],
      confirmation,
    );

    expect(output.results).toHaveLength(2);
    expect(output.results.every((item) => item.status === "AUTO_MATCH_EXACT")).toBe(true);
    expect(output.results.find((item) => item.ledger?.id === "l-dia-05")?.statement?.id).toBe("s-dia-05");
    expect(output.results.find((item) => item.ledger?.id === "l-dia-20")?.statement?.id).toBe("s-dia-20");
    expect(output.results.some((item) => item.status === "AMBIGUOUS_MATCH")).toBe(false);
  });

  it("concilia automaticamente lançamentos de mesmo valor na mesma data quando fornecedores distintos identificam cada par", () => {
    const output = reconcile(
      [
        ledger({ id: "l-kalunga", date: "2026-01-05", value: "500.00", history: "PGTO KALUNGA COMERCIO" }),
        ledger({ id: "l-shell", date: "2026-01-05", value: "500.00", history: "PGTO POSTO SHELL", evidence: { ...evidence, line: 8 } }),
      ],
      [
        statement({ id: "s-kalunga", date: "2026-01-05", value: "-500.00", history: "KALUNGA COMERCIO" }),
        statement({ id: "s-shell", date: "2026-01-05", value: "-500.00", history: "POSTO SHELL BRASIL", evidence: { ...evidence, fileId: "statement-file", page: 4 } }),
      ],
      confirmation,
    );

    expect(output.results).toHaveLength(2);
    expect(output.results.every((item) => item.status === "AUTO_MATCH_EXACT")).toBe(true);
    expect(output.results.find((item) => item.ledger?.id === "l-kalunga")?.statement?.id).toBe("s-kalunga");
    expect(output.results.find((item) => item.ledger?.id === "l-shell")?.statement?.id).toBe("s-shell");
    expect(output.results.some((item) => item.status === "AMBIGUOUS_MATCH")).toBe(false);
  });

  it("concilia o par de mesma data e mantém lançamento avulso em outra data como pendência em vez de ambiguidade falsa", () => {
    const output = reconcile(
      [
        ledger({ id: "l-dia-05", date: "2026-01-05", value: "500.00", history: "PGTO KALUNGA" }),
        ledger({ id: "l-dia-20", date: "2026-01-20", value: "500.00", history: "PGTO FORNECEDOR AVULSO", evidence: { ...evidence, line: 8 } }),
      ],
      [
        statement({ id: "s-dia-05", date: "2026-01-05", value: "-500.00", history: "KALUNGA COMERCIO" }),
      ],
      confirmation,
    );

    expect(output.results).toHaveLength(2);
    expect(output.results).toContainEqual(expect.objectContaining({
      status: "AUTO_MATCH_EXACT",
      ledger: expect.objectContaining({ id: "l-dia-05" }),
      statement: expect.objectContaining({ id: "s-dia-05" }),
    }));
    expect(output.results).toContainEqual(expect.objectContaining({
      status: "LEDGER_WITHOUT_STATEMENT",
      ledger: expect.objectContaining({ id: "l-dia-20" }),
    }));
    expect(output.results.some((item) => item.status === "AMBIGUOUS_MATCH")).toBe(false);
  });

  it("bloqueia conciliação automática na mesma data quando os números de documento são divergentes", () => {
    const output = reconcile(
      [ledger({ id: "l-doc-1", date: "2026-01-05", value: "500.00", document: "DOC1111", history: "PGTO FORNECEDOR" })],
      [statement({ id: "s-doc-2", date: "2026-01-05", value: "-500.00", document: "DOC2222", history: "PGTO FORNECEDOR" })],
      confirmation,
    );

    expect(output.results.some((item) => item.status.startsWith("AUTO_MATCH"))).toBe(false);
    expect(output.results.map((item) => item.status).sort()).toEqual(["LEDGER_WITHOUT_STATEMENT", "STATEMENT_WITHOUT_LEDGER"]);
  });
});
