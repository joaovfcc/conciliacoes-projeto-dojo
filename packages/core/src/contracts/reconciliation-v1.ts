import { createHash } from "node:crypto";

import type {
  ReconciliationEngineOutput,
  ReconciliationTransaction,
} from "../reconciliation/domain/ReconciliationEngine.js";

export const RECONCILIATION_CONTRACT_VERSION_V1 = "1" as const;

export type JsonPrimitiveV1 = boolean | number | string | null;
export type JsonValueV1 = JsonPrimitiveV1 | JsonValueV1[] | { [key: string]: JsonValueV1 };
export type CurrencyCodeV1 = string;
export type CanonicalCentsV1 = string;

export interface ValidationErrorV1 {
  code:
    | "INVALID_TYPE"
    | "REQUIRED"
    | "INVALID_VERSION"
    | "INVALID_ID"
    | "DUPLICATE_ID"
    | "INVALID_CENTS"
    | "INVALID_CURRENCY"
    | "INVALID_DATE"
    | "INVALID_VALUE"
    | "SCOPE_MISMATCH"
    | "PROFILE_MISMATCH"
    | "ACCOUNT_MISMATCH"
    | "CURRENCY_MISMATCH"
    | "SOURCE_MISMATCH"
    | "INVALID_HASH";
  path: string;
  message: string;
}

export interface CanonicalTransactionV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  id: string;
  importBatchId: string;
  source: "BANK" | "LEDGER";
  scopeId: string;
  organizationId: string;
  legalEntityId: string;
  profileId: string;
  profileVersion: string;
  bankAccountId: string;
  ledgerAccountId?: string;
  currency: CurrencyCodeV1;
  sourceRow: number;
  postingDate: string;
  amountCents: CanonicalCentsV1;
  description: string;
  documentId?: string;
  originCode?: string;
  counterparty?: string;
  counterpart?: string;
  taxId?: string;
  ledgerCounterpartAccount?: string;
  evidence: {
    fileId: string;
    originalName?: string;
    line?: number;
    page?: number;
    sourceText?: string;
    [key: string]: JsonValueV1 | undefined;
  };
  metadata?: { [key: string]: JsonValueV1 };
}

export interface ReconciliationScopeV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  id: string;
  organizationId: string;
  legalEntityId: string;
  profileId: string;
  profileVersion: string;
  bankAccountId: string;
  ledgerAccountIds: readonly string[];
  currency: CurrencyCodeV1;
  timezone: string;
  period: {
    startDate: string;
    endDate: string;
  };
}

export interface SignConventionV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  canonicalDebitSign: "NEGATIVE" | "POSITIVE";
  bankDebitSign: "NEGATIVE" | "POSITIVE";
  ledgerDebitSign: "NEGATIVE" | "POSITIVE";
}

export interface RoutingConditionV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  field:
    | "DESCRIPTION"
    | "DOCUMENT_ID"
    | "ORIGIN_CODE"
    | "TRANSACTION_TYPE"
    | "SIGN"
    | "AMOUNT_CENTS"
    | "COUNTERPARTY"
    | "TAX_ID"
    | "LEDGER_COUNTERPART_ACCOUNT"
    | "UNIT"
    | "BRANCH"
    | "POSTING_DATE"
    | "METADATA";
  operator:
    | "EQUALS"
    | "CONTAINS"
    | "STARTS_WITH"
    | "MATCHES_REGEX"
    | "IN"
    | "GREATER_THAN_OR_EQUAL"
    | "LESS_THAN"
    | "BETWEEN";
  value: string | readonly string[];
  metadataKey?: string;
  caseSensitive?: boolean;
}

export interface RoutingRuleV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  id: string;
  priority: number;
  enabled: boolean;
  match: "ALL" | "ANY";
  conditions: readonly RoutingConditionV1[];
  ledgerAccountId: string;
}

export interface RoutingPolicyV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  strategy: "FIRST_MATCH";
  rules: readonly RoutingRuleV1[];
  defaultLedgerAccountId?: string;
}

export interface ExclusionRuleV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  id: string;
  enabled: boolean;
  source: "BANK" | "LEDGER" | "ANY";
  match: "ALL" | "ANY";
  conditions: readonly RoutingConditionV1[];
  reason: string;
}

export interface ExclusionPolicyV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  rules: readonly ExclusionRuleV1[];
}

export interface ControlTolerancesV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  amountCents: CanonicalCentsV1;
  dateWindowDays: number;
  descriptionSimilarity: number;
  maxGroupSize: number;
}

export interface ReconciliationRulesConfigurationV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  engineRuleVersion: string;
  ruleOrder: readonly string[];
  genericWords: readonly string[];
  dateWindowDays: number;
  rf03: { minimumScore: number; minimumMargin: number };
  rf06: {
    minimumScore: number;
    minimumMargin: number;
    sharedNumericTokenBonus: number;
    allLinesNumericTokenBonus: number;
  };
  maxCombinationsPerAnchor: number;
  automaticApplicationPattern: string;
}

export interface RulesetV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  id: string;
  version: string;
  configuration: ReconciliationRulesConfigurationV1;
}

export interface ImportMappingV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  id: string;
  version: string;
  source: "BANK" | "LEDGER";
  fieldMap: Readonly<Record<string, string>>;
}

export interface EffectiveProfileSnapshotV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  profileId: string;
  profileVersion: string;
  organizationId: string;
  legalEntityId: string;
  bankAccountId: string;
  ledgerAccountIds: readonly string[];
  currency: CurrencyCodeV1;
  timezone: string;
  ruleset: RulesetV1;
  importMappings: readonly ImportMappingV1[];
  signConvention: SignConventionV1;
  routing: RoutingPolicyV1;
  exclusions: ExclusionPolicyV1;
  tolerances: ControlTolerancesV1;
  effectiveFrom: string;
  effectiveTo?: string;
  configurationHash: string;
}

export type EffectiveProfileSnapshotInputV1 = Omit<EffectiveProfileSnapshotV1, "configurationHash">;

export interface ReconciliationRequestV1 {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  requestId: string;
  runId: string;
  idempotencyKey: string;
  requestedAt: string;
  scope: ReconciliationScopeV1;
  snapshot: EffectiveProfileSnapshotV1;
  bankTransactions: readonly CanonicalTransactionV1[];
  ledgerTransactions: readonly CanonicalTransactionV1[];
}

export interface ReconciliationResultTransactionV1
  extends Omit<ReconciliationEngineOutput["transactions"][number], "evidence" | "metadata"> {
  evidence: { [key: string]: JsonValueV1 | undefined };
  metadata?: { [key: string]: JsonValueV1 };
}

export type ReconciliationResultV1 = Omit<ReconciliationEngineOutput, "transactions"> & {
  schemaVersion: typeof RECONCILIATION_CONTRACT_VERSION_V1;
  requestId: string;
  runId: string;
  scopeId: string;
  configurationHash: string;
  transactions: ReconciliationResultTransactionV1[];
};

export class ReconciliationContractValidationErrorV1 extends Error {
  public readonly errors: readonly ValidationErrorV1[];

  public constructor(errors: readonly ValidationErrorV1[]) {
    super(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
    this.name = "ReconciliationContractValidationErrorV1";
    this.errors = errors;
  }
}

const CANONICAL_CENTS = /^(?:0|-[1-9]\d*|[1-9]\d*)$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENGINE_RULE_VERSION_V1 = "1.0";
const RECONCILIATION_SOURCES = new Set(["BANK", "LEDGER"]);
const RECONCILIATION_STATUSES = new Set([
  "RECONCILED_EXACT",
  "RECONCILED_DATE_WINDOW",
  "RECONCILED_GROUP",
  "RECONCILED_DAILY_TOTAL",
  "BANK_NET_ZERO",
  "EXCLUDED_AUTO_APPLICATION",
  "BANK_ONLY",
  "LEDGER_ONLY",
]);
const MATCH_RULE_IDS = new Set(["RF-01", "RF-02", "RF-03", "RF-04", "RF-05", "RF-07", "RF-08", "RF-09"]);
const MATCH_GROUP_TYPES = new Set(["exact", "date-window", "one-to-many", "many-to-one", "daily-total", "bank-net-zero"]);

export function canonicalizeReconciliationValueV1(value: unknown, path: readonly string[] = []): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => canonicalizeReconciliationValueV1(entry, [...path, "[]"]));
    return isUnorderedArray(path) ? entries.sort(compareCanonicalValues) : entries;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => {
          const normalized = canonicalizeReconciliationValueV1(value[key], [...path, key]);
          return [
            key,
            key === "value" && value.operator === "IN" && Array.isArray(normalized)
              ? normalized.sort(compareCanonicalValues)
              : normalized,
          ];
        }),
    );
  }
  return value;
}

