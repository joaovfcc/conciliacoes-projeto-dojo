import { describe, expect, it } from "vitest";
import {
  RECONCILIATION_CONFIGURATION_V1,
  ReconciliationEngine,
  normalizeReconciliationText,
  reconciliationTextSimilarity,
  type ReconciliationTransaction,
} from "../../src/index.js";

const evaluatedAt = "2026-08-12T12:00:00.000Z";
const engine = () => new ReconciliationEngine(0, 3, { evaluatedAt });

function transaction(
  id: string,
  source: "BANK" | "LEDGER",
  amountCents: bigint,
  overrides: Partial<ReconciliationTransaction> = {},
): ReconciliationTransaction {
  return {
    id,
    importBatchId: `${source.toLowerCase()}-batch`,
    source,
    accountId: "account-1",
    currency: "BRL",
    sourceRow: Number(id.replace(/\D/g, "")) || 1,
    postingDate: "2025-12-10",
    amountCents,
    description: id,
    evidence: { fileId: `${source.toLowerCase()}.xlsx`, line: 1 },
    ...overrides,
  };
}

function groupsByRule(input: ReconciliationTransaction[], ruleId: string) {
  return engine().run(input).matchGroups.filter((group) => group.ruleId === ruleId);
}

function bruteForceRf03(
  bank: ReconciliationTransaction,
  ledgers: ReconciliationTransaction[],
): { ledgerId?: string; score?: number } {
  const candidates = ledgers
    .filter((ledger) => ledger.amountCents === bank.amountCents
      && ledger.accountId === bank.accountId
      && ledger.currency === bank.currency
      && dateDistance(bank.postingDate, ledger.postingDate) <= 3)
    .map((ledger) => ({
      ledger,
      score: reconciliationTextSimilarity(
        normalizeReconciliationText(bank.description),
        normalizeReconciliationText(ledger.description),
      ),
      distance: dateDistance(bank.postingDate, ledger.postingDate),
    }))
    .sort((left, right) => right.score - left.score
      || left.distance - right.distance
      || left.ledger.sourceRow - right.ledger.sourceRow
      || left.ledger.id.localeCompare(right.ledger.id));
  if (candidates.length === 0) return {};
  if (candidates.length === 1) return { ledgerId: candidates[0]!.ledger.id, score: candidates[0]!.score };
  const [best, second] = candidates;
  if (best!.score < RECONCILIATION_CONFIGURATION_V1.rf03.minimumScore
    || best!.score - second!.score < RECONCILIATION_CONFIGURATION_V1.rf03.minimumMargin) return {};
  return { ledgerId: best!.ledger.id, score: best!.score };
}

