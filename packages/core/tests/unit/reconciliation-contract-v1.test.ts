import { describe, expect, it } from "vitest";

import {
  RECONCILIATION_CONTRACT_VERSION_V1,
  ReconciliationContractValidationErrorV1,
  ReconciliationEngine,
  calculateSnapshotConfigurationHashV1,
  createEffectiveProfileSnapshotV1,
  deserializeReconciliationRequestV1,
  deserializeReconciliationResultV1,
  projectReconciliationResultV1,
  serializeReconciliationRequestV1,
  serializeReconciliationResultV1,
  toReconciliationEngineTransactionsV1,
  validateEffectiveProfileSnapshotV1,
  validateReconciliationRequestV1,
  validateReconciliationResultV1,
  type EffectiveProfileSnapshotInputV1,
  type ReconciliationRequestV1,
} from "../../src/index.js";
import {
  canonicalTransactionFixture,
  reconciliationRequestFixture,
  reconciliationSnapshotFixture,
} from "../fixtures/reconciliation-v1.js";

function mutableRequest(): ReconciliationRequestV1 {
  return JSON.parse(JSON.stringify(reconciliationRequestFixture())) as ReconciliationRequestV1;
}

describe("reconciliation contract v1", () => {
  it("serializa, desserializa, valida schemaVersion e congela profundamente", () => {
    const request = reconciliationRequestFixture();
    const restored = deserializeReconciliationRequestV1(serializeReconciliationRequestV1(request));

    expect(restored).toEqual(request);
    expect(restored.schemaVersion).toBe(RECONCILIATION_CONTRACT_VERSION_V1);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.snapshot.routing.rules)).toBe(true);
    expect(() => {
      (restored.scope.ledgerAccountIds as string[]).push("another-account");
    }).toThrow();
  });

  it("produz hash estável para objetos equivalentes e preserva prioridade semântica", () => {
    const original = reconciliationSnapshotFixture();
    const input = JSON.parse(JSON.stringify(original)) as EffectiveProfileSnapshotInputV1 & { configurationHash?: string };
    delete input.configurationHash;
    input.ledgerAccountIds = [...input.ledgerAccountIds].reverse();
    input.importMappings = [...input.importMappings].reverse();
    input.ruleset.configuration.genericWords = [...input.ruleset.configuration.genericWords].reverse();
    const equivalent = createEffectiveProfileSnapshotV1(input);

    expect(equivalent.configurationHash).toBe(original.configurationHash);
    expect(calculateSnapshotConfigurationHashV1(equivalent)).toBe(original.configurationHash);

    const changedInput = JSON.parse(JSON.stringify(input)) as EffectiveProfileSnapshotInputV1;
    changedInput.ruleset.configuration.ruleOrder = [...changedInput.ruleset.configuration.ruleOrder].reverse();
    const changed = createEffectiveProfileSnapshotV1(changedInput);
    expect(changed.configurationHash).not.toBe(original.configurationHash);
  });

  it("rejeita snapshot com janela de RF-03 acima de três dias", () => {
    const snapshot = JSON.parse(JSON.stringify(reconciliationSnapshotFixture())) as Record<string, unknown>;
    const ruleset = snapshot.ruleset as Record<string, unknown>;
    (ruleset.configuration as Record<string, unknown>).dateWindowDays = 4;
    (snapshot.tolerances as Record<string, unknown>).dateWindowDays = 4;

    expect(validateEffectiveProfileSnapshotV1(snapshot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "snapshot.ruleset.configuration.dateWindowDays", code: "INVALID_VALUE" }),
      expect.objectContaining({ path: "snapshot.tolerances.dateWindowDays", code: "INVALID_VALUE" }),
    ]));
  });

  it("preserva limites ordenados de BETWEEN e diferencia o hash quando são invertidos", () => {
    const input = JSON.parse(JSON.stringify(reconciliationSnapshotFixture())) as EffectiveProfileSnapshotInputV1;
    input.routing.rules = [{
      ...input.routing.rules[0]!,
      conditions: [{
      schemaVersion: "1",
      field: "AMOUNT_CENTS",
      operator: "BETWEEN",
      value: ["2", "100"],
      }],
    }];
    const ordered = createEffectiveProfileSnapshotV1(input);
    const reversedInput = JSON.parse(JSON.stringify(input)) as EffectiveProfileSnapshotInputV1;
    reversedInput.routing.rules = [{
      ...reversedInput.routing.rules[0]!,
      conditions: [{ ...reversedInput.routing.rules[0]!.conditions[0]!, value: ["100", "2"] }],
    }];
    const reversed = createEffectiveProfileSnapshotV1(reversedInput);

    expect(ordered.routing.rules[0]!.conditions[0]!.value).toEqual(["2", "100"]);
    expect(reversed.configurationHash).not.toBe(ordered.configurationHash);
  });

  it("rejeita expressão regular inválida na configuração de aplicação automática", () => {
    const snapshot = JSON.parse(JSON.stringify(reconciliationSnapshotFixture())) as EffectiveProfileSnapshotInputV1 & {
      configurationHash?: string;
    };
    delete snapshot.configurationHash;
    snapshot.ruleset.configuration.automaticApplicationPattern = "[";

    expect(() => createEffectiveProfileSnapshotV1(snapshot)).toThrowError(
      expect.objectContaining({ name: "ReconciliationContractValidationErrorV1" }),
    );
  });

  it("rejeita versões, IDs vazios e IDs de transação duplicados entre participantes", () => {
    const request = mutableRequest();
    request.schemaVersion = "2" as "1";
    request.runId = " ";
    request.ledgerTransactions = [
      canonicalTransactionFixture(request.bankTransactions[0]!.id, "LEDGER"),
    ];

    const errors = validateReconciliationRequestV1(request);
    expect(errors.map((item) => item.code)).toEqual(
      expect.arrayContaining(["INVALID_VERSION", "INVALID_ID", "DUPLICATE_ID"]),
    );
  });

  it.each(["01", "+1", "1.00", "-0", " 1", "1 "])("rejeita centavos não canônicos: %s", (amountCents: string) => {
    const request = mutableRequest();
    request.bankTransactions = [canonicalTransactionFixture("bank-invalid", "BANK", { amountCents })];
    expect(validateReconciliationRequestV1(request)).toContainEqual(
      expect.objectContaining({ code: "INVALID_CENTS", path: "request.bankTransactions[0].amountCents" }),
    );
  });

  it("rejeita moeda mista, escopo diferente e conta contábil fora dos participantes", () => {
    const request = mutableRequest();
    request.bankTransactions = [
      canonicalTransactionFixture("bank-other", "BANK", {
        currency: "USD",
        scopeId: "scope-2",
        profileId: "profile-2",
      }),
    ];
    request.ledgerTransactions = [
      canonicalTransactionFixture("ledger-other", "LEDGER", { ledgerAccountId: "ledger-account-unknown" }),
    ];

    const errors = validateReconciliationRequestV1(request);
    expect(errors.map((item) => item.code)).toEqual(
      expect.arrayContaining(["CURRENCY_MISMATCH", "SCOPE_MISMATCH", "PROFILE_MISMATCH", "ACCOUNT_MISMATCH"]),
    );
  });

  it("rejeita snapshot incompleto e hash adulterado", () => {
    const incomplete = JSON.parse(JSON.stringify(reconciliationSnapshotFixture())) as Record<string, unknown>;
    delete incomplete.ruleset;
    const invalidHash = JSON.parse(JSON.stringify(reconciliationSnapshotFixture())) as Record<string, unknown>;
    invalidHash.configurationHash = "0".repeat(64);

    expect(validateEffectiveProfileSnapshotV1(incomplete)).toContainEqual(
      expect.objectContaining({ path: "snapshot.ruleset", code: "REQUIRED" }),
    );
    expect(validateEffectiveProfileSnapshotV1(invalidHash)).toContainEqual(
      expect.objectContaining({ path: "snapshot.configurationHash", code: "INVALID_HASH" }),
    );
  });

  it("assert falha com erros estruturados e desserialização recusa JSON inválido", () => {
    expect(() => deserializeReconciliationRequestV1("{"))
      .toThrow(ReconciliationContractValidationErrorV1);
    try {
      deserializeReconciliationRequestV1("{}");
      throw new Error("Expected validation failure");
    } catch (caught) {
      expect(caught).toBeInstanceOf(ReconciliationContractValidationErrorV1);
      expect((caught as ReconciliationContractValidationErrorV1).errors.length).toBeGreaterThan(0);
    }
  });

  it("adapta centavos somente no boundary, executa o motor real e projeta output compatível", () => {
    const request = reconciliationRequestFixture();
    const transactions = toReconciliationEngineTransactionsV1(request);
    expect(transactions.every((transaction) => typeof transaction.amountCents === "bigint")).toBe(true);
    expect(new Set(transactions.map((transaction) => transaction.accountId))).toEqual(new Set([request.scope.id]));

    const output = new ReconciliationEngine(0, 3, { evaluatedAt: request.requestedAt }).run(transactions);
    const result = projectReconciliationResultV1(request, output);

    expect(result).toMatchObject({
      schemaVersion: "1",
      requestId: request.requestId,
      runId: request.runId,
      scopeId: request.scope.id,
      configurationHash: request.snapshot.configurationHash,
      ruleVersion: output.ruleVersion,
    });
    expect(result.matchGroups).toHaveLength(1);
    expect(validateReconciliationResultV1(result)).toEqual([]);
    expect(deserializeReconciliationResultV1(serializeReconciliationResultV1(result))).toEqual(result);
  });

  it.each([
    ["transactions[0].amountCents", (result: Record<string, unknown>) => {
      ((result.transactions as Array<Record<string, unknown>>)[0]!).amountCents = "100.00";
    }],
    ["matchGroups[0].bankTransactionIds", (result: Record<string, unknown>) => {
      ((result.matchGroups as Array<Record<string, unknown>>)[0]!).bankTransactionIds = ["missing-bank"];
    }],
    ["audit[0].outcome", (result: Record<string, unknown>) => {
      ((result.audit as Array<Record<string, unknown>>)[0]!).outcome = "UNKNOWN";
    }],
    ["metrics.combinationsEvaluated", (result: Record<string, unknown>) => {
      (result.metrics as Record<string, unknown>).combinationsEvaluated = -1;
    }],
  ])("desserialização rejeita result malformado em %s", (_field: string, mutate: (result: Record<string, unknown>) => void) => {
    const request = reconciliationRequestFixture();
    const output = new ReconciliationEngine(0, 3, { evaluatedAt: request.requestedAt }).run(
      toReconciliationEngineTransactionsV1(request),
    );
    const malformed = JSON.parse(JSON.stringify(projectReconciliationResultV1(request, output))) as Record<string, unknown>;
    mutate(malformed);

    expect(() => deserializeReconciliationResultV1(JSON.stringify(malformed)))
      .toThrow(ReconciliationContractValidationErrorV1);
  });

  it.each([
    ["total do grupo", (result: Record<string, unknown>) => {
      ((result.matchGroups as Array<Record<string, unknown>>)[0]!).bankTotalCents = "999";
    }],
    ["tipo incompatível com a regra", (result: Record<string, unknown>) => {
      ((result.matchGroups as Array<Record<string, unknown>>)[0]!).type = "bank-net-zero";
    }],
    ["status incompatível com o grupo", (result: Record<string, unknown>) => {
      ((result.transactions as Array<Record<string, unknown>>)[0]!).status = "BANK_ONLY";
    }],
    ["associação unilateral ao grupo", (result: Record<string, unknown>) => {
      delete ((result.transactions as Array<Record<string, unknown>>)[0]!).matchGroupId;
    }],
    ["ids incoerentes na auditoria", (result: Record<string, unknown>) => {
      ((result.audit as Array<Record<string, unknown>>)[0]!).transactionIds = [
        ((result.audit as Array<Record<string, unknown>>)[0]!).bankTransactionIds as string[],
      ].flat();
    }],
    ["regra incoerente na auditoria", (result: Record<string, unknown>) => {
      ((result.audit as Array<Record<string, unknown>>)[0]!).ruleId = "RF-09";
    }],
    ["total de métricas incoerente", (result: Record<string, unknown>) => {
      const metrics = result.metrics as Record<string, unknown>;
      metrics.combinationsEvaluated = Number(metrics.combinationsEvaluated) + 1;
    }],
    ["âncora de métrica inexistente", (result: Record<string, unknown>) => {
      const metrics = result.metrics as Record<string, unknown>;
      (metrics.combinationsEvaluatedByAnchor as Record<string, unknown>)["missing-anchor"] = 0;
    }],
    ["transação fora do escopo", (result: Record<string, unknown>) => {
      ((result.transactions as Array<Record<string, unknown>>)[0]!).accountId = "another-scope";
    }],
    ["grupo financeiramente desigual mas internamente consistente", (result: Record<string, unknown>) => {
      const bank = (result.transactions as Array<Record<string, unknown>>).find((transaction) => transaction.source === "BANK")!;
      bank.amountCents = "101";
      const group = (result.matchGroups as Array<Record<string, unknown>>)[0]!;
      group.bankTotalCents = "101";
      group.differenceCents = "1";
      const audit = (result.audit as Array<Record<string, unknown>>)[0]!;
      audit.bankTotalCents = "101";
      audit.differenceCents = "1";
    }],
    ["data incompatível com RF-02", (result: Record<string, unknown>) => {
      const bank = (result.transactions as Array<Record<string, unknown>>).find((transaction) => transaction.source === "BANK")!;
      bank.postingDate = "2025-12-11";
    }],
  ])("desserialização rejeita incoerência semântica em %s", (_case: string, mutate: (result: Record<string, unknown>) => void) => {
    const request = reconciliationRequestFixture();
    const output = new ReconciliationEngine(0, 3, { evaluatedAt: request.requestedAt }).run(
      toReconciliationEngineTransactionsV1(request),
    );
    const malformed = JSON.parse(JSON.stringify(projectReconciliationResultV1(request, output))) as Record<string, unknown>;
    mutate(malformed);

    expect(() => deserializeReconciliationResultV1(JSON.stringify(malformed)))
      .toThrow(ReconciliationContractValidationErrorV1);
  });
});