export function canonicalStringifyReconciliationV1(value: unknown): string {
  return JSON.stringify(canonicalizeReconciliationValueV1(value));
}

export function calculateSnapshotConfigurationHashV1(
  snapshot: EffectiveProfileSnapshotInputV1 | EffectiveProfileSnapshotV1,
): string {
  const { configurationHash: _configurationHash, ...hashable } = snapshot as EffectiveProfileSnapshotV1;
  return createHash("sha256").update(canonicalStringifyReconciliationV1(hashable)).digest("hex");
}

export function createEffectiveProfileSnapshotV1(
  input: EffectiveProfileSnapshotInputV1,
): Readonly<EffectiveProfileSnapshotV1> {
  const normalized = canonicalizeReconciliationValueV1(input) as EffectiveProfileSnapshotInputV1;
  const snapshot: EffectiveProfileSnapshotV1 = {
    ...normalized,
    configurationHash: calculateSnapshotConfigurationHashV1(normalized),
  };
  assertEffectiveProfileSnapshotV1(snapshot);
  return deepFreeze(snapshot);
}

export function validateEffectiveProfileSnapshotV1(value: unknown): ValidationErrorV1[] {
  const errors: ValidationErrorV1[] = [];
  if (!isRecord(value)) {
    return [error("INVALID_TYPE", "snapshot", "Snapshot deve ser um objeto.")];
  }
  if (!isJsonValue(value)) errors.push(error("INVALID_TYPE", "snapshot", "Snapshot deve conter somente valores JSON."));

  version(value.schemaVersion, "snapshot.schemaVersion", errors);
  requiredId(value.profileId, "snapshot.profileId", errors);
  requiredId(value.profileVersion, "snapshot.profileVersion", errors);
  requiredId(value.organizationId, "snapshot.organizationId", errors);
  requiredId(value.legalEntityId, "snapshot.legalEntityId", errors);
  requiredId(value.bankAccountId, "snapshot.bankAccountId", errors);
  stringArray(value.ledgerAccountIds, "snapshot.ledgerAccountIds", errors, true);
  currency(value.currency, "snapshot.currency", errors);
  requiredId(value.timezone, "snapshot.timezone", errors);
  validateRuleset(value.ruleset, "snapshot.ruleset", errors);
  validateImportMappings(value.importMappings, "snapshot.importMappings", errors);
  validateSignConvention(value.signConvention, "snapshot.signConvention", errors);
  validateRouting(value.routing, "snapshot.routing", errors);
  validateExclusions(value.exclusions, "snapshot.exclusions", errors);
  validateTolerances(value.tolerances, "snapshot.tolerances", errors);
  isoDate(value.effectiveFrom, "snapshot.effectiveFrom", errors);
  if (value.effectiveTo !== undefined) isoDate(value.effectiveTo, "snapshot.effectiveTo", errors);
  if (typeof value.effectiveFrom === "string" && typeof value.effectiveTo === "string" && value.effectiveTo < value.effectiveFrom) {
    errors.push(error("INVALID_DATE", "snapshot.effectiveTo", "Fim da vigência deve ser igual ou posterior ao início."));
  }
  if (typeof value.configurationHash !== "string" || !SHA_256.test(value.configurationHash)) {
    errors.push(error("INVALID_HASH", "snapshot.configurationHash", "Hash deve ser SHA-256 hexadecimal em minúsculas."));
  } else if (errors.length === 0) {
    const calculated = calculateSnapshotConfigurationHashV1(value as unknown as EffectiveProfileSnapshotV1);
    if (calculated !== value.configurationHash) {
      errors.push(error("INVALID_HASH", "snapshot.configurationHash", "Hash não corresponde ao conteúdo do snapshot."));
    }
  }
  return errors;
}

export function assertEffectiveProfileSnapshotV1(value: unknown): asserts value is EffectiveProfileSnapshotV1 {
  assertErrors(validateEffectiveProfileSnapshotV1(value));
}

export function validateReconciliationRequestV1(value: unknown): ValidationErrorV1[] {
  const errors: ValidationErrorV1[] = [];
  if (!isRecord(value)) return [error("INVALID_TYPE", "request", "Request deve ser um objeto.")];
  if (!isJsonValue(value)) errors.push(error("INVALID_TYPE", "request", "Request deve conter somente valores JSON."));

  version(value.schemaVersion, "request.schemaVersion", errors);
  requiredId(value.requestId, "request.requestId", errors);
  requiredId(value.runId, "request.runId", errors);
  requiredId(value.idempotencyKey, "request.idempotencyKey", errors);
  isoDateTime(value.requestedAt, "request.requestedAt", errors);
  validateScope(value.scope, "request.scope", errors);
  errors.push(...validateEffectiveProfileSnapshotV1(value.snapshot));

  const scope = isRecord(value.scope) ? value.scope : undefined;
  const snapshot = isRecord(value.snapshot) ? value.snapshot : undefined;
  if (scope && snapshot) validateScopeSnapshotAgreement(scope, snapshot, errors);

  const seen = new Map<string, string>();
  validateTransactions(value.bankTransactions, "request.bankTransactions", "BANK", scope, snapshot, seen, errors);
  validateTransactions(value.ledgerTransactions, "request.ledgerTransactions", "LEDGER", scope, snapshot, seen, errors);
  return errors;
}

export function assertReconciliationRequestV1(value: unknown): asserts value is ReconciliationRequestV1 {
  assertErrors(validateReconciliationRequestV1(value));
}

export function serializeReconciliationRequestV1(request: ReconciliationRequestV1): string {
  assertReconciliationRequestV1(request);
  return JSON.stringify(request);
}

export function deserializeReconciliationRequestV1(json: string): Readonly<ReconciliationRequestV1> {
  const parsed: unknown = parseJson(json, "request");
  assertReconciliationRequestV1(parsed);
  return deepFreeze(parsed);
}

export function toReconciliationEngineTransactionsV1(
  request: ReconciliationRequestV1,
): ReconciliationTransaction[] {
  assertReconciliationRequestV1(request);
  if (request.scope.currency !== "BRL") {
    throw new ReconciliationContractValidationErrorV1([
      error("INVALID_CURRENCY", "request.scope.currency", "O motor atual aceita somente BRL."),
    ]);
  }
  return [...request.bankTransactions, ...request.ledgerTransactions].map((transaction) => ({
    id: transaction.id,
    importBatchId: transaction.importBatchId,
    source: transaction.source,
    accountId: request.scope.id,
    currency: "BRL",
    sourceRow: transaction.sourceRow,
    postingDate: transaction.postingDate,
    amountCents: BigInt(transaction.amountCents),
    description: transaction.description,
    ...(transaction.documentId ? { documentId: transaction.documentId } : {}),
    ...(transaction.originCode ? { originCode: transaction.originCode } : {}),
    ...(transaction.counterparty ? { counterparty: transaction.counterparty } : {}),
    ...(transaction.counterpart ? { counterpart: transaction.counterpart } : {}),
    ...(transaction.taxId ? { taxId: transaction.taxId } : {}),
    ...(transaction.ledgerCounterpartAccount
      ? { ledgerCounterpartAccount: transaction.ledgerCounterpartAccount }
      : {}),
    evidence: transaction.evidence,
    ...(transaction.metadata ? { metadata: transaction.metadata } : {}),
  }));
}

