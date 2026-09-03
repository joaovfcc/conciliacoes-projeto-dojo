import { createHash } from "node:crypto";
import {
  ReconciliationEngine,
  normalizeReconciliationText,
  reconciliationTextSimilarity,
  extractSemanticCategories,
  extractBankHint,
  extractFinancialHint,
  calculateCandidateScore,
  type CandidateScoreBreakdown,
  type FinancialHint,
  type ReconciliationAuditEntry,
  type ReconciliationEngineOutput,
  type ReconciliationMatchGroup,
  type ReconciliationStatus,
  type ReconciliationTransaction,
} from "./reconciliation/domain/ReconciliationEngine.js";
import { normalizeDocumentId, dayDifference } from "./normalization.js";
import type {
  AccountMapping,
  AmbiguityGroup,
  ConfirmProcessingRequest,
  DecisionLevel,
  LedgerRecord,
  PreflightResult,
  ProcessingResult,
  ProcessingControls,
  ReconciliationResult,
  ResultStatus,
  StatementRecord,
} from "./types.js";
import { resultStatuses } from "./types.js";

const EPOCH = "1970-01-01T00:00:00.000Z";
const CONTROL_TOLERANCE_CENTS = 5n;
const automaticStatuses = new Set<ResultStatus>([
  "AUTO_MATCH_EXACT",
  "AUTO_MATCH_UNIQUE_VALUE",
  "AUTO_MATCH_DATE_TOLERANCE",
  "AUTO_MATCH_GROUP",
  "AUTO_MATCH_DAILY_TOTAL",
  "BANK_NET_ZERO",
  "AUTO_APPLICATION_EXCLUDED",
]);
const reconciledStatuses = new Set<ResultStatus>([
  "AUTO_MATCH_EXACT",
  "AUTO_MATCH_UNIQUE_VALUE",
  "AUTO_MATCH_DATE_TOLERANCE",
  "AUTO_MATCH_GROUP",
  "AUTO_MATCH_DAILY_TOTAL",
]);

type PartitionResult = {
  results: ReconciliationResult[];
  engine: ReconciliationEngineOutput;
};

type CoverageTransaction = {
  id: string;
  source: "BANK" | "LEDGER";
  status: string;
  amountCents: string;
  postingDate: string;
};

export function reconcile(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  confirmation: ConfirmProcessingRequest,
  preflight?: Pick<PreflightResult, "ledgerAccounts" | "statements">,
): ProcessingResult {
  const selectedPrefix = periodPrefix(confirmation.period);
  const scopedLedgers = ledgers.filter((item) =>
    (!item.company || item.company === confirmation.company) &&
    (!confirmation.branch || !item.branch || item.branch === confirmation.branch) &&
    item.date.startsWith(selectedPrefix));
  const scopedStatements = statements.filter((item) => item.date.startsWith(selectedPrefix));
  const partitioned = reconcileMappedAccounts(scopedLedgers, scopedStatements, confirmation);
  const ledgerAccountByStatementFile = new Map<string, string>();
  for (const mapping of stableMappings(confirmation.mappings)) {
    for (const fileId of mapping.statementFileIds) ledgerAccountByStatementFile.set(fileId, mapping.ledgerAccount);
  }
  const summaryAccounts = [...new Set(confirmation.mappings.map((item) => item.ledgerAccount))].sort();
  const summaries = summaryAccounts.map((ledgerAccount) => {
    const mapping = confirmation.mappings.find((item) => item.ledgerAccount === ledgerAccount)!;
    return summarize(ledgerAccount, partitioned.results.filter((item) =>
      item.ledgers?.some((ledger) => ledger.ledgerAccount === ledgerAccount) ||
      item.ledger?.ledgerAccount === ledgerAccount ||
      item.statements?.some((statement) => ledgerAccountByStatementFile.get(statement.evidence.fileId) === ledgerAccount) ||
      (!item.ledger && item.statement && ledgerAccountByStatementFile.get(item.statement.evidence.fileId) === ledgerAccount)), mapping);
  });
  const rejectedLedgers = ledgers.filter((item) => !item.date.startsWith(selectedPrefix)).length;
  const rejectedStatements = statements.filter((item) => !item.date.startsWith(selectedPrefix)).length;
  const issues = [];
  if (rejectedLedgers) issues.push({ severity: "WARNING" as const, code: "RAZAO_FORA_COMPETENCIA", message: `${rejectedLedgers} registro(s) do razão foram rejeitados por estarem fora da competência confirmada.` });
  if (rejectedStatements) issues.push({ severity: "WARNING" as const, code: "EXTRATO_FORA_COMPETENCIA", message: `${rejectedStatements} registro(s) de extrato foram rejeitados por estarem fora da competência confirmada.` });
  const evaluatedAt = confirmation.evaluatedAt ?? EPOCH;
  const controls = consolidatedControls(partitioned.engines, partitioned.results, confirmation, scopedLedgers, preflight);
  return {
    resultSchemaVersion: "2.0",
    company: confirmation.company,
    branch: confirmation.branch ?? "",
    period: confirmation.period,
    executedAt: evaluatedAt,
    summaries,
    results: partitioned.results,
    issues,
    files: [],
    investments: [],
    controls,
    reconciliation: {
      ruleVersion: "1.0",
      evaluatedAt,
      transactions: partitioned.engines.flatMap((engine) => engine.transactions).sort((left, right) => left.id.localeCompare(right.id)),
      matchGroups: partitioned.engines.flatMap((engine) => engine.matchGroups).sort((left, right) => left.id.localeCompare(right.id)),
      audit: partitioned.engines.flatMap((engine) => engine.audit).sort((left, right) => left.id.localeCompare(right.id)),
      metrics: {
        combinationsEvaluated: partitioned.engines.reduce((sum, engine) => sum + engine.metrics.combinationsEvaluated, 0),
        combinationsEvaluatedByAnchor: partitioned.engines.reduce<Record<string, number>>((counts, engine) => {
          for (const [anchorId, count] of Object.entries(engine.metrics.combinationsEvaluatedByAnchor)) {
            counts[anchorId] = (counts[anchorId] ?? 0) + count;
          }
          return counts;
        }, {}),
        ...(partitioned.engines.some((engine) => engine.metrics.rf03SignatureGroupsEvaluated !== undefined)
          ? {
              rf03SignatureGroupsEvaluated: partitioned.engines.reduce(
                (sum, engine) => sum + (engine.metrics.rf03SignatureGroupsEvaluated ?? 0),
                0,
              ),
            }
          : {}),
      },
    },
  };
}

function reconcileMappedAccounts(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  confirmation: ConfirmProcessingRequest,
): { results: ReconciliationResult[]; engines: ReconciliationEngineOutput[] } {
  const results: ReconciliationResult[] = [];
  const engines: ReconciliationEngineOutput[] = [];
  const mappedStatementFileIds = new Set<string>();
  const mappedLedgerAccounts = new Set<string>();
  for (const mapping of stableMappings(confirmation.mappings)) {
    const fileIds = new Set(mapping.statementFileIds);
    mapping.statementFileIds.forEach((fileId) => mappedStatementFileIds.add(fileId));
    mappedLedgerAccounts.add(mapping.ledgerAccount);
    const partition = reconcilePartition(
      ledgers.filter((item) => item.ledgerAccount === mapping.ledgerAccount),
      statements.filter((item) => fileIds.has(item.evidence.fileId)),
      mapping,
      confirmation,
    );
    results.push(...partition.results);
    engines.push(partition.engine);
  }
  for (const ledger of stableLedgers(ledgers)) {
    if (!mappedLedgerAccounts.has(ledger.ledgerAccount)) results.push(unmappedResult("LEDGER_WITHOUT_STATEMENT", "RULE_7_UNMAPPED_LEDGER", ledger));
  }
  for (const statement of stableStatements(statements)) {
    if (!mappedStatementFileIds.has(statement.evidence.fileId)) results.push(unmappedResult("STATEMENT_WITHOUT_LEDGER", "RULE_8_UNMAPPED_STATEMENT", undefined, statement));
  }
  return { results: results.sort((left, right) => left.id.localeCompare(right.id)), engines };
}

