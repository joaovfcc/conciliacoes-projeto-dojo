import { describe, expect, it } from "vitest";
import { ReconciliationEngine, type MatchableEntry } from "../../src/index.js";

const ledger = (overrides: Partial<MatchableEntry> = {}): MatchableEntry => ({
  id: "ledger-1",
  date: "2025-12-10",
  amount: "100.00",
  nature: "DEBIT",
  documentNumber: "LEDGER-10",
  description: "PAGAMENTO FORNECEDOR ALFA",
  ...overrides,
});

const statement = (overrides: Partial<MatchableEntry> = {}): MatchableEntry => ({
  id: "statement-1",
  date: "2025-12-10",
  amount: "100.00",
  nature: "DEBIT",
  documentNumber: "BANK-20",
  description: "PAGAMENTO FORNECEDOR ALFA LTDA",
  ...overrides,
});

describe("BR-10 — matching explicável e determinístico", () => {
  it("aplica as passagens exata, tolerância de data e documento ausente em cascata", () => {
    expect(new ReconciliationEngine("0.00", 0).reconcile(
      [ledger()],
      [statement({ documentNumber: "LEDGER-10" })],
    )[0]).toMatchObject({ status: "AUTO_MATCH_EXACT", rule: "RULE_1_EXACT" });
    expect(new ReconciliationEngine("0.00", 2).reconcile(
      [ledger()],
      [statement({ documentNumber: "LEDGER-10", date: "2025-12-12" })],
    )[0]).toMatchObject({ status: "AUTO_MATCH_DATE_TOLERANCE", rule: "RULE_2_DATE_TOLERANCE" });
    const withoutDocument = ledger();
    delete withoutDocument.documentNumber;
    expect(new ReconciliationEngine("0.00", 0).reconcile(
      [withoutDocument],
      [statement()],
    )[0]).toMatchObject({ status: "AUTO_MATCH_VALUE_DATE", rule: "RULE_3_MISSING_DOCUMENT" });
  });

  it("usa descrição somente quando valor, natureza, data e similaridade atendem à política", () => {
    const results = new ReconciliationEngine("0.00", 0, {
      descriptionSimilarityThreshold: 0.7,
      evaluatedAt: "2025-12-31T12:00:00.000Z",
    }).reconcile([ledger()], [statement()]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "AUTO_MATCH_DESCRIPTION", rule: "RULE_3_DESCRIPTION" });
    expect(results[0]?.evidence).toMatchObject({
      amountDifference: "0.00",
      dateDifferenceDays: 0,
      evaluatedAt: "2025-12-31T12:00:00.000Z",
    });
  });

  it("mantém agrupamentos desativados por padrão", () => {
    const results = new ReconciliationEngine("0.00", 0).reconcile(
      [ledger()],
      [statement({ id: "statement-40", amount: "40.00" }), statement({ id: "statement-60", amount: "60.00" })],
    );

    expect(results.some((result) => result.status === "GROUP_SUGGESTION")).toBe(false);
  });

  it("gera 1:N somente como sugestão opt-in e conserva a evidência da cardinalidade", () => {
    const results = new ReconciliationEngine("0.00", 0, { allowOneToMany: true }).reconcile(
      [ledger()],
      [statement({ id: "statement-40", amount: "40.00" }), statement({ id: "statement-60", amount: "60.00" })],
    );
    const suggestion = results.find((result) => result.status === "GROUP_SUGGESTION");

    expect(suggestion?.evidence).toMatchObject({ cardinality: "ONE_TO_MANY", amountDifference: "0.00" });
    expect(suggestion?.statements?.map((item) => item.id)).toEqual(["statement-40", "statement-60"]);
    expect(results.some((result) => result.status.startsWith("AUTO_MATCH_") && result.statements)).toBe(false);
  });

  it("não sugere agrupamento entre naturezas incompatíveis", () => {
    const results = new ReconciliationEngine("0.00", 0, { allowOneToMany: true }).reconcile(
      [ledger()],
      [
        statement({ id: "statement-40", amount: "40.00", nature: "CREDIT" }),
        statement({ id: "statement-60", amount: "60.00", nature: "CREDIT" }),
      ],
    );

    expect(results.some((result) => result.status === "GROUP_SUGGESTION")).toBe(false);
  });

  it("produz identificador estável e diferença monetária decimal exata", () => {
    const engine = new ReconciliationEngine("0.00", 0);
    const differingStatement = statement({ amount: "100.01", documentNumber: "LEDGER-10" });
    const first = engine.reconcile([ledger()], [differingStatement]);
    const second = engine.reconcile([ledger()], [differingStatement]);

    expect(second.map((result) => result.id)).toEqual(first.map((result) => result.id));
    expect(first.find((result) => result.status === "VALUE_DIVERGENCE")?.evidence.amountDifference).toBe("0.01");
  });

  it("distingue ambiguidade, sugestão por valor, divergência de data e itens sem par", () => {
    const ambiguous = new ReconciliationEngine("0.00", 0).reconcile(
      [ledger()],
      [statement({ id: "statement-a" }), statement({ id: "statement-b" })],
    );
    expect(ambiguous.find((result) => result.status === "AMBIGUOUS_MATCH")?.candidates).toHaveLength(2);

    const valueOnly = new ReconciliationEngine("0.00", 0).reconcile(
      [ledger({ date: "2025-12-01" })],
      [statement({ date: "2025-12-20" })],
    );
    expect(valueOnly[0]).toMatchObject({ status: "VALUE_ONLY_SUGGESTION", rule: "RULE_6_VALUE_ONLY" });

    const dateDifference = new ReconciliationEngine("0.00", 1).reconcile(
      [ledger()],
      [statement({ date: "2025-12-20", documentNumber: "LEDGER-10" })],
    );
    expect(dateDifference[0]).toMatchObject({ status: "DATE_DIVERGENCE", rule: "RULE_5_DATE_DIVERGENCE" });

    const unmatched = new ReconciliationEngine("0.00", 0).reconcile(
      [ledger()],
      [statement({ amount: "999.00", date: "2025-12-20" })],
    );
    expect(unmatched.map((result) => result.status)).toEqual([
      "LEDGER_WITHOUT_STATEMENT",
      "STATEMENT_WITHOUT_LEDGER",
    ]);
  });

  it("respeita o limite monetário inclusivo e rejeita descrições abaixo do limiar", () => {
    const withinTolerance = new ReconciliationEngine("0.01", 0).reconcile(
      [ledger()],
      [statement({ amount: "100.01", documentNumber: "LEDGER-10" })],
    );
    expect(withinTolerance[0]?.status).toBe("AUTO_MATCH_EXACT");

    const belowDescription = new ReconciliationEngine("0.00", 0, {
      descriptionSimilarityThreshold: 0.9,
    }).reconcile(
      [ledger({ description: "FORNECEDOR ALFA" })],
      [statement({ description: "CLIENTE BETA" })],
    );
    expect(belowDescription[0]?.status).toBe("VALUE_ONLY_SUGGESTION");
  });

  it("gera sugestões N:1 e N:N somente quando cada opção é habilitada", () => {
    const manyToOne = new ReconciliationEngine("0.00", 0, { allowManyToOne: true }).reconcile(
      [ledger({ id: "ledger-40", amount: "40.00" }), ledger({ id: "ledger-60", amount: "60.00" })],
      [statement()],
    );
    expect(manyToOne.find((result) => result.status === "GROUP_SUGGESTION")?.evidence.cardinality).toBe("MANY_TO_ONE");

    const manyToMany = new ReconciliationEngine("0.00", 0, { allowManyToMany: true }).reconcile(
      [ledger({ id: "ledger-40", amount: "40.00" }), ledger({ id: "ledger-60", amount: "60.00" })],
      [statement({ id: "statement-30", amount: "30.00" }), statement({ id: "statement-70", amount: "70.00" })],
    );
    expect(manyToMany.find((result) => result.status === "GROUP_SUGGESTION")?.evidence.cardinality).toBe("MANY_TO_MANY");
  });
});