export function projectReconciliationResultV1(
  request: ReconciliationRequestV1,
  output: ReconciliationEngineOutput,
): ReconciliationResultV1 {
  assertReconciliationRequestV1(request);
  const result = {
    schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1,
    requestId: request.requestId,
    runId: request.runId,
    scopeId: request.scope.id,
    configurationHash: request.snapshot.configurationHash,
    ...output,
  };
  const wireResult = JSON.parse(JSON.stringify(result)) as unknown;
  assertErrors(validateReconciliationResultV1(wireResult));
  return wireResult as ReconciliationResultV1;
}

export function validateReconciliationResultV1(value: unknown): ValidationErrorV1[] {
  const errors: ValidationErrorV1[] = [];
  if (!isRecord(value)) return [error("INVALID_TYPE", "result", "Result deve ser um objeto.")];
  if (!isJsonValue(value)) errors.push(error("INVALID_TYPE", "result", "Result deve conter somente valores JSON."));
  version(value.schemaVersion, "result.schemaVersion", errors);
  requiredId(value.requestId, "result.requestId", errors);
  requiredId(value.runId, "result.runId", errors);
  requiredId(value.scopeId, "result.scopeId", errors);
  if (typeof value.configurationHash !== "string" || !SHA_256.test(value.configurationHash)) {
    errors.push(error("INVALID_HASH", "result.configurationHash", "Hash de configuração inválido."));
  }
  if (value.ruleVersion !== ENGINE_RULE_VERSION_V1) {
    errors.push(error("INVALID_VERSION", "result.ruleVersion", "Versão da regra do motor deve ser '1.0'."));
  }
  isoDateTime(value.evaluatedAt, "result.evaluatedAt", errors);
  const transactionIds = validateResultTransactions(value.transactions, errors);
  const matchGroupIds = validateResultMatchGroups(value.matchGroups, transactionIds, errors);
  validateResultTransactionGroups(value.transactions, matchGroupIds, errors);
  validateResultAudit(value.audit, transactionIds, errors);
  validateResultMetrics(value.metrics, transactionIds, errors);
  validateResultCoherence(value, errors);
  return errors;
}

export function serializeReconciliationResultV1(result: ReconciliationResultV1): string {
  assertErrors(validateReconciliationResultV1(result));
  return JSON.stringify(result);
}

export function deserializeReconciliationResultV1(json: string): Readonly<ReconciliationResultV1> {
  const parsed: unknown = parseJson(json, "result");
  assertErrors(validateReconciliationResultV1(parsed));
  return deepFreeze(parsed as ReconciliationResultV1);
}

function validateResultTransactions(value: unknown, errors: ValidationErrorV1[]): Map<string, "BANK" | "LEDGER"> {
  const ids = new Map<string, "BANK" | "LEDGER">();
  if (!Array.isArray(value)) {
    errors.push(error("INVALID_TYPE", "result.transactions", "transactions deve ser array."));
    return ids;
  }
  value.forEach((transaction, index) => {
    const path = `result.transactions[${index}]`;
    if (!isRecord(transaction)) {
      errors.push(error("INVALID_TYPE", path, "Transação deve ser objeto."));
      return;
    }
    for (const key of ["id", "importBatchId", "accountId"] as const) requiredId(transaction[key], `${path}.${key}`, errors);
    if (typeof transaction.id === "string" && transaction.id.trim()) {
      if (ids.has(transaction.id)) errors.push(error("DUPLICATE_ID", `${path}.id`, "Identificador de transação duplicado."));
      if (RECONCILIATION_SOURCES.has(String(transaction.source))) {
        ids.set(transaction.id, transaction.source as "BANK" | "LEDGER");
      }
    }
    if (!RECONCILIATION_SOURCES.has(String(transaction.source))) {
      errors.push(error("INVALID_VALUE", `${path}.source`, "Fonte deve ser BANK ou LEDGER."));
    }
    if (transaction.currency !== "BRL") errors.push(error("INVALID_CURRENCY", `${path}.currency`, "Moeda deve ser BRL."));
    positiveInteger(transaction.sourceRow, `${path}.sourceRow`, errors);
    isoDate(transaction.postingDate, `${path}.postingDate`, errors);
    cents(transaction.amountCents, `${path}.amountCents`, errors);
    for (const key of ["description", "normalizedDescription"] as const) {
      if (typeof transaction[key] !== "string") errors.push(error("INVALID_TYPE", `${path}.${key}`, `${key} deve ser string.`));
    }
    plainStringArray(transaction.tokens, `${path}.tokens`, errors);
    if (!RECONCILIATION_STATUSES.has(String(transaction.status))) {
      errors.push(error("INVALID_VALUE", `${path}.status`, "Status de transação inválido."));
    }
    if (transaction.matchGroupId !== undefined) requiredId(transaction.matchGroupId, `${path}.matchGroupId`, errors);
    for (const key of [
      "documentId",
      "originCode",
      "counterparty",
      "counterpart",
      "taxId",
      "ledgerCounterpartAccount",
    ] as const) {
      if (transaction[key] !== undefined && typeof transaction[key] !== "string") {
        errors.push(error("INVALID_TYPE", `${path}.${key}`, `${key} deve ser string.`));
      }
    }
    if (!isRecord(transaction.evidence)) {
      errors.push(error("REQUIRED", `${path}.evidence.fileId`, "Arquivo de evidência é obrigatório."));
    } else {
      requiredId(transaction.evidence.fileId, `${path}.evidence.fileId`, errors);
      for (const key of ["originalName", "sourceText"] as const) {
        if (transaction.evidence[key] !== undefined && typeof transaction.evidence[key] !== "string") {
          errors.push(error("INVALID_TYPE", `${path}.evidence.${key}`, `${key} deve ser string.`));
        }
      }
      for (const key of ["line", "page"] as const) {
        if (transaction.evidence[key] !== undefined) {
          positiveInteger(transaction.evidence[key], `${path}.evidence.${key}`, errors);
        }
      }
    }
    if (transaction.metadata !== undefined && !isRecord(transaction.metadata)) {
      errors.push(error("INVALID_TYPE", `${path}.metadata`, "Metadata deve ser objeto."));
    }
  });
  return ids;
}

function validateResultMatchGroups(
  value: unknown,
  transactionIds: Map<string, "BANK" | "LEDGER">,
  errors: ValidationErrorV1[],
): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) {
    errors.push(error("INVALID_TYPE", "result.matchGroups", "matchGroups deve ser array."));
    return ids;
  }
  value.forEach((group, index) => {
    const path = `result.matchGroups[${index}]`;
    if (!isRecord(group)) {
      errors.push(error("INVALID_TYPE", path, "Grupo deve ser objeto."));
      return;
    }
    requiredId(group.id, `${path}.id`, errors);
    duplicate(group.id, ids, `${path}.id`, errors);
    matchRule(group.ruleId, `${path}.ruleId`, errors);
    engineRuleVersion(group.ruleVersion, `${path}.ruleVersion`, errors);
    if (!MATCH_GROUP_TYPES.has(String(group.type))) errors.push(error("INVALID_VALUE", `${path}.type`, "Tipo de grupo inválido."));
    resultIdArray(group.bankTransactionIds, `${path}.bankTransactionIds`, "BANK", transactionIds, errors, true);
    resultIdArray(
      group.ledgerTransactionIds,
      `${path}.ledgerTransactionIds`,
      "LEDGER",
      transactionIds,
      errors,
      group.type !== "bank-net-zero",
    );
    for (const key of ["bankTotalCents", "ledgerTotalCents", "differenceCents"] as const) cents(group[key], `${path}.${key}`, errors);
    optionalFiniteNumber(group.score, `${path}.score`, errors);
    if (group.status !== "automatic") errors.push(error("INVALID_VALUE", `${path}.status`, "Status do grupo deve ser automatic."));
    isoDateTime(group.evaluatedAt, `${path}.evaluatedAt`, errors);
  });
  return ids;
}

