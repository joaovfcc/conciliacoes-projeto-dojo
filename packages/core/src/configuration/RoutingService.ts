import type { CanonicalTransactionV1, RoutingConditionV1, RoutingPolicyV1 } from "../contracts/reconciliation-v1.js";
import { ConfigurationError, isEffectiveAt, type AccountMapping } from "./models.js";

export type RoutingResult =
  | { status: "ROUTED"; ledgerAccountId: string; mappingId: string; priority: number; fallback: boolean }
  | { status: "UNMAPPED"; ledgerAccountId?: never; mappingId?: never }
  | { status: "ROUTING_AMBIGUOUS"; ledgerAccountId?: never; mappingId?: never; mappingIds: readonly string[] };

export class RoutingService {
  public route(transaction: CanonicalTransactionV1, mappings: readonly AccountMapping[], date = transaction.postingDate): RoutingResult {
    const effective = mappings.filter(
      (mapping) => mapping.status === "ACTIVE" && mapping.bankAccountId === transaction.bankAccountId && isEffectiveAt(mapping, date),
    );
    const matched = effective
      .filter((mapping) => !mapping.fallback && this.matches(transaction, mapping))
      // Lower numeric values have higher priority. ID is only a stable ordering aid; ties remain ambiguous.
      .sort((left, right) => priority(left) - priority(right) || left.id.localeCompare(right.id));
    const first = matched[0];
    if (first) {
      const tied = matched.filter((mapping) => priority(mapping) === priority(first));
      if (tied.length > 1) {
        return { status: "ROUTING_AMBIGUOUS", mappingIds: tied.map((mapping) => mapping.id) };
      }
      return this.routed(first);
    }

    const fallbacks = effective.filter((mapping) => mapping.fallback).sort((left, right) => left.id.localeCompare(right.id));
    if (fallbacks.length > 1) {
      return { status: "ROUTING_AMBIGUOUS", mappingIds: fallbacks.map((mapping) => mapping.id) };
    }
    return fallbacks[0] ? this.routed(fallbacks[0]) : { status: "UNMAPPED" };
  }

  public routePolicy(transaction: CanonicalTransactionV1, policy: RoutingPolicyV1): RoutingResult {
    const matched = policy.rules
      .filter((rule) => rule.enabled && this.matchesConditions(transaction, rule.match, rule.conditions))
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
    const first = matched[0];
    if (first) {
      const tied = matched.filter((rule) => rule.priority === first.priority);
      if (tied.length > 1) return { status: "ROUTING_AMBIGUOUS", mappingIds: tied.map((rule) => rule.id) };
      return {
        status: "ROUTED",
        ledgerAccountId: first.ledgerAccountId,
        mappingId: first.id,
        priority: first.priority,
        fallback: false,
      };
    }
    return policy.defaultLedgerAccountId
      ? { status: "ROUTED", ledgerAccountId: policy.defaultLedgerAccountId, mappingId: "fallback", priority: Number.MAX_SAFE_INTEGER, fallback: true }
      : { status: "UNMAPPED" };
  }

  private routed(mapping: AccountMapping): RoutingResult {
    return {
      status: "ROUTED",
      ledgerAccountId: mapping.ledgerAccountId,
      mappingId: mapping.id,
      priority: priority(mapping),
      fallback: mapping.fallback ?? false,
    };
  }

  private matches(transaction: CanonicalTransactionV1, mapping: AccountMapping): boolean {
    return this.matchesConditions(transaction, mapping.match ?? "ALL", mapping.conditions ?? []);
  }

  private matchesConditions(
    transaction: CanonicalTransactionV1,
    match: "ALL" | "ANY",
    conditions: readonly RoutingConditionV1[],
  ): boolean {
    if (conditions.length === 0) return false;
    const results = conditions.map((condition) => conditionMatches(transaction, condition));
    return match === "ALL" ? results.every(Boolean) : results.some(Boolean);
  }
}

function priority(mapping: AccountMapping): number {
  return mapping.priority ?? 0;
}

function conditionMatches(transaction: CanonicalTransactionV1, condition: RoutingConditionV1): boolean {
  const actual = conditionValue(transaction, condition);
  const expected = Array.isArray(condition.value) ? [...condition.value] : [condition.value];
  if (condition.operator === "BETWEEN") {
    if (expected.length !== 2) throw new ConfigurationError("INVALID_ROUTING_CONDITION", "BETWEEN exige dois limites.");
    return compare(actual, expected[0]!, condition.field) >= 0 && compare(actual, expected[1]!, condition.field) <= 0;
  }
  if (condition.operator === "GREATER_THAN_OR_EQUAL") return compare(actual, expected[0]!, condition.field) >= 0;
  if (condition.operator === "LESS_THAN") return compare(actual, expected[0]!, condition.field) < 0;

  const normalizedActual = normalize(actual, condition.caseSensitive ?? false);
  const normalizedExpected = expected.map((value) => normalize(value, condition.caseSensitive ?? false));
  if (condition.operator === "EQUALS") return normalizedActual === normalizedExpected[0];
  if (condition.operator === "CONTAINS") return normalizedActual.includes(normalizedExpected[0]!);
  if (condition.operator === "STARTS_WITH") return normalizedActual.startsWith(normalizedExpected[0]!);
  if (condition.operator === "IN") return normalizedExpected.includes(normalizedActual);
  if (condition.operator === "MATCHES_REGEX") {
    try {
      return new RegExp(expected[0]!, condition.caseSensitive ? "" : "i").test(actual);
    } catch {
      throw new ConfigurationError("INVALID_ROUTING_CONDITION", "Expressão regular de roteamento inválida.");
    }
  }
  return false;
}

function conditionValue(transaction: CanonicalTransactionV1, condition: RoutingConditionV1): string {
  const metadata = transaction.metadata ?? {};
  const metadataString = (key: string): string => {
    const value = metadata[key];
    return value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  };
  switch (condition.field) {
    case "DESCRIPTION": return [transaction.description, metadataString("history")].filter(Boolean).join(" ");
    case "DOCUMENT_ID": return transaction.documentId ?? "";
    case "ORIGIN_CODE": return transaction.originCode ?? "";
    case "TRANSACTION_TYPE": return metadataString("transactionType") || metadataString("type");
    case "SIGN": return BigInt(transaction.amountCents) < 0n ? "NEGATIVE" : BigInt(transaction.amountCents) > 0n ? "POSITIVE" : "ZERO";
    case "AMOUNT_CENTS": return transaction.amountCents;
    case "COUNTERPARTY": return transaction.counterparty ?? transaction.counterpart ?? "";
    case "TAX_ID": return transaction.taxId ?? "";
    case "LEDGER_COUNTERPART_ACCOUNT": return transaction.ledgerCounterpartAccount ?? "";
    case "UNIT": return metadataString("unit");
    case "BRANCH": return metadataString("branch");
    case "POSTING_DATE": return transaction.postingDate;
    case "METADATA": return metadataString(condition.metadataKey ?? "");
  }
}

function normalize(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize("NFKC").trim();
  return caseSensitive ? normalized : normalized.toLocaleUpperCase("pt-BR");
}

function compare(left: string, right: string, field: RoutingConditionV1["field"]): number {
  if (field === "AMOUNT_CENTS") {
    const leftCents = BigInt(left);
    const rightCents = BigInt(right);
    return leftCents < rightCents ? -1 : leftCents > rightCents ? 1 : 0;
  }
  return left.localeCompare(right);
}