function reconcilePartition(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  mapping: AccountMapping,
  confirmation: ConfirmProcessingRequest,
): PartitionResult {
  const ledgerById = new Map(ledgers.map((item) => [item.id, item]));
  const statementById = new Map(statements.map((item) => [item.id, item]));
  const transactions: ReconciliationTransaction[] = [
    ...ledgers.filter(eligibleLedger).map((item) => ledgerTransaction(item, mapping.ledgerAccount, mapping.signProfile)),
    ...statements.filter(eligibleStatement).map((item) => statementTransaction(item, mapping.ledgerAccount)),
  ];
  const engine = new ReconciliationEngine(0, confirmation.dateToleranceDays, {
    evaluatedAt: confirmation.evaluatedAt ?? EPOCH,
    // Agrupamentos nunca compõem os totais conciliados sem revisão humana.
    // As sugestões determinísticas são calculadas abaixo, sobre o resíduo 1:1.
    allowOneToMany: false,
    allowManyToOne: false,
    allowDailyTotal: false,
    matchByUniqueValueWithinPeriod: true,
  }).run(transactions);
  const auditByGroup = new Map(engine.audit.filter((item) => item.transactionIds.length > 1).map((item) => [transactionSetKey(item.transactionIds), item]));
  const results = engine.matchGroups.map((group) => projectGroup(group, auditByGroup.get(transactionSetKey([...group.bankTransactionIds, ...group.ledgerTransactionIds])), ledgerById, statementById));
  const suggestions = suggestDeterministicBatches(ledgers, statements, mapping.signProfile, engine, confirmation.evaluatedAt ?? EPOCH);
  const suggestedTransactionIds = new Set(
    suggestions.flatMap((group) => [...group.bankTransactionIds, ...group.ledgerTransactionIds]),
  );
  const ambiguities = ambiguousValueGroups(engine, ledgerById, statementById);
  for (const transaction of engine.transactions.filter((item) => !item.matchGroupId)) {
    // Uma linha pertence a exatamente uma classificação visível. Quando ela
    // integra uma sugestão revisável, não deve reaparecer como pendência avulsa.
    if (suggestedTransactionIds.has(transaction.id)) continue;
    const audit = engine.audit.find((item) => item.transactionIds.length === 1 && item.transactionIds[0] === transaction.id);
    results.push(ambiguities.has(transaction.id)
      ? projectAmbiguousSingle(transaction.id, ambiguities.get(transaction.id)!, ledgerById, statementById)
      : projectSingle(transaction.status, transaction.id, audit, ledgerById, statementById));
  }
  results.push(...suggestions.map((group) => projectSuggestedGroup(group, ledgerById, statementById)));
  return { results, engine };
}

function ambiguousValueGroups(
  engine: ReconciliationEngineOutput,
  ledgerById: Map<string, LedgerRecord>,
  statementById: Map<string, StatementRecord>,
): Map<string, AmbiguityGroup> {
  const buckets = new Map<string, typeof engine.transactions>();
  for (const transaction of engine.transactions) {
    if (transaction.status !== "BANK_ONLY" && transaction.status !== "LEDGER_ONLY") continue;
    const key = [transaction.accountId, transaction.currency, transaction.amountCents].join("\u0000");
    buckets.set(key, [...(buckets.get(key) ?? []), transaction]);
  }
  const groups = new Map<string, AmbiguityGroup>();
  for (const [key, entries] of buckets.entries()) {
    const banks = entries.filter((item) => item.source === "BANK");
    const ledgers = entries.filter((item) => item.source === "LEDGER");
    if (banks.length > 0 && ledgers.length > 0 && (banks.length !== 1 || ledgers.length !== 1)) {
      const ledgerCandidateIds = ledgers.map((item) => item.id).sort();
      const statementCandidateIds = banks.map((item) => item.id).sort();
      const ledgerAccount = ledgerCandidateIds
        .map((id) => ledgerById.get(id)?.ledgerAccount)
        .find((account): account is string => Boolean(account)) ?? "";
      const amount = centsToDecimal(banks[0]!.amountCents);
      const group: AmbiguityGroup = {
        id: deterministicId(["AMBIGUITY_GROUP", key, ...ledgerCandidateIds, ...statementCandidateIds]),
        ledgerAccount,
        amount,
        ledgerCandidateIds,
        statementCandidateIds,
        reason: `Há ${ledgerCandidateIds.length} lançamento(s) no razão e ${statementCandidateIds.length} movimento(s) no extrato com o mesmo valor; nenhum documento normalizado identifica um único par.`,
        evaluatedAt: engine.evaluatedAt,
      };
      for (const entry of entries) groups.set(entry.id, group);
    }
  }
  return groups;
}

/**
 * Finds only whole, deterministic batches. It deliberately does not search
 * arbitrary subsets: a suggestion must be the complete same-date,
 * same-direction and same-semantic-family residue. This makes the evidence
 * reviewable and avoids turning a coincidental sum into a reconciliation.
 */
function suggestDeterministicBatches(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  signProfile: AccountMapping["signProfile"],
  engine: ReconciliationEngineOutput,
  evaluatedAt: string,
): ReconciliationMatchGroup[] {
  const statusById = new Map(engine.transactions.map((item) => [item.id, item.status]));
  const pendingLedgers = ledgers.filter((item) => statusById.get(item.id) === "LEDGER_ONLY" && eligibleLedger(item));
  const pendingStatements = statements.filter((item) => statusById.get(item.id) === "BANK_ONLY" && eligibleStatement(item));
  const candidates: ReconciliationMatchGroup[] = [
    ...oneToManyBatchCandidates(pendingStatements, pendingLedgers, signProfile, evaluatedAt),
    ...manyToOneBatchCandidates(pendingStatements, pendingLedgers, signProfile, evaluatedAt),
  ];
  const references = new Map<string, number>();
  for (const candidate of candidates) {
    for (const id of [...candidate.bankTransactionIds, ...candidate.ledgerTransactionIds]) {
      references.set(id, (references.get(id) ?? 0) + 1);
    }
  }
  // A transaction shared by two plausible batches stays pending. We never
  // choose one candidate arbitrarily, even as a suggestion.
  return candidates
    .filter((candidate) => [...candidate.bankTransactionIds, ...candidate.ledgerTransactionIds].every((id) => references.get(id) === 1))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function oneToManyBatchCandidates(
  statements: StatementRecord[],
  ledgers: LedgerRecord[],
  signProfile: AccountMapping["signProfile"],
  evaluatedAt: string,
): ReconciliationMatchGroup[] {
  const ledgerBatches = batches(ledgers, (record) => centsForLedger(record, signProfile));
  const candidates: ReconciliationMatchGroup[] = [];
  for (const statement of statements) {
    const key = batchKey(statement, decimalToCents(statement.value));
    const members = ledgerBatches.get(key) ?? [];
    if (members.length < 2) continue;
    const ledgerTotal = totalLedgerBatch(members, signProfile);
    const bankTotal = decimalToCents(statement.value);
    if (ledgerTotal !== bankTotal) continue;
    candidates.push(suggestedGroup("RF-04", "one-to-many", [statement.id], members.map((item) => item.id), bankTotal, ledgerTotal, evaluatedAt));
  }
  return candidates;
}

function manyToOneBatchCandidates(
  statements: StatementRecord[],
  ledgers: LedgerRecord[],
  signProfile: AccountMapping["signProfile"],
  evaluatedAt: string,
): ReconciliationMatchGroup[] {
  const statementBatches = batches(statements, (record) => decimalToCents(record.value));
  const candidates: ReconciliationMatchGroup[] = [];
  for (const ledger of ledgers) {
    const ledgerAmount = centsForLedger(ledger, signProfile);
    const key = batchKey(ledger, ledgerAmount);
    const members = statementBatches.get(key) ?? [];
    if (members.length < 2) continue;
    const bankTotal = members.reduce((sum, item) => sum + decimalToCents(item.value), 0n);
    if (bankTotal !== ledgerAmount) continue;
    candidates.push(suggestedGroup("RF-05", "many-to-one", members.map((item) => item.id), [ledger.id], bankTotal, ledgerAmount, evaluatedAt));
  }
  return candidates;
}

function batches<T extends LedgerRecord | StatementRecord>(
  records: T[],
  amount: (record: T) => bigint,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const key = batchKey(record, amount(record));
    if (!semanticFamily(record.history)) continue;
    const current = grouped.get(key) ?? [];
    current.push(record);
    grouped.set(key, current);
  }
  return grouped;
}

function batchKey(record: Pick<LedgerRecord, "date" | "history"> | Pick<StatementRecord, "date" | "history">, amount: bigint): string {
  return [record.date, amount < 0n ? "NEGATIVE" : "POSITIVE", semanticFamily(record.history) ?? ""].join("\u0000");
}

function semanticFamily(history: string): string | undefined {
  const categories = extractSemanticCategories(history);
  return categories.length === 1 ? categories[0] : undefined;
}

function centsForLedger(record: LedgerRecord, signProfile: AccountMapping["signProfile"]): bigint {
  return decimalToCents(record.value) * signConvention(signProfile).ledgerMovementMultiplier;
}

function totalLedgerBatch(records: LedgerRecord[], signProfile: AccountMapping["signProfile"]): bigint {
  return records.reduce((sum, record) => sum + centsForLedger(record, signProfile), 0n);
}

function suggestedGroup(
  ruleId: "RF-04" | "RF-05",
  type: "one-to-many" | "many-to-one",
  bankTransactionIds: string[],
  ledgerTransactionIds: string[],
  bankTotal: bigint,
  ledgerTotal: bigint,
  evaluatedAt: string,
): ReconciliationMatchGroup {
  return {
    id: deterministicId(["GROUP_SUGGESTION", ruleId, ...[...bankTransactionIds].sort(), ...[...ledgerTransactionIds].sort()]),
    ruleId,
    ruleVersion: "1.0",
    type,
    bankTransactionIds: [...bankTransactionIds].sort(),
    ledgerTransactionIds: [...ledgerTransactionIds].sort(),
    bankTotalCents: bankTotal.toString(),
    ledgerTotalCents: ledgerTotal.toString(),
    differenceCents: (bankTotal - ledgerTotal).toString(),
    status: "suggested",
    evaluatedAt,
  };
}