function validateResultTransactionGroups(value: unknown, groupIds: Set<string>, errors: ValidationErrorV1[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((transaction, index) => {
    if (!isRecord(transaction) || transaction.matchGroupId === undefined) return;
    if (typeof transaction.matchGroupId === "string" && !groupIds.has(transaction.matchGroupId)) {
      errors.push(error("INVALID_ID", `result.transactions[${index}].matchGroupId`, "Grupo referenciado não existe."));
    }
  });
}

function validateResultAudit(
  value: unknown,
  transactionIds: Map<string, "BANK" | "LEDGER">,
  errors: ValidationErrorV1[],
): void {
  if (!Array.isArray(value)) {
    errors.push(error("INVALID_TYPE", "result.audit", "audit deve ser array."));
    return;
  }
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    const path = `result.audit[${index}]`;
    if (!isRecord(entry)) {
      errors.push(error("INVALID_TYPE", path, "Entrada de auditoria deve ser objeto."));
      return;
    }
    requiredId(entry.id, `${path}.id`, errors);
    duplicate(entry.id, ids, `${path}.id`, errors);
    matchRule(entry.ruleId, `${path}.ruleId`, errors);
    engineRuleVersion(entry.ruleVersion, `${path}.ruleVersion`, errors);
    resultIdArray(entry.transactionIds, `${path}.transactionIds`, undefined, transactionIds, errors, true);
    resultIdArray(entry.bankTransactionIds, `${path}.bankTransactionIds`, "BANK", transactionIds, errors, false);
    resultIdArray(entry.ledgerTransactionIds, `${path}.ledgerTransactionIds`, "LEDGER", transactionIds, errors, false);
    for (const key of ["bankTotalCents", "ledgerTotalCents", "differenceCents"] as const) cents(entry[key], `${path}.${key}`, errors);
    optionalFiniteNumber(entry.score, `${path}.score`, errors);
    if (!RECONCILIATION_STATUSES.has(String(entry.outcome))) {
      errors.push(error("INVALID_VALUE", `${path}.outcome`, "Resultado de auditoria inválido."));
    }
    isoDateTime(entry.evaluatedAt, `${path}.evaluatedAt`, errors);
  });
}

function validateResultMetrics(
  value: unknown,
  transactionIds: Map<string, "BANK" | "LEDGER">,
  errors: ValidationErrorV1[],
): void {
  if (!isRecord(value)) {
    errors.push(error("INVALID_TYPE", "result.metrics", "Metrics deve ser objeto."));
    return;
  }
  nonNegativeInteger(value.combinationsEvaluated, "result.metrics.combinationsEvaluated", errors);
  if (!isRecord(value.combinationsEvaluatedByAnchor)) {
    errors.push(error("INVALID_TYPE", "result.metrics.combinationsEvaluatedByAnchor", "Métrica por âncora deve ser objeto."));
  } else {
    for (const [anchor, count] of Object.entries(value.combinationsEvaluatedByAnchor)) {
      if (!anchor.trim()) errors.push(error("INVALID_ID", "result.metrics.combinationsEvaluatedByAnchor", "Âncora não pode ser vazia."));
      else if (!transactionIds.has(anchor)) {
        errors.push(error("INVALID_ID", `result.metrics.combinationsEvaluatedByAnchor.${anchor}`, "Âncora deve referenciar uma transação."));
      }
      nonNegativeInteger(count, `result.metrics.combinationsEvaluatedByAnchor.${anchor}`, errors);
    }
    if (Number.isInteger(value.combinationsEvaluated)) {
      const total = Object.values(value.combinationsEvaluatedByAnchor)
        .filter((count): count is number => typeof count === "number" && Number.isInteger(count) && count >= 0)
        .reduce((sum, count) => sum + count, 0);
      if (value.combinationsEvaluated !== total) {
        errors.push(error("INVALID_VALUE", "result.metrics.combinationsEvaluated", "Total deve corresponder à soma por âncora."));
      }
    }
  }
  if (value.rf03SignatureGroupsEvaluated !== undefined) {
    nonNegativeInteger(value.rf03SignatureGroupsEvaluated, "result.metrics.rf03SignatureGroupsEvaluated", errors);
  }
}

const GROUP_SEMANTICS: Record<string, {
  type: string;
  outcome: string;
  bank: number | "many" | "two-or-more";
  ledger: number | "many" | "two-or-more";
}> = {
  "RF-02": { type: "exact", outcome: "RECONCILED_EXACT", bank: 1, ledger: 1 },
  "RF-03": { type: "date-window", outcome: "RECONCILED_DATE_WINDOW", bank: 1, ledger: 1 },
  "RF-04": { type: "one-to-many", outcome: "RECONCILED_GROUP", bank: 1, ledger: 2 },
  "RF-05": { type: "many-to-one", outcome: "RECONCILED_GROUP", bank: 2, ledger: 1 },
  "RF-07": { type: "daily-total", outcome: "RECONCILED_DAILY_TOTAL", bank: "many", ledger: "many" },
  "RF-08": { type: "bank-net-zero", outcome: "BANK_NET_ZERO", bank: "two-or-more", ledger: 0 },
};

