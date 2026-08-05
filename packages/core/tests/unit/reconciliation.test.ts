import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { reconcile, resolveGloballyForcedPairs } from "../../src/reconciliation";
import type { ConfirmProcessingRequest, LedgerRecord, StatementRecord } from "../../src/types";

const evidence = { fileId: "ledger-file", originalName: "razao.xlsx", extractionMethod: "TABULAR" as const };
const confirmation: ConfirmProcessingRequest = {
  company: "EMPRESA",
  branch: "01",
  period: "202601",
  valueTolerance: "0.01",
  dateToleranceDays: 2,
  mappings: [{ ledgerAccount: "111", statementFileIds: ["statement-file"], signProfile: "BANK_ASSET" }],
  idempotencyKey: "test",
};

function ledger(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return { id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-05", document: "10", history: "PIX", value: "100.00", sourceId: "l1", evidence, ...overrides };
}

function statement(overrides: Partial<StatementRecord> = {}): StatementRecord {
  return { id: "s1", bank: "ITAU", agency: "0001", bankAccount: "123", date: "2026-01-05", document: "10", history: "PIX", value: "100.00", sourceId: "s1", evidence: { ...evidence, fileId: "statement-file", originalName: "extrato.pdf", extractionMethod: "TEXT" }, ...overrides };
}

describe("reconcile", () => {
  it("aceita pares que são obrigatórios na associação máxima global", () => {
    expect(resolveGloballyForcedPairs(["l1", "l2"], ["s1", "s2"], [["l1", "s1"], ["l1", "s2"], ["l2", "s2"]])).toEqual([
      ["l1", "s1"],
      ["l2", "s2"],
    ]);
  });

  it("não escolhe arbitrariamente quando duas associações máximas existem", () => {
    expect(resolveGloballyForcedPairs(["l1", "l2"], ["s1", "s2"], [["l1", "s1"], ["l1", "s2"], ["l2", "s1"], ["l2", "s2"]])).toEqual([]);
  });

  it("preserva idempotência, permutação e não reutilização em grafos de candidatos", () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 })), { selector: ([left, right]) => `${left}:${right}` }),
      (edges) => {
        const pairs = edges.map(([left, right]) => [`l${left}`, `s${right}`] as [string, string]);
        const first = resolveGloballyForcedPairs(["l0", "l1", "l2", "l3"], ["s0", "s1", "s2", "s3"], pairs);
        const second = resolveGloballyForcedPairs(["l3", "l2", "l1", "l0"], ["s3", "s2", "s1", "s0"], [...pairs].reverse());

        expect(second).toEqual(first);
        expect(new Set(first.map(([left]) => left)).size).toBe(first.length);
        expect(new Set(first.map(([, right]) => right)).size).toBe(first.length);
      },
    ), { numRuns: 200 });
  });

  it("concilia automaticamente somente um candidato exato da conta mapeada", () => {
    const output = reconcile([ledger()], [statement()], confirmation);

    expect(output.results).toContainEqual(expect.objectContaining({ status: "AUTO_MATCH_EXACT", decisionLevel: "AUTOMATIC" }));
    expect(output.summaries[0]?.reconciledCount).toBe(1);
  });

  it("trata igualdade isolada de valor como sugestão, nunca como conciliação automática", () => {
    const output = reconcile([ledger()], [statement({ document: "999", date: "2026-01-29" })], confirmation);

    expect(output.results).toContainEqual(expect.objectContaining({ status: "VALUE_ONLY_SUGGESTION", decisionLevel: "REVIEW_REQUIRED" }));
    expect(output.results.some((item) => item.status.startsWith("AUTO_MATCH"))).toBe(false);
  });

  it("mantém candidatos de mesmo valor como ambiguidade em vez de escolher o primeiro", () => {
    const output = reconcile([ledger()], [statement(), statement({ id: "s2", evidence: { ...evidence, fileId: "statement-file", originalName: "extrato-2.pdf", extractionMethod: "TEXT" } })], confirmation);

    expect(output.results).toContainEqual(expect.objectContaining({ status: "AMBIGUOUS_MATCH" }));
    expect(output.results.some((item) => item.status.startsWith("AUTO_MATCH"))).toBe(false);
  });

  it("não compara débito com crédito pelo valor absoluto", () => {
    const output = reconcile([ledger()], [statement({ value: "-100.00" })], confirmation);

    expect(output.results).toContainEqual(expect.objectContaining({ status: "VALUE_DIVERGENCE" }));
    expect(output.results.some((item) => item.status.startsWith("AUTO_MATCH"))).toBe(false);
  });

  it("não permite que um extrato mapeado para outra conta contábil participe da partição", () => {
    const output = reconcile(
      [ledger(), ledger({ id: "l2", ledgerAccount: "222", document: "20", value: "200.00" })],
      [statement(), statement({ id: "s2", document: "20", value: "200.00" })],
      confirmation,
    );

    expect(output.results.filter((item) => item.status.startsWith("AUTO_MATCH"))).toHaveLength(1);
    expect(output.results).toContainEqual(expect.objectContaining({ status: "LEDGER_WITHOUT_STATEMENT", ledger: expect.objectContaining({ id: "l2" }) }));
  });

  it("produz decisões estáveis quando as entradas são permutadas", () => {
    const ledgers = [ledger({ id: "l2", document: "20", value: "200.00" }), ledger({ id: "l1" })];
    const statements = [statement({ id: "s2", document: "20", value: "200.00" }), statement({ id: "s1" })];
    const first = reconcile(ledgers, statements, confirmation);
    const second = reconcile([...ledgers].reverse(), [...statements].reverse(), confirmation);

    expect(second.results.map((item) => [item.id, item.status])).toEqual(first.results.map((item) => [item.id, item.status]));
  });
});