function projectSuggestedGroup(
  group: ReconciliationMatchGroup,
  ledgerById: Map<string, LedgerRecord>,
  statementById: Map<string, StatementRecord>,
): ReconciliationResult {
  const ledgers = group.ledgerTransactionIds.map((id) => ledgerById.get(id)!).filter(Boolean);
  const statements = group.bankTransactionIds.map((id) => statementById.get(id)!).filter(Boolean);
  return {
    id: group.id,
    status: "GROUP_SUGGESTION",
    rule: group.ruleId,
    decisionLevel: "REVIEW_REQUIRED",
    reason: "Lote determinístico fecha em centavos, mas exige conferência manual antes de integrar os totais conciliados.",
    ...(ledgers[0] ? { ledger: ledgers[0] } : {}),
    ...(statements[0] ? { statement: statements[0] } : {}),
    ledgers,
    statements,
    valueDifference: centsToDecimal(group.differenceCents),
    valueTolerance: "0.00",
    ruleVersion: group.ruleVersion,
    matchGroup: group,
  };
}

function ledgerTransaction(record: LedgerRecord, accountId: string, signProfile: AccountMapping["signProfile"]): ReconciliationTransaction {
  return {
    id: record.id,
    importBatchId: record.sourceId || record.evidence.fileId,
    source: "LEDGER",
    accountId,
    currency: "BRL",
    sourceRow: sourceRow(record.id, record.evidence.line, record.evidence.page),
    postingDate: record.date,
    amountCents: decimalToCents(record.value) * signConvention(signProfile).ledgerMovementMultiplier,
    description: record.history,
    ...(record.document ? { documentId: record.document } : {}),
    ledgerCounterpartAccount: record.ledgerAccount,
    evidence: { ...record.evidence },
  };
}

function statementTransaction(record: StatementRecord, accountId: string): ReconciliationTransaction {
  return {
    id: record.id,
    importBatchId: record.sourceId || record.evidence.fileId,
    source: "BANK",
    accountId,
    currency: "BRL",
    sourceRow: sourceRow(record.id, record.evidence.line, record.evidence.page),
    postingDate: record.date,
    amountCents: decimalToCents(record.value),
    description: record.history,
    ...(record.document ? { documentId: record.document } : {}),
    evidence: { ...record.evidence },
  };
}

function projectGroup(
  group: ReconciliationMatchGroup,
  audit: ReconciliationAuditEntry | undefined,
  ledgerById: Map<string, LedgerRecord>,
  statementById: Map<string, StatementRecord>,
): ReconciliationResult {
  const ledgers = group.ledgerTransactionIds.map((id) => ledgerById.get(id)!).filter(Boolean);
  const statements = group.bankTransactionIds.map((id) => statementById.get(id)!).filter(Boolean);
  const status = publicStatus(group.type);
  return {
    id: group.id,
    status,
    rule: group.ruleId,
    decisionLevel: "AUTOMATIC",
    reason: reason(status),
    ...(ledgers[0] ? { ledger: ledgers[0] } : {}),
    ...(statements[0] ? { statement: statements[0] } : {}),
    ledgers,
    statements,
    valueDifference: centsToDecimal(group.differenceCents),
    valueTolerance: "0.00",
    ruleVersion: group.ruleVersion,
    ...(group.score !== undefined ? { score: group.score } : {}),
    matchGroup: group,
    ...(audit ? { audit } : {}),
  };
}

function projectSingle(
  canonicalStatus: ReconciliationStatus,
  transactionId: string,
  audit: ReconciliationAuditEntry | undefined,
  ledgerById: Map<string, LedgerRecord>,
  statementById: Map<string, StatementRecord>,
): ReconciliationResult {
  const status: ResultStatus = canonicalStatus === "EXCLUDED_AUTO_APPLICATION" ? "AUTO_APPLICATION_EXCLUDED"
    : canonicalStatus === "BANK_ONLY" ? "STATEMENT_WITHOUT_LEDGER" : "LEDGER_WITHOUT_STATEMENT";
  const ledger = ledgerById.get(transactionId);
  const statement = statementById.get(transactionId);
  return {
    id: audit?.id ?? deterministicId([status, transactionId]),
    status,
    rule: audit?.ruleId ?? "RF-09",
    decisionLevel: decisionLevel(status),
    reason: reason(status),
    ...(ledger ? { ledger, ledgers: [ledger] } : {}),
    ...(statement ? { statement, statements: [statement] } : {}),
    valueTolerance: "0.00",
    ruleVersion: audit?.ruleVersion ?? "1.0",
    ...(audit ? { audit } : {}),
  };
}

function projectAmbiguousSingle(
  transactionId: string,
  ambiguityGroup: AmbiguityGroup,
  ledgerById: Map<string, LedgerRecord>,
  statementById: Map<string, StatementRecord>,
): ReconciliationResult {
  const ledger = ledgerById.get(transactionId);
  const statement = statementById.get(transactionId);
  const ledgers = ambiguityGroup.ledgerCandidateIds.map((id) => ledgerById.get(id)).filter((item): item is LedgerRecord => Boolean(item));
  const statements = ambiguityGroup.statementCandidateIds.map((id) => statementById.get(id)).filter((item): item is StatementRecord => Boolean(item));
  return {
    id: deterministicId(["AMBIGUOUS_MATCH", ambiguityGroup.id, transactionId]),
    status: "AMBIGUOUS_MATCH",
    rule: "RF-02",
    decisionLevel: "REVIEW_REQUIRED",
    reason: ambiguityGroup.reason,
    ...(ledger ? { ledger } : {}),
    ...(statement ? { statement } : {}),
    ledgers,
    statements,
    ...(ledger ? { candidates: statements } : {}),
    ambiguityGroup,
    valueTolerance: "0.00",
    ruleVersion: "1.0",
  };
}

function unmappedResult(status: ResultStatus, rule: string, ledger?: LedgerRecord, statement?: StatementRecord): ReconciliationResult {
  return {
    id: deterministicId([status, ledger?.id ?? "", statement?.id ?? ""]),
    status,
    rule,
    decisionLevel: "REVIEW_REQUIRED",
    reason: reason(status),
    ...(ledger ? { ledger, ledgers: [ledger] } : {}),
    ...(statement ? { statement, statements: [statement] } : {}),
    valueTolerance: "0.00",
    ruleVersion: "1.0",
  };
}

function publicStatus(type: ReconciliationMatchGroup["type"]): ResultStatus {
  if (type === "exact") return "AUTO_MATCH_EXACT";
  if (type === "unique-value") return "AUTO_MATCH_UNIQUE_VALUE";
  if (type === "date-window") return "AUTO_MATCH_DATE_TOLERANCE";
  if (type === "daily-total") return "AUTO_MATCH_DAILY_TOTAL";
  if (type === "bank-net-zero") return "BANK_NET_ZERO";
  return "AUTO_MATCH_GROUP";
}

function reason(status: ResultStatus): string {
  const reasons: Record<ResultStatus, string> = {
    AUTO_MATCH_EXACT: "Data e valor em centavos coincidem.",
    AUTO_MATCH_UNIQUE_VALUE: "O valor em centavos é único no escopo e competência confirmados.",
    AUTO_MATCH_DATE_TOLERANCE: "O mesmo valor foi encontrado em até três dias.",
    AUTO_MATCH_VALUE_DATE: "Data e valor coincidem.",
    AUTO_MATCH_GROUP: "Valores de mesmo sinal fecham exatamente em grupo.",
    AUTO_MATCH_DAILY_TOTAL: "Os resíduos dos dois lados fecham exatamente no dia.",
    BANK_NET_ZERO: "Movimentos bancários opostos no mesmo dia não produzem efeito líquido.",
    AUTO_APPLICATION_EXCLUDED: "Movimento bancário segregado como aplicação automática.",
    GROUP_SUGGESTION: "Lote determinístico sugerido para conferência manual.",
    VALUE_ONLY_SUGGESTION: "O valor isolado não autoriza conciliação.",
    VALUE_DIVERGENCE: "Os valores em centavos divergem.",
    DATE_DIVERGENCE: "As datas estão fora da janela permitida.",
    LEDGER_WITHOUT_STATEMENT: "Lançamento contábil permaneceu somente no razão.",
    STATEMENT_WITHOUT_LEDGER: "Movimento bancário permaneceu somente no extrato.",
    AMBIGUOUS_MATCH: "Não houve vantagem suficiente entre candidatos.",
    POSSIBLE_DUPLICATE: "Possível duplicidade de origem.",
  };
  return reasons[status];
}