function validateResultCoherence(result: Record<string, unknown>, errors: ValidationErrorV1[]): void {
  if (!Array.isArray(result.transactions) || !Array.isArray(result.matchGroups) || !Array.isArray(result.audit)) return;
  const transactions = new Map<string, Record<string, unknown>>();
  result.transactions.forEach((transaction) => {
    if (isRecord(transaction) && typeof transaction.id === "string") transactions.set(transaction.id, transaction);
  });
  const membership = new Map<string, string>();
  const groupsById = new Map<string, Record<string, unknown>>();

  result.matchGroups.forEach((group, index) => {
    if (!isRecord(group) || typeof group.id !== "string") return;
    groupsById.set(group.id, group);
    const path = `result.matchGroups[${index}]`;
    const semantics = typeof group.ruleId === "string" ? GROUP_SEMANTICS[group.ruleId] : undefined;
    if (semantics && group.type !== semantics.type) {
      errors.push(error("INVALID_VALUE", `${path}.type`, `Tipo incompatível com ${group.ruleId}.`));
    }
    const bankIds = stringValues(group.bankTransactionIds);
    const ledgerIds = stringValues(group.ledgerTransactionIds);
    if (semantics) {
      validateCardinality(bankIds.length, semantics.bank, `${path}.bankTransactionIds`, errors);
      validateCardinality(ledgerIds.length, semantics.ledger, `${path}.ledgerTransactionIds`, errors);
    }
    validateDecisionTotals(group, bankIds, ledgerIds, transactions, path, errors);
    validateGroupPredicates(group, bankIds, ledgerIds, transactions, path, errors);
    for (const id of [...bankIds, ...ledgerIds]) {
      const previous = membership.get(id);
      if (previous && previous !== group.id) {
        errors.push(error("DUPLICATE_ID", path, `Transação ${id} pertence a mais de um grupo.`));
      }
      membership.set(id, group.id);
      const transaction = transactions.get(id);
      if (transaction?.matchGroupId !== group.id) {
        errors.push(error("INVALID_ID", `${path}.id`, `Transação ${id} não referencia o grupo.`));
      }
      if (semantics && transaction?.status !== semantics.outcome) {
        errors.push(error("INVALID_VALUE", `${path}.ruleId`, `Status da transação ${id} é incompatível com ${group.ruleId}.`));
      }
    }
  });

  result.transactions.forEach((transaction, index) => {
    if (!isRecord(transaction) || typeof transaction.id !== "string") return;
    if (typeof result.scopeId === "string" && transaction.accountId !== result.scopeId) {
      errors.push(error("SCOPE_MISMATCH", `result.transactions[${index}].accountId`, "Conta da transação diverge do escopo do resultado."));
    }
    const expectedGroup = membership.get(transaction.id);
    if (transaction.matchGroupId !== undefined && transaction.matchGroupId !== expectedGroup) {
      errors.push(error("INVALID_ID", `result.transactions[${index}].matchGroupId`, "Transação não pertence ao grupo referenciado."));
    }
    if (expectedGroup === undefined && groupedStatus(transaction.status)) {
      errors.push(error("INVALID_VALUE", `result.transactions[${index}].status`, "Status conciliado exige grupo correspondente."));
    }
    if (expectedGroup !== undefined && !groupedStatus(transaction.status)) {
      errors.push(error("INVALID_VALUE", `result.transactions[${index}].status`, "Transação agrupada exige status de grupo."));
    }
  });

  const auditedTransactions = new Set<string>();
  result.audit.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const path = `result.audit[${index}]`;
    const bankIds = stringValues(entry.bankTransactionIds);
    const ledgerIds = stringValues(entry.ledgerTransactionIds);
    const transactionIds = stringValues(entry.transactionIds);
    if (!sameIds(transactionIds, [...bankIds, ...ledgerIds])) {
      errors.push(error("INVALID_VALUE", `${path}.transactionIds`, "Transações devem corresponder aos IDs bancários e contábeis."));
    }
    validateDecisionTotals(entry, bankIds, ledgerIds, transactions, path, errors);
    validateTerminalDecisionPredicates(entry, bankIds, ledgerIds, transactions, path, errors);
    for (const id of transactionIds) {
      if (auditedTransactions.has(id)) {
        errors.push(error("DUPLICATE_ID", `${path}.transactionIds`, `Transação ${id} possui mais de uma decisão de auditoria.`));
      }
      auditedTransactions.add(id);
      const transaction = transactions.get(id);
      if (transaction && entry.outcome !== transaction.status) {
        errors.push(error("INVALID_VALUE", `${path}.outcome`, `Resultado diverge do status da transação ${id}.`));
      }
    }
    const groupIds = new Set(transactionIds.map((id) => membership.get(id)).filter((id): id is string => id !== undefined));
    if (groupIds.size > 0) {
      if (groupIds.size !== 1 || transactionIds.some((id) => membership.get(id) === undefined)) {
        errors.push(error("INVALID_VALUE", `${path}.transactionIds`, "Auditoria de grupo deve conter exatamente os membros do mesmo grupo."));
      } else {
        const group = groupsById.get([...groupIds][0]!);
        if (group) {
          const groupIdsCombined = [...stringValues(group.bankTransactionIds), ...stringValues(group.ledgerTransactionIds)];
          if (!sameIds(transactionIds, groupIdsCombined)) {
            errors.push(error("INVALID_VALUE", `${path}.transactionIds`, "Auditoria não contém todos os membros do grupo."));
          }
          if (entry.ruleId !== group.ruleId) {
            errors.push(error("INVALID_VALUE", `${path}.ruleId`, "Regra de auditoria diverge do grupo."));
          }
          if (entry.score !== group.score) {
            errors.push(error("INVALID_VALUE", `${path}.score`, "Score de auditoria diverge do grupo."));
          }
        }
      }
    }
    const expectedRule = expectedRuleForOutcome(entry.outcome);
    if (expectedRule && entry.ruleId !== expectedRule) {
      errors.push(error("INVALID_VALUE", `${path}.ruleId`, "Regra diverge do resultado auditado."));
    }
  });
  for (const id of transactions.keys()) {
    if (!auditedTransactions.has(id)) {
      errors.push(error("REQUIRED", "result.audit", `Transação ${id} não possui decisão de auditoria.`));
    }
  }
}

function validateGroupPredicates(
  group: Record<string, unknown>,
  bankIds: string[],
  ledgerIds: string[],
  transactions: Map<string, Record<string, unknown>>,
  path: string,
  errors: ValidationErrorV1[],
): void {
  const bank = bankIds.map((id) => transactions.get(id)).filter((entry): entry is Record<string, unknown> => entry !== undefined);
  const ledger = ledgerIds.map((id) => transactions.get(id)).filter((entry): entry is Record<string, unknown> => entry !== undefined);
  const all = [...bank, ...ledger];
  if (group.differenceCents !== "0") {
    errors.push(error("INVALID_VALUE", `${path}.differenceCents`, "Grupos automáticos exigem igualdade financeira exata."));
  }
  if (new Set(all.map((transaction) => transaction.accountId)).size > 1) {
    errors.push(error("ACCOUNT_MISMATCH", path, "Transações do grupo devem pertencer à mesma conta."));
  }
  if (new Set(all.map((transaction) => transaction.currency)).size > 1) {
    errors.push(error("CURRENCY_MISMATCH", path, "Transações do grupo devem usar a mesma moeda."));
  }
  switch (group.ruleId) {
    case "RF-02":
      if (!samePostingDate(all) || bank[0]?.amountCents !== ledger[0]?.amountCents) {
        errors.push(error("INVALID_VALUE", `${path}.ruleId`, "RF-02 exige mesma data e valor em centavos."));
      }
      break;
    case "RF-03":
      if (bank[0]?.amountCents !== ledger[0]?.amountCents || dateDistance(bank[0]?.postingDate, ledger[0]?.postingDate) > 3) {
        errors.push(error("INVALID_VALUE", `${path}.ruleId`, "RF-03 exige mesmo valor e diferença de até três dias."));
      }
      break;
    case "RF-04":
    case "RF-05":
      if (!samePostingDate(all) || !sameNonZeroSign(all)) {
        errors.push(error("INVALID_VALUE", `${path}.ruleId`, `${group.ruleId} exige mesma data e sinal.`));
      }
      break;
    case "RF-07":
    case "RF-08":
      if (!samePostingDate(all)) {
        errors.push(error("INVALID_VALUE", `${path}.ruleId`, `${group.ruleId} exige movimentos da mesma data.`));
      }
      if (bank[0] && [...transactions.values()].some((transaction) =>
        transaction.source === "LEDGER"
        && transaction.status === "LEDGER_ONLY"
        && transaction.accountId === bank[0]!.accountId
        && transaction.postingDate === bank[0]!.postingDate)) {
        errors.push(error("INVALID_VALUE", `${path}.ruleId`, "RF-08 exige ausência de movimento contábil aberto na mesma data."));
      }
      break;
  }
}

function validateTerminalDecisionPredicates(
  entry: Record<string, unknown>,
  bankIds: string[],
  ledgerIds: string[],
  transactions: Map<string, Record<string, unknown>>,
  path: string,
  errors: ValidationErrorV1[],
): void {
  const bank = bankIds.map((id) => transactions.get(id)).filter((transaction) => transaction !== undefined);
  const ledger = ledgerIds.map((id) => transactions.get(id)).filter((transaction) => transaction !== undefined);
  if (entry.outcome === "EXCLUDED_AUTO_APPLICATION" && (bank.length !== 1 || ledger.length !== 0)) {
    errors.push(error("SOURCE_MISMATCH", `${path}.transactionIds`, "RF-01 deve excluir exatamente uma transação bancária."));
  }
  if (entry.outcome === "BANK_ONLY" && (bank.length !== 1 || ledger.length !== 0)) {
    errors.push(error("SOURCE_MISMATCH", `${path}.transactionIds`, "BANK_ONLY deve referenciar exatamente uma transação bancária."));
  }
  if (entry.outcome === "LEDGER_ONLY" && (bank.length !== 0 || ledger.length !== 1)) {
    errors.push(error("SOURCE_MISMATCH", `${path}.transactionIds`, "LEDGER_ONLY deve referenciar exatamente uma transação contábil."));
  }
}

function samePostingDate(transactions: Record<string, unknown>[]): boolean {
  return transactions.length > 0 && new Set(transactions.map((transaction) => transaction.postingDate)).size === 1;
}

function sameNonZeroSign(transactions: Record<string, unknown>[]): boolean {
  const amounts = transactions.map((transaction) => transaction.amountCents)
    .filter((amount): amount is string => typeof amount === "string" && CANONICAL_CENTS.test(amount))
    .map(BigInt);
  return amounts.length === transactions.length
    && amounts.every((amount) => amount !== 0n && (amount > 0n) === (amounts[0]! > 0n));
}