function dateDistance(left: string, right: string): number {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("motor PRD v1", () => {
  it("normaliza texto na ordem do PRD e calcula similaridade common/max", () => {
    expect(normalizeReconciliationText("  Pagamento, João 000123; XP SA / pix 25  ")).toEqual(["JOAO", "123"]);
    expect(reconciliationTextSimilarity(["ALFA", "1234"], ["ALFA", "BETA", "1234"])).toBe(2 / 3);
  });

  it("CT-01: concilia 1:1 por data e valor, independentemente de documento", () => {
    const output = engine().run([
      transaction("b1", "BANK", -10_000n, { documentId: "BANK", description: "cliente alfa" }),
      transaction("l1", "LEDGER", -10_000n, { documentId: "LEDGER", description: "outra descricao" }),
    ]);

    expect(output.matchGroups[0]).toMatchObject({ ruleId: "RF-02", type: "exact", differenceCents: "0" });
    expect(output.transactions.every((item) => item.status === "RECONCILED_EXACT")).toBe(true);
  });

  it("CT-02: aceita candidato único de mesmo valor a dois dias", () => {
    expect(groupsByRule([
      transaction("b1", "BANK", 10_000n),
      transaction("l1", "LEDGER", 10_000n, { postingDate: "2025-12-12" }),
    ], "RF-03")).toHaveLength(1);
  });

  it("override legado de zero dias impede RF-03 fora da data exata", () => {
    const output = new ReconciliationEngine(0, 0, { evaluatedAt }).run([
      transaction("b1", "BANK", 10_000n),
      transaction("l1", "LEDGER", 10_000n, { postingDate: "2025-12-11" }),
    ]);

    expect(output.matchGroups).toHaveLength(0);
    expect(output.transactions.map((item) => item.status)).toEqual(["BANK_ONLY", "LEDGER_ONLY"]);
  });

  it("compatibilidade legada respeita a tolerância de data recebida no construtor", () => {
    const ledgers = [{ id: "l1", date: "2025-12-11", amount: "100.00", nature: "DEBIT" as const }];
    const statements = [{ id: "b1", date: "2025-12-10", amount: "100.00", nature: "DEBIT" as const }];

    expect(new ReconciliationEngine(0, 0, { evaluatedAt }).reconcile(ledgers, statements)
      .some((result) => result.status === "AUTO_MATCH_DATE_TOLERANCE")).toBe(false);
    expect(new ReconciliationEngine(0, 1, { evaluatedAt }).reconcile(ledgers, statements))
      .toContainEqual(expect.objectContaining({ status: "AUTO_MATCH_DATE_TOLERANCE" }));
  });

  it("CT-03: mantém proximidade ambígua sem vantagem mínima pendente", () => {
    const output = engine().run([
      transaction("b1", "BANK", 10_000n, { description: "cliente alfa" }),
      transaction("l1", "LEDGER", 10_000n, { postingDate: "2025-12-09", description: "cliente alfa" }),
      transaction("l2", "LEDGER", 10_000n, { postingDate: "2025-12-11", description: "cliente alfa" }),
    ]);

    expect(output.matchGroups).toHaveLength(0);
    expect(output.transactions.map((item) => item.status)).toEqual(["BANK_ONLY", "LEDGER_ONLY", "LEDGER_ONLY"]);
  });

  it("CT-04: concilia principal e juros em 1:2 automaticamente", () => {
    const groups = groupsByRule([
      transaction("b1", "BANK", 110_182n),
      transaction("l1", "LEDGER", 110_181n),
      transaction("l2", "LEDGER", 1n),
    ], "RF-04");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ type: "one-to-many", ledgerTransactionIds: ["l1", "l2"] });
  });

  it("CT-05: rejeita grupo com sinais incompatíveis", () => {
    const output = engine().run([
      transaction("b1", "BANK", 10_000n),
      transaction("l1", "LEDGER", -6_000n),
      transaction("l2", "LEDGER", -4_000n),
    ]);

    expect(output.matchGroups).toHaveLength(0);
  });

  it("concilia o inverso 2:1 pela RF-05", () => {
    const groups = groupsByRule([
      transaction("b1", "BANK", -6_000n),
      transaction("b2", "BANK", -4_000n),
      transaction("l1", "LEDGER", -10_000n),
    ], "RF-05");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ type: "many-to-one", bankTransactionIds: ["b1", "b2"] });
  });

  it("flags desabilitadas impedem RF-04 e RF-05", () => {
    const output = new ReconciliationEngine(0, 3, {
      evaluatedAt,
      allowOneToMany: false,
      allowManyToOne: false,
    }).run([
      transaction("b1", "BANK", 10_000n),
      transaction("b2", "BANK", 7_000n, { postingDate: "2025-12-20" }),
      transaction("b3", "BANK", 3_000n, { postingDate: "2025-12-20" }),
      transaction("l1", "LEDGER", 6_000n),
      transaction("l2", "LEDGER", 4_000n),
      transaction("l3", "LEDGER", 10_000n, { postingDate: "2025-12-20" }),
    ]);

    expect(output.matchGroups.some((group) => group.ruleId === "RF-04" || group.ruleId === "RF-05")).toBe(false);
  });

  it("CT-06: fecha resíduos pelo total diário exato", () => {
    const groups = groupsByRule([
      transaction("b1", "BANK", -6_000n),
      transaction("b2", "BANK", -4_000n),
      transaction("l1", "LEDGER", -7_000n),
      transaction("l2", "LEDGER", -3_000n),
    ], "RF-07");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ type: "daily-total", bankTotalCents: "-10000", ledgerTotalCents: "-10000" });
  });

  it("CT-07: um centavo de diferença impede total diário", () => {
    const output = engine().run([
      transaction("b1", "BANK", -6_000n),
      transaction("b2", "BANK", -4_000n),
      transaction("l1", "LEDGER", -7_000n),
      transaction("l2", "LEDGER", -3_001n),
    ]);

    expect(output.matchGroups).toHaveLength(0);
    expect(output.transactions.every((item) => item.status.endsWith("ONLY"))).toBe(true);
  });

  it("CT-08: segrega aplicação automática antes do matching", () => {
    const output = engine().run([
      transaction("b1", "BANK", -10_000n, { description: "APL APLIC AUT MAIS" }),
      transaction("l1", "LEDGER", -10_000n),
    ]);

    expect(output.transactions.find((item) => item.id === "b1")?.status).toBe("EXCLUDED_AUTO_APPLICATION");
    expect(output.matchGroups).toHaveLength(0);
  });

  it("compatibilidade projeta aplicação automática com extrato e evidência", () => {
    const results = engine().reconcile([], [{
      id: "b1",
      date: "2025-12-10",
      amount: "100.00",
      nature: "DEBIT",
      description: "APL APLIC AUT MAIS",
    }]);

    expect(results).toContainEqual(expect.objectContaining({
      status: "AUTO_APPLICATION_EXCLUDED",
      rule: "RULE_1_AUTO_APPLICATION",
      statement: expect.objectContaining({ id: "b1" }),
      evidence: expect.objectContaining({ statementIds: ["b1"], confidence: 1 }),
    }));
  });

  it("falha no início com mensagem acionável para regex automática inválida", () => {
    const configuration = {
      ...RECONCILIATION_CONFIGURATION_V1,
      automaticApplicationPattern: "[",
    } as unknown as typeof RECONCILIATION_CONFIGURATION_V1;

    expect(() => new ReconciliationEngine(0, 3, { configuration }).run([]))
      .toThrow(/automaticApplicationPattern inválida/);
  });

  it("CT-09: rendimento de aplicação não é segregado", () => {
    const output = engine().run([
      transaction("b1", "BANK", -10_000n, { description: "RENDIMENTOS REND PAGO APLIC AUT MAIS" }),
      transaction("l1", "LEDGER", -10_000n),
    ]);

    expect(output.transactions.find((item) => item.id === "b1")?.status).toBe("RECONCILED_EXACT");
  });

  it("CT-10: classifica movimentos bancários compensados sem razão aberto", () => {
    const output = engine().run([
      transaction("b1", "BANK", 50_000n),
      transaction("b2", "BANK", -50_000n),
    ]);

    expect(output.matchGroups[0]).toMatchObject({ ruleId: "RF-08", type: "bank-net-zero" });
    expect(output.transactions.every((item) => item.status === "BANK_NET_ZERO")).toBe(true);
  });

  it("CT-11: disponibilidade consumida impede dupla conciliação", () => {
    const output = engine().run([
      transaction("b1", "BANK", 10_000n),
      transaction("l1", "LEDGER", 10_000n),
      transaction("l2", "LEDGER", 6_000n),
      transaction("l3", "LEDGER", 4_000n),
    ]);
    const used = output.matchGroups.flatMap((group) => [...group.bankTransactionIds, ...group.ledgerTransactionIds]);

    expect(output.matchGroups).toHaveLength(1);
    expect(new Set(used).size).toBe(used.length);
    expect(output.matchGroups[0]?.ruleId).toBe("RF-02");
  });

  it("CT-12: execuções idênticas são byte a byte reproduzíveis", () => {
    const input = [transaction("b1", "BANK", 10_000n), transaction("l1", "LEDGER", 10_000n)];
    const first = engine().run(input);
    const second = engine().run([...input].reverse());

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.matchGroups[0]?.id).not.toContain(evaluatedAt);
  });

  it("desempata duplicatas exatas por score, sourceRow e id sem bloqueá-las", () => {
    const output = engine().run([
      transaction("b2", "BANK", 10_000n, { sourceRow: 20, description: "CLIENTE BETA 9999" }),
      transaction("b1", "BANK", 10_000n, { sourceRow: 10, description: "CLIENTE ALFA 1234" }),
      transaction("l2", "LEDGER", 10_000n, { sourceRow: 40, description: "CLIENTE BETA 9999" }),
      transaction("l1", "LEDGER", 10_000n, { sourceRow: 30, description: "CLIENTE ALFA 1234" }),
    ]);

    expect(output.matchGroups.map((group) => [group.bankTransactionIds[0], group.ledgerTransactionIds[0]]).sort()).toEqual([
      ["b1", "l1"],
      ["b2", "l2"],
    ]);
  });

  it("RF-06 seleciona grupo pela similaridade e bônus numérico", () => {
    const output = engine().run([
      transaction("b1", "BANK", 10_000n, { description: "FATURA ALFA 1234" }),
      transaction("l1", "LEDGER", 6_000n, { description: "ALFA 1234 PRINCIPAL" }),
      transaction("l2", "LEDGER", 4_000n, { description: "ALFA 1234 JUROS" }),
      transaction("l3", "LEDGER", 7_000n, { description: "BETA 9999" }),
      transaction("l4", "LEDGER", 3_000n, { description: "BETA 9999" }),
    ]);

    expect(output.matchGroups[0]).toMatchObject({ ruleId: "RF-04", ledgerTransactionIds: ["l1", "l2"] });
    expect(output.matchGroups[0]?.score).toBeGreaterThan(1.5);
  });

  it("RF-06 mantém grupos múltiplos ambíguos disponíveis para regras seguintes", () => {
    const output = engine().run([
      transaction("b1", "BANK", 10_000n),
      transaction("l1", "LEDGER", 6_000n),
      transaction("l2", "LEDGER", 4_000n),
      transaction("l3", "LEDGER", 7_000n),
      transaction("l4", "LEDGER", 3_000n),
    ]);

    expect(output.matchGroups).toHaveLength(0);
  });

  it("avalia no máximo 100 combinações financeiras por âncora", () => {
    const input = [transaction("b1", "BANK", 100_000n)];
    for (let index = 1; index <= 101; index += 1) {
      input.push(transaction(`l${index}-a`, "LEDGER", BigInt(index)));
      input.push(transaction(`l${index}-b`, "LEDGER", 100_000n - BigInt(index)));
    }
    const output = engine().run(input);

    expect(output.metrics.combinationsEvaluatedByAnchor.b1).toBe(100);
  });

  it("encontra complemento financeiro sem consumir o limite com duplas que não fecham", () => {
    const input = [transaction("b1", "BANK", 100_000n)];
    for (let index = 1; index <= 16; index += 1) input.push(transaction(`l${index}`, "LEDGER", BigInt(index)));
    input.push(transaction("l-complement-a", "LEDGER", 40_000n));
    input.push(transaction("l-complement-b", "LEDGER", 60_000n));

    const output = engine().run(input);

    expect(output.matchGroups[0]?.ruleId).toBe("RF-04");
    expect(output.matchGroups[0]?.ledgerTransactionIds).toEqual(expect.arrayContaining(["l-complement-a", "l-complement-b"]));
  });

  it("RF-02 seleciona o melhor candidato disponível por âncora bancária", () => {
    const output = engine().run([
      transaction("b1", "BANK", 10_000n, { sourceRow: 1, description: "ALFA BETA" }),
      transaction("b2", "BANK", 10_000n, { sourceRow: 2, description: "ALFA" }),
      transaction("l1", "LEDGER", 10_000n, { sourceRow: 3, description: "ALFA" }),
      transaction("l2", "LEDGER", 10_000n, { sourceRow: 4, description: "GAMA" }),
    ]);

    expect(output.matchGroups.map((group) => [group.bankTransactionIds[0], group.ledgerTransactionIds[0]]).sort()).toEqual([
      ["b1", "l1"],
      ["b2", "l2"],
    ]);
  });

  it("RF-03 avalia assinaturas, não todas as duplicatas concentradas", () => {
    const input: ReconciliationTransaction[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      input.push(transaction(`b${index + 1}`, "BANK", 10_000n, {
        sourceRow: index + 1,
        description: "PAGAMENTO CONCENTRADO 1234",
      }));
      input.push(transaction(`l${index + 1}`, "LEDGER", 10_000n, {
        sourceRow: index + 1,
        postingDate: "2025-12-11",
        description: "PAGAMENTO CONCENTRADO 1234",
      }));
    }

    const output = new ReconciliationEngine(0, 3, {
      evaluatedAt,
      collectPerformanceMetrics: true,
    }).run(input);

    expect(output.matchGroups).toHaveLength(0);
    expect(output.metrics.rf03SignatureGroupsEvaluated).toBe(5_000);
  });

  it("RF-03 resolve pares únicos concentrados por assinatura em trabalho linear", () => {
    const input: ReconciliationTransaction[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      const description = `REFERENCIA COMUM ${index + 10_000}`;
      input.push(transaction(`b${index + 1}`, "BANK", 10_000n, { sourceRow: index + 1, description }));
      input.push(transaction(`l${index + 1}`, "LEDGER", 10_000n, {
        sourceRow: index + 1,
        postingDate: "2025-12-11",
        description,
      }));
    }

    const output = new ReconciliationEngine(0, 3, {
      evaluatedAt,
      collectPerformanceMetrics: true,
    }).run(input);

    expect(output.matchGroups).toHaveLength(5_000);
    expect(output.metrics.rf03SignatureGroupsEvaluated).toBe(5_000);
  });

  it("RF-03 otimizada equivale à seleção exaustiva em casos variados", () => {
    const random = seededRandom(20_260_812);
    const vocabulary = ["ALFA", "BETA", "GAMA", "DELTA", "OMEGA", "1234", "5678"];
    for (let scenario = 0; scenario < 250; scenario += 1) {
      const bankTokens = vocabulary.filter(() => random() < 0.45);
      const bank = transaction(`b${scenario + 1}`, "BANK", 10_000n + BigInt(scenario), {
        postingDate: "2025-12-10",
        description: bankTokens.join(" "),
      });
      const ledgers = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, index) => {
        const tokens = vocabulary.filter(() => random() < 0.45);
        const day = [7, 8, 9, 11, 12, 13][Math.floor(random() * 6)]!;
        return transaction(`l${scenario + 1}-${index + 1}`, "LEDGER", bank.amountCents, {
          sourceRow: 1 + Math.floor(random() * 4),
          postingDate: `2025-12-${String(day).padStart(2, "0")}`,
          description: tokens.join(" "),
        });
      });
      const expected = bruteForceRf03(bank, ledgers);
      const actual = engine().run([bank, ...ledgers]).matchGroups.find((group) => group.ruleId === "RF-03");

      expect(
        actual ? { ledgerId: actual.ledgerTransactionIds[0], score: actual.score } : {},
        `cenário RF-03 ${scenario}`,
      ).toEqual(expected);
    }
  });

  it("processa 100 mil transações concentradas na RF-03 em até 120 segundos", () => {
    const input: ReconciliationTransaction[] = [];
    for (let index = 0; index < 100_000; index += 1) {
      input.push(transaction(`b${index + 1}`, "BANK", 10_000n, {
        sourceRow: index + 1,
        description: "PAGAMENTO CONCENTRADO 1234",
      }));
      input.push(transaction(`l${index + 1}`, "LEDGER", 10_000n, {
        sourceRow: index + 1,
        postingDate: "2025-12-11",
        description: "PAGAMENTO CONCENTRADO 1234",
      }));
    }
    const startedAt = performance.now();
    const output = new ReconciliationEngine(0, 3, {
      evaluatedAt,
      collectPerformanceMetrics: true,
    }).run(input);

    expect(output.matchGroups).toHaveLength(0);
    expect(output.metrics.rf03SignatureGroupsEvaluated).toBe(100_000);
    expect(performance.now() - startedAt).toBeLessThanOrEqual(120_000);
  }, 120_000);

  it("auditoria serializável contém versão, IDs, totais, diferença, score e evaluatedAt", () => {
    const output = engine().run([
      transaction("b1", "BANK", 10_000n),
      transaction("l1", "LEDGER", 10_000n),
    ]);

    expect(output.audit[0]).toMatchObject({
      ruleId: "RF-02",
      ruleVersion: "1.0",
      transactionIds: ["b1", "l1"],
      bankTotalCents: "10000",
      ledgerTotalCents: "10000",
      differenceCents: "0",
      score: 0,
      evaluatedAt,
    });
    expect(() => JSON.stringify(output)).not.toThrow();
  });
});