function summarize(ledgerAccount: string, results: ReconciliationResult[], mapping: AccountMapping) {
  const uniqueLedgers = uniqueBy(results.flatMap((item) => item.ledgers ?? (item.ledger ? [item.ledger] : [])));
  const uniqueStatements = uniqueBy(results.flatMap((item) => item.statements ?? (item.statement ? [item.statement] : [])));
  const ledgerBalance = uniqueLedgers.reduce(
    (sum, item) => sum + decimalToCents(item.value) * signConvention(mapping.signProfile).ledgerMovementMultiplier,
    0n,
  );
  const statementBalance = uniqueStatements.reduce((sum, item) => sum + decimalToCents(item.value), 0n);
  const reconciledResults = results.filter((item) => reconciledStatuses.has(item.status));
  const nonReconciledResults = results.filter((item) => !reconciledStatuses.has(item.status));
  const suggestedResults = results.filter((item) => item.status === "GROUP_SUGGESTION");
  return {
    ledgerAccount,
    statementAccounts: [...new Set(uniqueStatements.map((item) => `${item.bank} ${item.agency}/${item.bankAccount}`))],
    ledgerBalance: centsToDecimal(ledgerBalance.toString()),
    statementBalance: centsToDecimal(statementBalance.toString()),
    balanceDifference: centsToDecimal((ledgerBalance - statementBalance).toString()),
    reconciledCount: reconciledResults.length,
    reconciledValue: centsToDecimal(reconciledResults.reduce((sum, item) =>
      sum + (item.matchGroup ? BigInt(item.matchGroup.ledgerTotalCents) : item.ledger ? decimalToCents(item.ledger.value) : 0n), 0n).toString()),
    suggestedGroupCount: suggestedResults.length,
    suggestedLedgerCount: uniqueBy(suggestedResults.flatMap((item) => item.ledgers ?? (item.ledger ? [item.ledger] : []))).length,
    suggestedStatementCount: uniqueBy(suggestedResults.flatMap((item) => item.statements ?? (item.statement ? [item.statement] : []))).length,
    divergenceCount: 0,
    ledgerWithoutStatementCount: results.filter((item) => item.status === "LEDGER_WITHOUT_STATEMENT").length,
    statementWithoutLedgerCount: results.filter((item) => item.status === "STATEMENT_WITHOUT_LEDGER").length,
    ambiguityCount: results.filter((item) => item.status === "AMBIGUOUS_MATCH").length,
    duplicateCount: 0,
    status: nonReconciledResults.length === 0 ? "CONCILIADA" as const : "COM_DIVERGENCIAS" as const,
  };
}

function eligibleLedger(record: LedgerRecord): boolean {
  return decimalToCents(record.value) !== 0n;
}

function eligibleStatement(record: StatementRecord): boolean {
  return decimalToCents(record.value) !== 0n && normalizeBasic(record.history) !== "SALDO ANTERIOR";
}

function normalizeBasic(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
}