function dateDistance(left: unknown, right: unknown): number {
  if (typeof left !== "string" || typeof right !== "string") return Number.POSITIVE_INFINITY;
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

function validateDecisionTotals(
  decision: Record<string, unknown>,
  bankIds: string[],
  ledgerIds: string[],
  transactions: Map<string, Record<string, unknown>>,
  path: string,
  errors: ValidationErrorV1[],
): void {
  const bankTotal = sumTransactionAmounts(bankIds, transactions);
  const ledgerTotal = sumTransactionAmounts(ledgerIds, transactions);
  if (bankTotal === undefined || ledgerTotal === undefined) return;
  const expected = {
    bankTotalCents: bankTotal.toString(),
    ledgerTotalCents: ledgerTotal.toString(),
    differenceCents: (bankTotal - ledgerTotal).toString(),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (decision[key] !== value) errors.push(error("INVALID_VALUE", `${path}.${key}`, "Total diverge das transações referenciadas."));
  }
}

function sumTransactionAmounts(ids: string[], transactions: Map<string, Record<string, unknown>>): bigint | undefined {
  let total = 0n;
  for (const id of ids) {
    const amount = transactions.get(id)?.amountCents;
    if (typeof amount !== "string" || !CANONICAL_CENTS.test(amount)) return undefined;
    total += BigInt(amount);
  }
  return total;
}

function validateCardinality(
  actual: number,
  expected: number | "many" | "two-or-more",
  path: string,
  errors: ValidationErrorV1[],
): void {
  if ((expected === "many" && actual < 1)
    || (expected === "two-or-more" && actual < 2)
    || (typeof expected === "number" && actual !== expected)) {
    errors.push(error("INVALID_VALUE", path, "Cardinalidade incompatível com a regra."));
  }
}

function groupedStatus(value: unknown): boolean {
  return ["RECONCILED_EXACT", "RECONCILED_DATE_WINDOW", "RECONCILED_GROUP", "RECONCILED_DAILY_TOTAL", "BANK_NET_ZERO"]
    .includes(String(value));
}

function expectedRuleForOutcome(outcome: unknown): string | undefined {
  return {
    RECONCILED_EXACT: "RF-02",
    RECONCILED_DATE_WINDOW: "RF-03",
    RECONCILED_GROUP: undefined,
    RECONCILED_DAILY_TOTAL: "RF-07",
    BANK_NET_ZERO: "RF-08",
    EXCLUDED_AUTO_APPLICATION: "RF-01",
    BANK_ONLY: "RF-09",
    LEDGER_ONLY: "RF-09",
  }[String(outcome)];
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function sameIds(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((id, index) => id === sortedRight[index]);
}

function resultIdArray(
  value: unknown,
  path: string,
  expectedSource: "BANK" | "LEDGER" | undefined,
  transactionIds: Map<string, "BANK" | "LEDGER">,
  errors: ValidationErrorV1[],
  required: boolean,
): void {
  stringArray(value, path, errors, required);
  if (!Array.isArray(value)) return;
  value.forEach((id, index) => {
    if (typeof id !== "string" || !id.trim()) return;
    const source = transactionIds.get(id);
    if (!source) errors.push(error("INVALID_ID", `${path}[${index}]`, "Transação referenciada não existe."));
    else if (expectedSource && source !== expectedSource) {
      errors.push(error("SOURCE_MISMATCH", `${path}[${index}]`, `Transação deve ser ${expectedSource}.`));
    }
  });
}

function plainStringArray(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(error("INVALID_TYPE", path, "Deve ser array de strings."));
  }
}

function matchRule(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!MATCH_RULE_IDS.has(String(value))) errors.push(error("INVALID_VALUE", path, "Regra de conciliação inválida."));
}

function engineRuleVersion(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (value !== ENGINE_RULE_VERSION_V1) errors.push(error("INVALID_VERSION", path, "Versão da regra deve ser '1.0'."));
}

function optionalFiniteNumber(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(error("INVALID_VALUE", path, "Valor deve ser número finito."));
  }
}

function validateScope(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push(error("REQUIRED", path, "Escopo único é obrigatório."));
    return;
  }
  version(value.schemaVersion, `${path}.schemaVersion`, errors);
  for (const key of ["id", "organizationId", "legalEntityId", "profileId", "profileVersion", "bankAccountId", "timezone"] as const) {
    requiredId(value[key], `${path}.${key}`, errors);
  }
  stringArray(value.ledgerAccountIds, `${path}.ledgerAccountIds`, errors, true);
  currency(value.currency, `${path}.currency`, errors);
  if (!isRecord(value.period)) {
    errors.push(error("REQUIRED", `${path}.period`, "Período é obrigatório."));
  } else {
    isoDate(value.period.startDate, `${path}.period.startDate`, errors);
    isoDate(value.period.endDate, `${path}.period.endDate`, errors);
    if (typeof value.period.startDate === "string" && typeof value.period.endDate === "string" && value.period.endDate < value.period.startDate) {
      errors.push(error("INVALID_DATE", `${path}.period.endDate`, "Fim do período deve ser igual ou posterior ao início."));
    }
  }
}

function validateScopeSnapshotAgreement(
  scope: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  errors: ValidationErrorV1[],
): void {
  const fields = [
    ["organizationId", "SCOPE_MISMATCH"],
    ["legalEntityId", "SCOPE_MISMATCH"],
    ["profileId", "PROFILE_MISMATCH"],
    ["profileVersion", "PROFILE_MISMATCH"],
    ["bankAccountId", "ACCOUNT_MISMATCH"],
    ["currency", "CURRENCY_MISMATCH"],
    ["timezone", "SCOPE_MISMATCH"],
  ] as const;
  for (const [field, code] of fields) {
    if (scope[field] !== undefined && snapshot[field] !== undefined && scope[field] !== snapshot[field]) {
      errors.push(error(code, `request.snapshot.${field}`, `Snapshot diverge do escopo em ${field}.`));
    }
  }
  if (Array.isArray(scope.ledgerAccountIds) && Array.isArray(snapshot.ledgerAccountIds)) {
    const left = [...scope.ledgerAccountIds].sort().join("\0");
    const right = [...snapshot.ledgerAccountIds].sort().join("\0");
    if (left !== right) {
      errors.push(error("ACCOUNT_MISMATCH", "request.snapshot.ledgerAccountIds", "Contas contábeis divergem do escopo."));
    }
  }
}

function validateTransactions(
  value: unknown,
  path: string,
  expectedSource: "BANK" | "LEDGER",
  scope: Record<string, unknown> | undefined,
  snapshot: Record<string, unknown> | undefined,
  seen: Map<string, string>,
  errors: ValidationErrorV1[],
): void {
  if (!Array.isArray(value)) {
    errors.push(error("INVALID_TYPE", path, "Transações devem ser um array."));
    return;
  }
  value.forEach((transaction, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(transaction)) {
      errors.push(error("INVALID_TYPE", itemPath, "Transação deve ser um objeto."));
      return;
    }
    version(transaction.schemaVersion, `${itemPath}.schemaVersion`, errors);
    for (const key of [
      "id",
      "importBatchId",
      "scopeId",
      "organizationId",
      "legalEntityId",
      "profileId",
      "profileVersion",
      "bankAccountId",
    ] as const) {
      requiredId(transaction[key], `${itemPath}.${key}`, errors);
    }
    if (typeof transaction.id === "string" && transaction.id.trim()) {
      const previous = seen.get(transaction.id);
      if (previous) {
        errors.push(error("DUPLICATE_ID", `${itemPath}.id`, `ID já usado em ${previous}.`));
      } else {
        seen.set(transaction.id, `${itemPath}.id`);
      }
    }
    if (transaction.source !== expectedSource) {
      errors.push(error("SOURCE_MISMATCH", `${itemPath}.source`, `Fonte deve ser ${expectedSource}.`));
    }
    currency(transaction.currency, `${itemPath}.currency`, errors);
    cents(transaction.amountCents, `${itemPath}.amountCents`, errors);
    isoDate(transaction.postingDate, `${itemPath}.postingDate`, errors);
    if (!Number.isInteger(transaction.sourceRow) || Number(transaction.sourceRow) < 1) {
      errors.push(error("INVALID_VALUE", `${itemPath}.sourceRow`, "Linha de origem deve ser inteiro positivo."));
    }
    if (typeof transaction.description !== "string") {
      errors.push(error("INVALID_TYPE", `${itemPath}.description`, "Descrição deve ser string."));
    }
    if (!isRecord(transaction.evidence) || typeof transaction.evidence.fileId !== "string" || !transaction.evidence.fileId.trim()) {
      errors.push(error("REQUIRED", `${itemPath}.evidence.fileId`, "Arquivo de evidência é obrigatório."));
    }
    if (expectedSource === "LEDGER") {
      requiredId(transaction.ledgerAccountId, `${itemPath}.ledgerAccountId`, errors);
    }
    if (scope) validateTransactionAgreement(transaction, itemPath, scope, errors);
    if (snapshot && transaction.profileId !== undefined && transaction.profileId !== snapshot.profileId) {
      errors.push(error("PROFILE_MISMATCH", `${itemPath}.profileId`, "Perfil diverge do snapshot."));
    }
  });
}

function validateTransactionAgreement(
  transaction: Record<string, unknown>,
  path: string,
  scope: Record<string, unknown>,
  errors: ValidationErrorV1[],
): void {
  const fields = [
    ["scopeId", "id", "SCOPE_MISMATCH"],
    ["organizationId", "organizationId", "SCOPE_MISMATCH"],
    ["legalEntityId", "legalEntityId", "SCOPE_MISMATCH"],
    ["profileId", "profileId", "PROFILE_MISMATCH"],
    ["profileVersion", "profileVersion", "PROFILE_MISMATCH"],
    ["bankAccountId", "bankAccountId", "ACCOUNT_MISMATCH"],
    ["currency", "currency", "CURRENCY_MISMATCH"],
  ] as const;
  for (const [transactionField, scopeField, code] of fields) {
    if (transaction[transactionField] !== undefined && scope[scopeField] !== undefined && transaction[transactionField] !== scope[scopeField]) {
      errors.push(error(code, `${path}.${transactionField}`, `Transação diverge do escopo em ${transactionField}.`));
    }
  }
  if (
    transaction.source === "LEDGER" &&
    typeof transaction.ledgerAccountId === "string" &&
    Array.isArray(scope.ledgerAccountIds) &&
    !scope.ledgerAccountIds.includes(transaction.ledgerAccountId)
  ) {
    errors.push(error("ACCOUNT_MISMATCH", `${path}.ledgerAccountId`, "Conta contábil não participa do escopo."));
  }
}

function validateRuleset(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push(error("REQUIRED", path, "Ruleset é obrigatório."));
    return;
  }
  version(value.schemaVersion, `${path}.schemaVersion`, errors);
  requiredId(value.id, `${path}.id`, errors);
  requiredId(value.version, `${path}.version`, errors);
  if (!isRecord(value.configuration)) {
    errors.push(error("REQUIRED", `${path}.configuration`, "Configuração de regras é obrigatória."));
    return;
  }
  const configuration = value.configuration;
  version(configuration.schemaVersion, `${path}.configuration.schemaVersion`, errors);
  requiredId(configuration.engineRuleVersion, `${path}.configuration.engineRuleVersion`, errors);
  stringArray(configuration.ruleOrder, `${path}.configuration.ruleOrder`, errors, true);
  stringArray(configuration.genericWords, `${path}.configuration.genericWords`, errors, false);
  nonNegativeInteger(configuration.dateWindowDays, `${path}.configuration.dateWindowDays`, errors);
  if (typeof configuration.dateWindowDays === "number" && configuration.dateWindowDays > 3) {
    errors.push(error("INVALID_VALUE", `${path}.configuration.dateWindowDays`, "Janela de data deve ser de no máximo três dias."));
  }
  finiteRecord(configuration.rf03, ["minimumScore", "minimumMargin"], `${path}.configuration.rf03`, errors);
  finiteRecord(
    configuration.rf06,
    ["minimumScore", "minimumMargin", "sharedNumericTokenBonus", "allLinesNumericTokenBonus"],
    `${path}.configuration.rf06`,
    errors,
  );
  positiveInteger(configuration.maxCombinationsPerAnchor, `${path}.configuration.maxCombinationsPerAnchor`, errors);
  requiredId(configuration.automaticApplicationPattern, `${path}.configuration.automaticApplicationPattern`, errors);
  if (typeof configuration.automaticApplicationPattern === "string" && configuration.automaticApplicationPattern.trim()) {
    try {
      new RegExp(configuration.automaticApplicationPattern);
    } catch {
      errors.push(error(
        "INVALID_VALUE",
        `${path}.configuration.automaticApplicationPattern`,
        "Expressão regular de aplicação automática inválida.",
      ));
    }
  }
}

function validateImportMappings(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(error("REQUIRED", path, "Ao menos um mapeamento de importação é obrigatório."));
    return;
  }
  const ids = new Set<string>();
  value.forEach((mapping, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(mapping)) {
      errors.push(error("INVALID_TYPE", itemPath, "Mapeamento deve ser objeto."));
      return;
    }
    version(mapping.schemaVersion, `${itemPath}.schemaVersion`, errors);
    requiredId(mapping.id, `${itemPath}.id`, errors);
    duplicate(mapping.id, ids, `${itemPath}.id`, errors);
    requiredId(mapping.version, `${itemPath}.version`, errors);
    if (mapping.source !== "BANK" && mapping.source !== "LEDGER") {
      errors.push(error("INVALID_VALUE", `${itemPath}.source`, "Fonte do mapeamento deve ser BANK ou LEDGER."));
    }
    if (!isRecord(mapping.fieldMap) || Object.keys(mapping.fieldMap).length === 0) {
      errors.push(error("REQUIRED", `${itemPath}.fieldMap`, "Mapa de campos não pode ser vazio."));
    }
  });
}

function validateSignConvention(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push(error("REQUIRED", path, "Convenção de sinais é obrigatória."));
    return;
  }
  version(value.schemaVersion, `${path}.schemaVersion`, errors);
  for (const key of ["canonicalDebitSign", "bankDebitSign", "ledgerDebitSign"] as const) {
    if (value[key] !== "NEGATIVE" && value[key] !== "POSITIVE") {
      errors.push(error("INVALID_VALUE", `${path}.${key}`, "Sinal deve ser NEGATIVE ou POSITIVE."));
    }
  }
}

function validateRouting(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push(error("REQUIRED", path, "Política de roteamento é obrigatória."));
    return;
  }
  version(value.schemaVersion, `${path}.schemaVersion`, errors);
  if (value.strategy !== "FIRST_MATCH") errors.push(error("INVALID_VALUE", `${path}.strategy`, "Estratégia deve ser FIRST_MATCH."));
  if (!Array.isArray(value.rules)) {
    errors.push(error("INVALID_TYPE", `${path}.rules`, "Regras de roteamento devem ser array."));
    return;
  }
  const ids = new Set<string>();
  let previousPriority = -1;
  value.rules.forEach((rule, index) => {
    const itemPath = `${path}.rules[${index}]`;
    if (!isRecord(rule)) {
      errors.push(error("INVALID_TYPE", itemPath, "Regra deve ser objeto."));
      return;
    }
    version(rule.schemaVersion, `${itemPath}.schemaVersion`, errors);
    requiredId(rule.id, `${itemPath}.id`, errors);
    duplicate(rule.id, ids, `${itemPath}.id`, errors);
    nonNegativeInteger(rule.priority, `${itemPath}.priority`, errors);
    if (typeof rule.priority === "number" && rule.priority <= previousPriority) {
      errors.push(error("INVALID_VALUE", `${itemPath}.priority`, "Prioridades devem ser estritamente crescentes."));
    }
    if (typeof rule.priority === "number") previousPriority = rule.priority;
    if (typeof rule.enabled !== "boolean") errors.push(error("INVALID_TYPE", `${itemPath}.enabled`, "Enabled deve ser boolean."));
    if (rule.match !== "ALL" && rule.match !== "ANY") errors.push(error("INVALID_VALUE", `${itemPath}.match`, "Match deve ser ALL ou ANY."));
    validateConditions(rule.conditions, `${itemPath}.conditions`, errors);
    requiredId(rule.ledgerAccountId, `${itemPath}.ledgerAccountId`, errors);
  });
  if (value.defaultLedgerAccountId !== undefined) requiredId(value.defaultLedgerAccountId, `${path}.defaultLedgerAccountId`, errors);
}