function decimalToCents(value: string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Valor monetário inválido para conciliação: ${value}`);
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}

function centsToDecimal(value: string): string {
  const cents = BigInt(value);
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function sourceRow(id: string, line?: number, page?: number): number {
  if (line !== undefined) return line;
  if (page !== undefined) return page;
  return Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16);
}

function stableMappings(mappings: AccountMapping[]): AccountMapping[] {
  const byLedgerAccount = new Map<string, AccountMapping>();
  for (const mapping of mappings) {
    const existing = byLedgerAccount.get(mapping.ledgerAccount);
    if (existing && existing.signProfile !== mapping.signProfile) {
      throw new Error(`Conta contábil ${mapping.ledgerAccount} possui convenções de sinais conflitantes.`);
    }
    byLedgerAccount.set(mapping.ledgerAccount, {
      ledgerAccount: mapping.ledgerAccount,
      signProfile: mapping.signProfile,
      statementFileIds: [...new Set([...(existing?.statementFileIds ?? []), ...mapping.statementFileIds])].sort(),
    });
  }
  return [...byLedgerAccount.values()].sort((left, right) => left.ledgerAccount.localeCompare(right.ledgerAccount));
}

function stableLedgers(ledgers: LedgerRecord[]): LedgerRecord[] {
  return [...ledgers].sort((left, right) => left.id.localeCompare(right.id));
}

function stableStatements(statements: StatementRecord[]): StatementRecord[] {
  return [...statements].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueBy<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function decisionLevel(status: ResultStatus): DecisionLevel {
  return automaticStatuses.has(status) ? "AUTOMATIC" : "REVIEW_REQUIRED";
}

function deterministicId(parts: string[]): string {
  return `REC-${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12).toUpperCase()}`;
}

function transactionSetKey(ids: string[]): string {
  return [...ids].sort().join("\u0000");
}

function signConvention(profile: AccountMapping["signProfile"]): {
  ledgerMovementMultiplier: bigint;
  ledgerBalanceMultiplier: bigint;
} {
  if (profile === "BANK_LIABILITY") {
    return { ledgerMovementMultiplier: 1n, ledgerBalanceMultiplier: -1n };
  }
  return { ledgerMovementMultiplier: -1n, ledgerBalanceMultiplier: 1n };
}

function consolidatedControls(
  engines: ReconciliationEngineOutput[],
  results: ReconciliationResult[],
  confirmation: ConfirmProcessingRequest,
  scopedLedgers: LedgerRecord[],
  preflight?: Pick<PreflightResult, "ledgerAccounts" | "statements">,
): ProcessingControls {
  const transactions = engines.flatMap((engine) => engine.transactions);
  const conciliableBank = transactions.filter(
    (item) => item.source === "BANK" && item.status !== "EXCLUDED_AUTO_APPLICATION",
  );
  const ledger = transactions.filter((item) => item.source === "LEDGER");
  const bankMovement = totalCents(conciliableBank.map((item) => item.amountCents));
  const ledgerMovement = totalCents(ledger.map((item) => item.amountCents));
  const movementDifference = bankMovement - ledgerMovement;
  const coveredStatuses = new Set([
    "RECONCILED_EXACT",
    "RECONCILED_DATE_WINDOW",
    "RECONCILED_GROUP",
    "RECONCILED_DAILY_TOTAL",
  ]);
  const suggestedTransactionIds = new Set(
    results
      .filter((item) => item.status === "GROUP_SUGGESTION" && item.matchGroup?.status === "suggested")
      .flatMap((item) => [
        ...(item.matchGroup?.bankTransactionIds ?? []),
        ...(item.matchGroup?.ledgerTransactionIds ?? []),
      ]),
  );

  // 1. Ledger Coverage (Razão)
  const ledgerTransactions = transactions.filter((item) => item.source === "LEDGER");
  const ledgerCovered = ledgerTransactions.filter((item) => coveredStatuses.has(item.status));
  const ledgerSuggested = ledgerTransactions.filter((item) => suggestedTransactionIds.has(item.id));
  const ledgerPending = ledgerTransactions.filter(
    (item) => !coveredStatuses.has(item.status) && !suggestedTransactionIds.has(item.id),
  );
  const ledgerPotential = [...ledgerCovered, ...ledgerSuggested];
  const ledgerCoveredLines = ledgerCovered.length;
  const ledgerTotalLines = ledgerTransactions.length;
  const ledgerPendingLines = ledgerPending.length;
  const ledgerLinePct = percentage(BigInt(ledgerCoveredLines), BigInt(ledgerTotalLines));
  const ledgerCoveredAbs = totalCents(ledgerCovered.map((item) => absoluteCents(item.amountCents)));
  const ledgerTotalAbs = totalCents(ledgerTransactions.map((item) => absoluteCents(item.amountCents)));
  const ledgerPendingAbs = totalCents(ledgerPending.map((item) => absoluteCents(item.amountCents)));
  const ledgerValuePct = percentage(ledgerCoveredAbs, ledgerTotalAbs);

  // 2. Statement Operational Coverage (Extrato Operacional, sem aplicações automáticas)
  const stmtOperationalTransactions = transactions.filter(
    (item) => item.source === "BANK" && item.status !== "EXCLUDED_AUTO_APPLICATION",
  );
  const stmtOperationalCovered = stmtOperationalTransactions.filter((item) => coveredStatuses.has(item.status));
  const stmtOperationalSuggested = stmtOperationalTransactions.filter((item) => suggestedTransactionIds.has(item.id));
  const stmtOperationalPending = stmtOperationalTransactions.filter(
    (item) => !coveredStatuses.has(item.status) && !suggestedTransactionIds.has(item.id),
  );
  const stmtOperationalPotential = [...stmtOperationalCovered, ...stmtOperationalSuggested];
  const stmtOperationalCoveredLines = stmtOperationalCovered.length;
  const stmtOperationalTotalLines = stmtOperationalTransactions.length;
  const stmtOperationalPendingLines = stmtOperationalPending.length;
  const stmtOperationalLinePct = percentage(BigInt(stmtOperationalCoveredLines), BigInt(stmtOperationalTotalLines));
  const stmtOperationalCoveredAbs = totalCents(stmtOperationalCovered.map((item) => absoluteCents(item.amountCents)));
  const stmtOperationalTotalAbs = totalCents(stmtOperationalTransactions.map((item) => absoluteCents(item.amountCents)));
  const stmtOperationalPendingAbs = totalCents(stmtOperationalPending.map((item) => absoluteCents(item.amountCents)));
  const stmtOperationalValuePct = percentage(stmtOperationalCoveredAbs, stmtOperationalTotalAbs);

  // 3. Statement Total Coverage (Extrato Total, todos os movimentos transacionais do extrato)
  const stmtTotalTransactions = transactions.filter((item) => item.source === "BANK");
  const stmtTotalCovered = stmtTotalTransactions.filter((item) => coveredStatuses.has(item.status));
  const stmtTotalSuggested = stmtTotalTransactions.filter((item) => suggestedTransactionIds.has(item.id));
  const stmtTotalPending = stmtTotalTransactions.filter(
    (item) => !coveredStatuses.has(item.status)
      && !suggestedTransactionIds.has(item.id)
      && item.status !== "EXCLUDED_AUTO_APPLICATION",
  );
  const stmtTotalPotential = [...stmtTotalCovered, ...stmtTotalSuggested];
  const stmtTotalCoveredLines = stmtTotalCovered.length;
  const stmtTotalTotalLines = stmtTotalTransactions.length;
  const stmtTotalPendingLines = stmtTotalPending.length;
  const stmtTotalLinePct = percentage(BigInt(stmtTotalCoveredLines), BigInt(stmtTotalTotalLines));
  const stmtTotalCoveredAbs = totalCents(stmtTotalCovered.map((item) => absoluteCents(item.amountCents)));
  const stmtTotalTotalAbs = totalCents(stmtTotalTransactions.map((item) => absoluteCents(item.amountCents)));
  const stmtTotalPendingAbs = totalCents(stmtTotalPending.map((item) => absoluteCents(item.amountCents)));
  const stmtTotalValuePct = percentage(stmtTotalCoveredAbs, stmtTotalTotalAbs);

  // 4. Overall Operational Coverage (Geral Operacional: Razão + Extrato Operacional)
  const overallOperationalTotalLines = ledgerTotalLines + stmtOperationalTotalLines;
  const overallOperationalCoveredLines = ledgerCoveredLines + stmtOperationalCoveredLines;
  const overallOperationalPendingLines = ledgerPendingLines + stmtOperationalPendingLines;
  const overallOperationalLinePct = percentage(
    BigInt(overallOperationalCoveredLines),
    BigInt(overallOperationalTotalLines),
  );
  const overallOperationalTotalAbs = ledgerTotalAbs + stmtOperationalTotalAbs;
  const overallOperationalCoveredAbs = ledgerCoveredAbs + stmtOperationalCoveredAbs;
  const overallOperationalPendingAbs = ledgerPendingAbs + stmtOperationalPendingAbs;
  const overallOperationalValuePct = percentage(overallOperationalCoveredAbs, overallOperationalTotalAbs);

  const counts = new Map<ResultStatus, bigint>();
  for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0n) + 1n);
  const pending = new Map<string, { bankCount: bigint; ledgerCount: bigint; bankValue: bigint; ledgerValue: bigint }>();
  for (const transaction of transactions.filter(
    (item) => (item.status === "BANK_ONLY" || item.status === "LEDGER_ONLY")
      && !suggestedTransactionIds.has(item.id),
  )) {
    const current = pending.get(transaction.postingDate) ?? {
      bankCount: 0n,
      ledgerCount: 0n,
      bankValue: 0n,
      ledgerValue: 0n,
    };
    if (transaction.source === "BANK") {
      current.bankCount += 1n;
      current.bankValue += BigInt(transaction.amountCents);
    } else {
      current.ledgerCount += 1n;
      current.ledgerValue += BigInt(transaction.amountCents);
    }
    pending.set(transaction.postingDate, current);
  }
  const balances = consolidatedBalances(confirmation, scopedLedgers, preflight);
  const suggestedCoverage = coverageDimensions(
    ledgerSuggested,
    ledgerTransactions,
    ledgerPending,
    stmtOperationalSuggested,
    stmtOperationalTransactions,
    stmtOperationalPending,
    stmtTotalSuggested,
    stmtTotalTransactions,
    stmtTotalPending,
    "sugerida",
  );
  const potentialCoverage = coverageDimensions(
    ledgerPotential,
    ledgerTransactions,
    ledgerPending,
    stmtOperationalPotential,
    stmtOperationalTransactions,
    stmtOperationalPending,
    stmtTotalPotential,
    stmtTotalTransactions,
    stmtTotalPending,
    "potencial",
  );
  return {
    tolerance: centsToDecimal(CONTROL_TOLERANCE_CENTS.toString()),
    signProfiles: [...new Set(confirmation.mappings.map((item) => item.signProfile))].sort(),
    movements: {
      bankConciliable: centsToDecimal(bankMovement.toString()),
      ledger: centsToDecimal(ledgerMovement.toString()),
      difference: centsToDecimal(movementDifference.toString()),
      status: controlStatus(movementDifference),
    },
    balances,
    coverage: {
      lines: {
        covered: String(overallOperationalCoveredLines),
        total: String(overallOperationalTotalLines),
        pending: String(overallOperationalPendingLines),
        percentage: overallOperationalLinePct,
        formula: "(razão conciliado + extrato operacional conciliado) / (razão elegível + extrato operacional elegível)",
        label: "Cobertura geral operacional",
      },
      absoluteValue: {
        covered: centsToDecimal(overallOperationalCoveredAbs.toString()),
        total: centsToDecimal(overallOperationalTotalAbs.toString()),
        pending: centsToDecimal(overallOperationalPendingAbs.toString()),
        percentage: overallOperationalValuePct,
        formula: "(valor razão conciliado + valor extrato operacional conciliado) / valor elegível total",
        label: "Cobertura geral operacional de valor",
      },
      ledger: {
        lines: {
          covered: String(ledgerCoveredLines),
          total: String(ledgerTotalLines),
          pending: String(ledgerPendingLines),
          percentage: ledgerLinePct,
          formula: "linhas do razão conciliadas / linhas elegíveis do razão",
          label: "Cobertura do razão",
        },
        absoluteValue: {
          covered: centsToDecimal(ledgerCoveredAbs.toString()),
          total: centsToDecimal(ledgerTotalAbs.toString()),
          pending: centsToDecimal(ledgerPendingAbs.toString()),
          percentage: ledgerValuePct,
          formula: "valor absoluto do razão conciliado / valor absoluto elegível do razão",
          label: "Cobertura de valor do razão",
        },
      },
      statementOperational: {
        lines: {
          covered: String(stmtOperationalCoveredLines),
          total: String(stmtOperationalTotalLines),
          pending: String(stmtOperationalPendingLines),
          percentage: stmtOperationalLinePct,
          formula: "linhas operacionais do extrato conciliadas / linhas operacionais elegíveis",
          label: "Cobertura do extrato operacional",
        },
        absoluteValue: {
          covered: centsToDecimal(stmtOperationalCoveredAbs.toString()),
          total: centsToDecimal(stmtOperationalTotalAbs.toString()),
          pending: centsToDecimal(stmtOperationalPendingAbs.toString()),
          percentage: stmtOperationalValuePct,
          formula: "valor absoluto operacional conciliado / valor absoluto operacional elegível",
          label: "Cobertura de valor do extrato operacional",
        },
      },
      statementTotal: {
        lines: {
          covered: String(stmtTotalCoveredLines),
          total: String(stmtTotalTotalLines),
          pending: String(stmtTotalPendingLines),
          percentage: stmtTotalLinePct,
          formula: "linhas do extrato conciliadas / total de movimentos transacionais do extrato",
          label: "Cobertura do extrato total",
        },
        absoluteValue: {
          covered: centsToDecimal(stmtTotalCoveredAbs.toString()),
          total: centsToDecimal(stmtTotalTotalAbs.toString()),
          pending: centsToDecimal(stmtTotalPendingAbs.toString()),
          percentage: stmtTotalValuePct,
          formula: "valor absoluto conciliado do extrato / valor absoluto transacional total do extrato",
          label: "Cobertura de valor do extrato total",
        },
      },
      overallOperational: {
        lines: {
          covered: String(overallOperationalCoveredLines),
          total: String(overallOperationalTotalLines),
          pending: String(overallOperationalPendingLines),
          percentage: overallOperationalLinePct,
          formula: "(razão conciliado + extrato operacional conciliado) / (razão elegível + extrato operacional elegível)",
          label: "Cobertura geral operacional",
        },
        absoluteValue: {
          covered: centsToDecimal(overallOperationalCoveredAbs.toString()),
          total: centsToDecimal(overallOperationalTotalAbs.toString()),
          pending: centsToDecimal(overallOperationalPendingAbs.toString()),
          percentage: overallOperationalValuePct,
          formula: "(valor razão conciliado + valor extrato operacional conciliado) / valor elegível total",
          label: "Cobertura geral operacional de valor",
        },
      },
      statement: {
        lines: {
          covered: String(stmtTotalCoveredLines),
          total: String(stmtTotalTotalLines),
          pending: String(stmtTotalPendingLines),
          percentage: stmtTotalLinePct,
          formula: "linhas do extrato conciliadas / total de movimentos transacionais do extrato",
          label: "Cobertura do extrato total",
        },
        absoluteValue: {
          covered: centsToDecimal(stmtTotalCoveredAbs.toString()),
          total: centsToDecimal(stmtTotalTotalAbs.toString()),
          pending: centsToDecimal(stmtTotalPendingAbs.toString()),
          percentage: stmtTotalValuePct,
          formula: "valor absoluto conciliado do extrato / valor absoluto transacional total do extrato",
          label: "Cobertura de valor do extrato total",
        },
      },
      operational: {
        lines: {
          covered: String(stmtOperationalCoveredLines),
          total: String(stmtOperationalTotalLines),
          pending: String(stmtOperationalPendingLines),
          percentage: stmtOperationalLinePct,
          formula: "linhas operacionais do extrato conciliadas / linhas operacionais elegíveis",
          label: "Cobertura do extrato operacional",
        },
        absoluteValue: {
          covered: centsToDecimal(stmtOperationalCoveredAbs.toString()),
          total: centsToDecimal(stmtOperationalTotalAbs.toString()),
          pending: centsToDecimal(stmtOperationalPendingAbs.toString()),
          percentage: stmtOperationalValuePct,
          formula: "valor absoluto operacional conciliado / valor absoluto operacional elegível",
          label: "Cobertura de valor do extrato operacional",
        },
      },
      overall: {
        lines: {
          covered: String(overallOperationalCoveredLines),
          total: String(overallOperationalTotalLines),
          pending: String(overallOperationalPendingLines),
          percentage: overallOperationalLinePct,
          formula: "(razão conciliado + extrato operacional conciliado) / (razão elegível + extrato operacional elegível)",
          label: "Cobertura geral operacional",
        },
        absoluteValue: {
          covered: centsToDecimal(overallOperationalCoveredAbs.toString()),
          total: centsToDecimal(overallOperationalTotalAbs.toString()),
          pending: centsToDecimal(overallOperationalPendingAbs.toString()),
          percentage: overallOperationalValuePct,
          formula: "(valor razão conciliado + valor extrato operacional conciliado) / valor elegível total",
          label: "Cobertura geral operacional de valor",
        },
      },
      suggested: suggestedCoverage,
      potential: potentialCoverage,
    },
    countsByStatus: resultStatuses
      .filter((status) => counts.has(status))
      .map((status) => ({ status, count: String(counts.get(status)!) })),
    pendingByDate: [...pending.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, item]) => ({
      date,
      bankCount: String(item.bankCount),
      ledgerCount: String(item.ledgerCount),
      bankValue: centsToDecimal(item.bankValue.toString()),
      ledgerValue: centsToDecimal(item.ledgerValue.toString()),
      difference: centsToDecimal((item.bankValue - item.ledgerValue).toString()),
    })),
  };
}

function coverageDimensions(
  ledgerCovered: CoverageTransaction[],
  ledgerTotal: CoverageTransaction[],
  ledgerPending: CoverageTransaction[],
  statementOperationalCovered: CoverageTransaction[],
  statementOperationalTotal: CoverageTransaction[],
  statementOperationalPending: CoverageTransaction[],
  statementTotalCovered: CoverageTransaction[],
  statementTotal: CoverageTransaction[],
  statementTotalPending: CoverageTransaction[],
  qualifier: "sugerida" | "potencial",
): NonNullable<ProcessingControls["coverage"]["suggested"]> {
  const overallCovered = [...ledgerCovered, ...statementOperationalCovered];
  const overallTotal = [...ledgerTotal, ...statementOperationalTotal];
  const overallPending = [...ledgerPending, ...statementOperationalPending];
  return {
    ledger: coverageBreakdown(ledgerCovered, ledgerTotal, ledgerPending, `Cobertura ${qualifier} do razão`),
    statementOperational: coverageBreakdown(
      statementOperationalCovered,
      statementOperationalTotal,
      statementOperationalPending,
      `Cobertura ${qualifier} do extrato operacional`,
    ),
    statementTotal: coverageBreakdown(
      statementTotalCovered,
      statementTotal,
      statementTotalPending,
      `Cobertura ${qualifier} do extrato total`,
    ),
    overallOperational: coverageBreakdown(
      overallCovered,
      overallTotal,
      overallPending,
      `Cobertura geral operacional ${qualifier}`,
    ),
  };
}

function coverageBreakdown(
  covered: CoverageTransaction[],
  total: CoverageTransaction[],
  pending: CoverageTransaction[],
  label: string,
): NonNullable<ProcessingControls["coverage"]["suggested"]>["ledger"] {
  const coveredValue = totalCents(covered.map((item) => absoluteCents(item.amountCents)));
  const totalValue = totalCents(total.map((item) => absoluteCents(item.amountCents)));
  const pendingValue = totalCents(pending.map((item) => absoluteCents(item.amountCents)));
  return {
    lines: {
      covered: String(covered.length),
      total: String(total.length),
      pending: String(pending.length),
      percentage: percentage(BigInt(covered.length), BigInt(total.length)),
      formula: `${label.toLocaleLowerCase("pt-BR")} / linhas elegíveis`,
      label,
    },
    absoluteValue: {
      covered: centsToDecimal(coveredValue.toString()),
      total: centsToDecimal(totalValue.toString()),
      pending: centsToDecimal(pendingValue.toString()),
      percentage: percentage(coveredValue, totalValue),
      formula: `${label.toLocaleLowerCase("pt-BR")} em valor absoluto / valor absoluto elegível`,
      label: `${label} de valor`,
    },
  };
}

function consolidatedBalances(
  confirmation: ConfirmProcessingRequest,
  scopedLedgers: LedgerRecord[],
  preflight?: Pick<PreflightResult, "ledgerAccounts" | "statements">,
): ProcessingControls["balances"] {
  if (!preflight) {
    return { openingStatus: "NOT_AVAILABLE", closingStatus: "NOT_AVAILABLE" };
  }
  const ledgerOpening: bigint[] = [];
  const ledgerClosing: bigint[] = [];
  const bankOpening: bigint[] = [];
  const bankClosing: bigint[] = [];
  for (const mapping of stableMappings(confirmation.mappings)) {
    const ledgerMetadata = preflight.ledgerAccounts.find((item) => item.account === mapping.ledgerAccount);
    const convention = signConvention(mapping.signProfile);
    const movements = scopedLedgers
      .filter((item) => item.ledgerAccount === mapping.ledgerAccount)
      .sort((left, right) => left.date.localeCompare(right.date)
        || sourceRow(left.id, left.evidence.line, left.evidence.page) - sourceRow(right.id, right.evidence.line, right.evidence.page)
        || left.id.localeCompare(right.id));
    const first = movements[0];
    const last = movements.at(-1);
    const movementEffect = ledgerMetadata?.balanceMovementEffect ?? "ADDS_TO_BALANCE";
    if (first?.runningBalance !== undefined) {
      const balanceAfterFirst = decimalToCents(first.runningBalance);
      const firstMovement = decimalToCents(first.value);
      const opening = movementEffect === "SUBTRACTS_FROM_BALANCE"
        ? balanceAfterFirst + firstMovement
        : balanceAfterFirst - firstMovement;
      ledgerOpening.push(opening * convention.ledgerBalanceMultiplier);
    } else if (ledgerMetadata?.openingBalance !== undefined) {
      ledgerOpening.push(decimalToCents(ledgerMetadata.openingBalance) * convention.ledgerBalanceMultiplier);
    }
    if (last?.runningBalance !== undefined) {
      ledgerClosing.push(decimalToCents(last.runningBalance) * convention.ledgerBalanceMultiplier);
    } else if (ledgerMetadata?.closingBalance !== undefined) {
      ledgerClosing.push(decimalToCents(ledgerMetadata.closingBalance) * convention.ledgerBalanceMultiplier);
    }
    for (const fileId of mapping.statementFileIds) {
      const statement = preflight.statements.find((item) => item.fileId === fileId);
      if (statement?.openingBalance !== undefined) bankOpening.push(decimalToCents(statement.openingBalance));
      if (statement?.closingBalance !== undefined) bankClosing.push(decimalToCents(statement.closingBalance));
    }
  }
  const expectedLedgerCount = new Set(confirmation.mappings.map((item) => item.ledgerAccount)).size;
  const expectedBankCount = new Set(confirmation.mappings.flatMap((item) => item.statementFileIds)).size;
  const openingAvailable = ledgerOpening.length === expectedLedgerCount && bankOpening.length === expectedBankCount;
  const closingAvailable = ledgerClosing.length === expectedLedgerCount && bankClosing.length === expectedBankCount;
  const ledgerOpeningTotal = totalCents(ledgerOpening);
  const bankOpeningTotal = totalCents(bankOpening);
  const ledgerClosingTotal = totalCents(ledgerClosing);
  const bankClosingTotal = totalCents(bankClosing);
  const openingDifference = bankOpeningTotal - ledgerOpeningTotal;
  const closingDifference = bankClosingTotal - ledgerClosingTotal;
  return {
    ...(openingAvailable ? {
      bankOpening: centsToDecimal(bankOpeningTotal.toString()),
      ledgerOpening: centsToDecimal(ledgerOpeningTotal.toString()),
      openingDifference: centsToDecimal(openingDifference.toString()),
    } : {}),
    openingStatus: openingAvailable ? controlStatus(openingDifference) : "NOT_AVAILABLE",
    ...(closingAvailable ? {
      bankClosing: centsToDecimal(bankClosingTotal.toString()),
      ledgerClosing: centsToDecimal(ledgerClosingTotal.toString()),
      closingDifference: centsToDecimal(closingDifference.toString()),
    } : {}),
    closingStatus: closingAvailable ? controlStatus(closingDifference) : "NOT_AVAILABLE",
  };
}

function totalCents(values: readonly (string | bigint)[]): bigint {
  return values.reduce<bigint>((sum, value) => sum + BigInt(value), 0n);
}

function absoluteCents(value: string): bigint {
  const cents = BigInt(value);
  return cents < 0n ? -cents : cents;
}

function controlStatus(difference: bigint): ProcessingControls["movements"]["status"] {
  return absoluteCents(difference.toString()) <= CONTROL_TOLERANCE_CENTS ? "PASSED" : "FAILED";
}

function percentage(part: bigint, total: bigint): string {
  if (total === 0n) return "0.00";
  const basisPoints = (part * 10_000n + total / 2n) / total;
  return `${basisPoints / 100n}.${String(basisPoints % 100n).padStart(2, "0")}`;
}

function periodPrefix(period: string): string {
  return `${period.slice(0, 4)}-${period.slice(4, 6)}`;
}

export function resolveGloballyForcedPairs(
  leftIds: readonly string[],
  rightIds: readonly string[],
  candidatePairs: ReadonlyArray<readonly [string, string]>,
): Array<[string, string]> {
  const left = [...new Set(leftIds)].sort();
  const right = [...new Set(rightIds)].sort();
  const pairs = candidatePairs
    .filter(([leftId, rightId]) => left.includes(leftId) && right.includes(rightId))
    .map(([leftId, rightId]) => [leftId, rightId] as [string, string])
    .filter((pair, index, values) => values.findIndex(([leftId, rightId]) => leftId === pair[0] && rightId === pair[1]) === index)
    .sort(([leftA, rightA], [leftB, rightB]) => leftA.localeCompare(leftB) || rightA.localeCompare(rightB));
  const maximum = maximumMatching(left, pairs);
  const maximumSize = maximum.size;
  if (!maximumSize) return [];
  return [...maximum.entries()]
    .filter(([leftId, rightId]) => maximumMatching(left, pairs.filter(([candidateLeft, candidateRight]) => candidateLeft !== leftId || candidateRight !== rightId)).size < maximumSize)
    .sort(([leftA], [leftB]) => leftA.localeCompare(leftB));
}

function maximumMatching(leftIds: readonly string[], pairs: ReadonlyArray<readonly [string, string]>): Map<string, string> {
  const candidatesByLeft = new Map<string, string[]>();
  for (const [leftId, rightId] of pairs) candidatesByLeft.set(leftId, [...(candidatesByLeft.get(leftId) ?? []), rightId]);
  for (const candidates of candidatesByLeft.values()) candidates.sort();
  const leftByRight = new Map<string, string>();
  const tryAugment = (leftId: string, visited: Set<string>): boolean => {
    for (const rightId of candidatesByLeft.get(leftId) ?? []) {
      if (visited.has(rightId)) continue;
      visited.add(rightId);
      const currentLeft = leftByRight.get(rightId);
      if (!currentLeft || tryAugment(currentLeft, visited)) {
        leftByRight.set(rightId, leftId);
        return true;
      }
    }
    return false;
  };
  for (const leftId of [...leftIds].sort()) tryAugment(leftId, new Set());
  return new Map([...leftByRight.entries()].map(([rightId, leftId]) => [leftId, rightId]));
}

export interface CandidateDiagnosticStatement {
  source: "statement";
  originalRowIndex: number;
  parsedDate: string;
  rawDescription: string;
  normalizedDescription: string;
  extractedDocument: string | null;
  normalizedDocument: string | null;
  rawAmount: string;
  parsedAmountCents: string;
  sign: "positive" | "negative";
  eligibility: string;
  category: string;
  bankHint?: string | null | undefined;
  finalStatus: string;
}

export interface CandidateDiagnosticLedger {
  source: "ledger";
  originalRowIndex: number;
  parsedDate: string;
  rawHistory: string;
  normalizedHistory: string;
  extractedDocument: string | null;
  normalizedDocument: string | null;
  debitCents: string;
  creditCents: string;
  parsedAmountCents: string;
  sign: "positive" | "negative";
  accountingAccount: string;
  counterpartyAccount: string | null;
  category: string;
  bankHint?: string | null | undefined;
  eligibility: string;
  finalStatus: string;
}

export interface CandidateCompetingEntry {
  source: "ledger" | "statement";
  date: string;
  description: string;
  amountCents: string;
  normalizedDocument?: string | undefined;
  semanticCategory?: string | undefined;
  bankHint?: string | undefined;
  score: number;
  rejectionReason?: string | undefined;
}

export interface CandidateComparisonDiagnostic {
  statementLine: string;
  ledgerLine: string;
  sameDate: boolean;
  dateDiffDays: number;
  sameAmount: boolean;
  sameAbsAmount: boolean;
  sameSignAfterConvention: boolean;
  documentCompatible: boolean;
  descriptionCompatible: boolean;
  semanticCategoryCompatible: boolean;
  bankHintCompatible?: boolean | undefined;
  wasCandidateGenerated: boolean;
  score?: CandidateScoreBreakdown | undefined;
  competingCandidates?: CandidateCompetingEntry[] | undefined;
  rejectedByRule?: string | undefined;
  rejectionReason?: string | undefined;
  finalDecision: "MATCHED" | "REJECTED" | "AMBIGUOUS" | "NOT_CANDIDATE";
}

export interface CandidateDiagnosticTraceOutput {
  statement?: CandidateDiagnosticStatement | undefined;
  ledger?: CandidateDiagnosticLedger | undefined;
  candidateComparison: CandidateComparisonDiagnostic;
}

export interface CandidateDiagnosticTraceInput {
  statementRecord?: StatementRecord | undefined;
  ledgerRecord?: LedgerRecord | undefined;
  statementLine?: string | undefined;
  ledgerLine?: string | undefined;
  statementHint?: string | undefined;
  ledgerHint?: string | undefined;
  amountCents?: string | undefined;
  date?: string | undefined;
  signProfile?: AccountMapping["signProfile"] | undefined;
  dateToleranceDays?: number | undefined;
  competingLedgers?: LedgerRecord[] | undefined;
  competingStatements?: StatementRecord[] | undefined;
  hasAmbiguity?: boolean | undefined;
}

export function traceReconciliationCandidate(input: CandidateDiagnosticTraceInput): CandidateDiagnosticTraceOutput {
  const stmt = input.statementRecord;
  const ldg = input.ledgerRecord;
  const signProfile = input.signProfile ?? "BANK_LIABILITY";
  const dateTolerance = input.dateToleranceDays ?? 2;

  let stmtDiag: CandidateDiagnosticStatement | undefined;
  if (stmt) {
    const stmtCents = decimalToCents(stmt.value);
    const stmtTokens = normalizeReconciliationText(stmt.history);
    const stmtCategories = extractSemanticCategories(stmt.history);
    const stmtBank = extractBankHint(stmt.history);
    const normDoc = stmt.document ? normalizeDocumentId(stmt.document) : null;
    stmtDiag = {
      source: "statement",
      originalRowIndex: stmt.evidence.line ?? 0,
      parsedDate: stmt.date,
      rawDescription: stmt.history,
      normalizedDescription: stmtTokens.join(" "),
      extractedDocument: stmt.document || null,
      normalizedDocument: normDoc,
      rawAmount: stmt.value,
      parsedAmountCents: stmtCents.toString(),
      sign: stmtCents >= 0n ? "positive" : "negative",
      eligibility: eligibleStatement(stmt) ? "ELIGIBLE" : "INELIGIBLE",
      category: stmtCategories.join(", ") || "OTHER",
      ...(stmtBank ? { bankHint: stmtBank } : { bankHint: null }),
      finalStatus: "PENDING_EVALUATION",
    };
  }

  let ldgDiag: CandidateDiagnosticLedger | undefined;
  if (ldg) {
    const ldgRawCents = decimalToCents(ldg.value);
    const ldgMultipliedCents = ldgRawCents * signConvention(signProfile).ledgerMovementMultiplier;
    const ldgTokens = normalizeReconciliationText(ldg.history);
    const ldgCategories = extractSemanticCategories(ldg.history);
    const ldgBank = extractBankHint(ldg.history);
    const normDoc = ldg.document ? normalizeDocumentId(ldg.document) : null;
    ldgDiag = {
      source: "ledger",
      originalRowIndex: ldg.evidence.line ?? 0,
      parsedDate: ldg.date,
      rawHistory: ldg.history,
      normalizedHistory: ldgTokens.join(" "),
      extractedDocument: ldg.document || null,
      normalizedDocument: normDoc,
      debitCents: ldgRawCents > 0n ? ldgRawCents.toString() : "0",
      creditCents: ldgRawCents < 0n ? (-ldgRawCents).toString() : "0",
      parsedAmountCents: ldgMultipliedCents.toString(),
      sign: ldgMultipliedCents >= 0n ? "positive" : "negative",
      accountingAccount: ldg.ledgerAccount,
      counterpartyAccount: null,
      category: ldgCategories.join(", ") || "OTHER",
      ...(ldgBank ? { bankHint: ldgBank } : { bankHint: null }),
      eligibility: eligibleLedger(ldg) ? "ELIGIBLE" : "INELIGIBLE",
      finalStatus: "PENDING_EVALUATION",
    };
  }

  const stmtLine = input.statementLine ?? (stmt ? `${stmt.date} - ${stmt.history} - R$ ${stmt.value}` : (input.statementHint ?? ""));
  const ldgLine = input.ledgerLine ?? (ldg ? `${ldg.date} - ${ldg.history} - R$ ${ldg.value}` : (input.ledgerHint ?? ""));

  let sameDate = false;
  let dateDiff = 999;
  let sameAmount = false;
  let sameAbsAmount = false;
  let sameSignAfterConvention = false;
  let documentCompatible = false;
  let descriptionCompatible = false;
  let semanticCategoryCompatible = false;
  let bankHintCompatible = false;
  let wasCandidateGenerated = false;
  let scoreBreakdown: CandidateScoreBreakdown | undefined;
  let competingList: CandidateCompetingEntry[] | undefined;
  let rejectedByRule: string | undefined;
  let rejectionReason: string | undefined;
  let finalDecision: "MATCHED" | "REJECTED" | "AMBIGUOUS" | "NOT_CANDIDATE" = "NOT_CANDIDATE";

  if (stmt && ldg) {
    sameDate = stmt.date === ldg.date;
    dateDiff = dayDifference(stmt.date, ldg.date);
    const stmtCents = decimalToCents(stmt.value);
    const ldgCents = decimalToCents(ldg.value) * signConvention(signProfile).ledgerMovementMultiplier;
    sameAmount = stmtCents === ldgCents;
    sameAbsAmount = absoluteCents(stmtCents.toString()) === absoluteCents(ldgCents.toString());
    sameSignAfterConvention = (stmtCents >= 0n && ldgCents >= 0n) || (stmtCents < 0n && ldgCents < 0n);

    const stmtNormDoc = normalizeDocumentId(stmt.document || "");
    const ldgNormDoc = normalizeDocumentId(ldg.document || "");
    const stmtHint = extractFinancialHint(stmt.history, stmtNormDoc);
    const ldgHint = extractFinancialHint(ldg.history, ldgNormDoc);

    if (stmtNormDoc && ldgNormDoc && stmtNormDoc === ldgNormDoc) {
      documentCompatible = true;
    } else if (stmtHint.comparisonTokens.some((t) => ldgHint.comparisonTokens.includes(t) && /^\d+$/.test(t))) {
      documentCompatible = true;
    }

    const similarity = reconciliationTextSimilarity(stmtHint.comparisonTokens, ldgHint.comparisonTokens);
    descriptionCompatible = similarity >= 0.3 || documentCompatible;

    const stmtCats = extractSemanticCategories(stmt.history);
    const ldgCats = extractSemanticCategories(ldg.history);
    semanticCategoryCompatible = stmtCats.some((c) => ldgCats.includes(c)) || (stmtCats.length === 0 && ldgCats.length === 0);

    const stmtBank = extractBankHint(stmt.history);
    const ldgBank = extractBankHint(ldg.history);
    bankHintCompatible = Boolean(stmtBank && ldgBank && stmtBank === ldgBank);

    wasCandidateGenerated = (sameDate || dateDiff <= dateTolerance) && (sameAmount || sameAbsAmount);

    let hasAmbiguity = Boolean(input.hasAmbiguity);
    if (input.competingLedgers && input.competingLedgers.length > 0) {
      competingList = [];
      const evaluated = [ldg, ...input.competingLedgers];
      const scores: number[] = [];
      for (const comp of evaluated) {
        const compCents = decimalToCents(comp.value) * signConvention(signProfile).ledgerMovementMultiplier;
        const compScore = calculateCandidateScore({
          statementDate: stmt.date,
          ledgerDate: comp.date,
          statementAmountCents: stmtCents,
          ledgerAmountCents: compCents,
          statementDescription: stmt.history,
          ledgerHistory: comp.history,
          statementDocument: stmt.document,
          ledgerDocument: comp.document,
          dateToleranceDays: dateTolerance,
        });
        scores.push(compScore.total);
        competingList.push({
          source: "ledger",
          date: comp.date,
          description: comp.history,
          amountCents: compCents.toString(),
          normalizedDocument: comp.document ? normalizeDocumentId(comp.document) : undefined,
          semanticCategory: extractSemanticCategories(comp.history)[0],
          bankHint: extractBankHint(comp.history),
          score: compScore.total,
          rejectionReason: compScore.decision !== "MATCH" ? compScore.evidence.join("; ") : undefined,
        });
      }
      const topScore = Math.max(...scores);
      const topCount = scores.filter((s) => s === topScore).length;
      if (topCount > 1 && !stmtNormDoc) {
        hasAmbiguity = true;
      }
    }

    scoreBreakdown = calculateCandidateScore({
      statementDate: stmt.date,
      ledgerDate: ldg.date,
      statementAmountCents: stmtCents,
      ledgerAmountCents: ldgCents,
      statementDescription: stmt.history,
      ledgerHistory: ldg.history,
      statementDocument: stmt.document,
      ledgerDocument: ldg.document,
      dateToleranceDays: dateTolerance,
      hasAmbiguity,
    });

    if (scoreBreakdown.decision === "MATCH") {
      finalDecision = "MATCHED";
      if (sameDate && (sameAmount || documentCompatible)) {
        if (stmtDiag) stmtDiag.finalStatus = "AUTO_MATCH_EXACT";
        if (ldgDiag) ldgDiag.finalStatus = "AUTO_MATCH_EXACT";
      } else {
        if (stmtDiag) stmtDiag.finalStatus = "AUTO_MATCH_DATE_TOLERANCE";
        if (ldgDiag) ldgDiag.finalStatus = "AUTO_MATCH_DATE_TOLERANCE";
      }
    } else if (scoreBreakdown.decision === "AMBIGUOUS") {
      finalDecision = "AMBIGUOUS";
      rejectedByRule = "AMBIGUITY";
      rejectionReason = "Múltiplos candidatos equivalentes sem documento desempate.";
      if (stmtDiag) stmtDiag.finalStatus = "AMBIGUOUS_CANDIDATE";
      if (ldgDiag) ldgDiag.finalStatus = "AMBIGUOUS_CANDIDATE";
    } else if (!sameSignAfterConvention) {
      finalDecision = "REJECTED";
      rejectedByRule = "SIGN_CONVENTION";
      rejectionReason = "Os sinais de débito/crédito não coincidem após a convenção contábil aplicada.";
    } else if (dateDiff > dateTolerance) {
      finalDecision = "REJECTED";
      rejectedByRule = "DATE_TOLERANCE";
      rejectionReason = `A diferença de datas (${dateDiff} dias) excede a tolerância de ${dateTolerance} dias.`;
    } else if (stmtNormDoc && ldgNormDoc && stmtNormDoc !== ldgNormDoc) {
      finalDecision = "REJECTED";
      rejectedByRule = "DOCUMENT_MISMATCH";
      rejectionReason = `Documento divergente entre extrato [${stmtNormDoc}] e razão [${ldgNormDoc}].`;
    } else {
      finalDecision = "REJECTED";
      rejectedByRule = "RF-09";
      rejectionReason = "Valores ou critérios semânticos insuficientes para conciliação automática.";
    }
  }

  return {
    statement: stmtDiag,
    ledger: ldgDiag,
    candidateComparison: {
      statementLine: stmtLine,
      ledgerLine: ldgLine,
      sameDate,
      dateDiffDays: dateDiff,
      sameAmount,
      sameAbsAmount,
      sameSignAfterConvention,
      documentCompatible,
      descriptionCompatible,
      semanticCategoryCompatible,
      bankHintCompatible,
      wasCandidateGenerated,
      score: scoreBreakdown,
      ...(competingList ? { competingCandidates: competingList } : {}),
      ...(rejectedByRule ? { rejectedByRule } : {}),
      ...(rejectionReason ? { rejectionReason } : {}),
      finalDecision,
    },
  };
}