function validateExclusions(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push(error("REQUIRED", path, "Política de exclusões é obrigatória."));
    return;
  }
  version(value.schemaVersion, `${path}.schemaVersion`, errors);
  if (!Array.isArray(value.rules)) {
    errors.push(error("INVALID_TYPE", `${path}.rules`, "Regras de exclusão devem ser array."));
    return;
  }
  const ids = new Set<string>();
  value.rules.forEach((rule, index) => {
    const itemPath = `${path}.rules[${index}]`;
    if (!isRecord(rule)) {
      errors.push(error("INVALID_TYPE", itemPath, "Regra deve ser objeto."));
      return;
    }
    version(rule.schemaVersion, `${itemPath}.schemaVersion`, errors);
    requiredId(rule.id, `${itemPath}.id`, errors);
    duplicate(rule.id, ids, `${itemPath}.id`, errors);
    if (typeof rule.enabled !== "boolean") errors.push(error("INVALID_TYPE", `${itemPath}.enabled`, "Enabled deve ser boolean."));
    if (rule.source !== "BANK" && rule.source !== "LEDGER" && rule.source !== "ANY") {
      errors.push(error("INVALID_VALUE", `${itemPath}.source`, "Source deve ser BANK, LEDGER ou ANY."));
    }
    if (rule.match !== "ALL" && rule.match !== "ANY") errors.push(error("INVALID_VALUE", `${itemPath}.match`, "Match deve ser ALL ou ANY."));
    validateConditions(rule.conditions, `${itemPath}.conditions`, errors);
    requiredId(rule.reason, `${itemPath}.reason`, errors);
  });
}

function validateConditions(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(error("REQUIRED", path, "Ao menos uma condição é obrigatória."));
    return;
  }
  value.forEach((condition, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(condition)) {
      errors.push(error("INVALID_TYPE", itemPath, "Condição deve ser objeto."));
      return;
    }
    version(condition.schemaVersion, `${itemPath}.schemaVersion`, errors);
    const fields = [
      "DESCRIPTION",
      "DOCUMENT_ID",
      "ORIGIN_CODE",
      "TRANSACTION_TYPE",
      "SIGN",
      "AMOUNT_CENTS",
      "COUNTERPARTY",
      "TAX_ID",
      "LEDGER_COUNTERPART_ACCOUNT",
      "UNIT",
      "BRANCH",
      "POSTING_DATE",
      "METADATA",
    ];
    if (!fields.includes(String(condition.field))) errors.push(error("INVALID_VALUE", `${itemPath}.field`, "Campo de condição inválido."));
    const operators = [
      "EQUALS",
      "CONTAINS",
      "STARTS_WITH",
      "MATCHES_REGEX",
      "IN",
      "GREATER_THAN_OR_EQUAL",
      "LESS_THAN",
      "BETWEEN",
    ];
    if (!operators.includes(String(condition.operator))) errors.push(error("INVALID_VALUE", `${itemPath}.operator`, "Operador inválido."));
    if (typeof condition.value !== "string" && !Array.isArray(condition.value)) {
      errors.push(error("INVALID_TYPE", `${itemPath}.value`, "Valor deve ser string ou array de strings."));
    }
    if (condition.field === "METADATA") requiredId(condition.metadataKey, `${itemPath}.metadataKey`, errors);
  });
}

function validateTolerances(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push(error("REQUIRED", path, "Tolerâncias são obrigatórias."));
    return;
  }
  version(value.schemaVersion, `${path}.schemaVersion`, errors);
  cents(value.amountCents, `${path}.amountCents`, errors);
  nonNegativeInteger(value.dateWindowDays, `${path}.dateWindowDays`, errors);
  if (typeof value.dateWindowDays === "number" && value.dateWindowDays > 3) {
    errors.push(error("INVALID_VALUE", `${path}.dateWindowDays`, "Janela de data deve ser de no máximo três dias."));
  }
  if (typeof value.descriptionSimilarity !== "number" || value.descriptionSimilarity < 0 || value.descriptionSimilarity > 1) {
    errors.push(error("INVALID_VALUE", `${path}.descriptionSimilarity`, "Similaridade deve estar entre 0 e 1."));
  }
  positiveInteger(value.maxGroupSize, `${path}.maxGroupSize`, errors);
}

function version(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (value !== RECONCILIATION_CONTRACT_VERSION_V1) {
    errors.push(error("INVALID_VERSION", path, "schemaVersion deve ser '1'."));
  }
}

function requiredId(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (typeof value !== "string" || !value.trim()) errors.push(error("INVALID_ID", path, "Identificador não pode ser vazio."));
}

function currency(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (typeof value !== "string" || !CURRENCY_CODE.test(value)) {
    errors.push(error("INVALID_CURRENCY", path, "Moeda deve usar código ISO 4217 de três letras maiúsculas."));
  }
}

function cents(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (typeof value !== "string" || !CANONICAL_CENTS.test(value)) {
    errors.push(error("INVALID_CENTS", path, "Centavos devem ser string canônica de inteiro."));
  }
}

function isoDate(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (typeof value !== "string" || !ISO_DATE.test(value) || !isActualIsoDate(value)) {
    errors.push(error("INVALID_DATE", path, "Data deve usar ISO YYYY-MM-DD válido."));
  }
}

function isoDateTime(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    errors.push(error("INVALID_DATE", path, "Data/hora deve usar ISO UTC canônico."));
  }
}

function isActualIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function stringArray(value: unknown, path: string, errors: ValidationErrorV1[], required: boolean): void {
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    errors.push(error(required ? "REQUIRED" : "INVALID_TYPE", path, "Deve ser array de strings não vazias."));
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => duplicate(entry, seen, `${path}[${index}]`, errors));
}

function finiteRecord(value: unknown, keys: readonly string[], path: string, errors: ValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push(error("REQUIRED", path, "Configuração é obrigatória."));
    return;
  }
  for (const key of keys) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
      errors.push(error("INVALID_VALUE", `${path}.${key}`, "Valor deve ser número finito."));
    }
  }
}

function nonNegativeInteger(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!Number.isInteger(value) || Number(value) < 0) errors.push(error("INVALID_VALUE", path, "Valor deve ser inteiro não negativo."));
}

function positiveInteger(value: unknown, path: string, errors: ValidationErrorV1[]): void {
  if (!Number.isInteger(value) || Number(value) < 1) errors.push(error("INVALID_VALUE", path, "Valor deve ser inteiro positivo."));
}

function duplicate(value: unknown, seen: Set<string>, path: string, errors: ValidationErrorV1[]): void {
  if (typeof value !== "string") return;
  if (seen.has(value)) errors.push(error("DUPLICATE_ID", path, "Valor duplicado."));
  seen.add(value);
}

function isUnorderedArray(path: readonly string[]): boolean {
  const joined = path.join(".");
  return (
    path.at(-1) === "ledgerAccountIds" ||
    path.at(-1) === "genericWords" ||
    path.at(-1) === "conditions" ||
    path.at(-1) === "importMappings" ||
    joined.endsWith("exclusions.rules")
  );
}

function compareCanonicalValues(left: unknown, right: unknown): number {
  const leftText = JSON.stringify(left);
  const rightText = JSON.stringify(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValueV1 {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function error(code: ValidationErrorV1["code"], path: string, message: string): ValidationErrorV1 {
  return { code, path, message };
}

function assertErrors(errors: readonly ValidationErrorV1[]): void {
  if (errors.length > 0) throw new ReconciliationContractValidationErrorV1(errors);
}

function parseJson(json: string, path: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new ReconciliationContractValidationErrorV1([error("INVALID_TYPE", path, "JSON inválido.")]);
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
