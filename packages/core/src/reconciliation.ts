import { createHash } from "node:crypto";
import {
  ReconciliationEngine,
  type ReconciliationAuditEntry,
  type ReconciliationEngineOutput,
  type ReconciliationMatchGroup,
  type ReconciliationStatus,
  type ReconciliationTransaction,
} from "./reconciliation/domain/ReconciliationEngine.js";
import type {
  AccountMapping,
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
  "AUTO_MATCH_DATE_TOLERANCE",
  "AUTO_MATCH_GROUP",
  "AUTO_MATCH_DAILY_TOTAL",
  "BANK_NET_ZERO",
  "AUTO_APPLICATION_EXCLUDED",
]);
const reconciledStatuses = new Set<ResultStatus>([
  "AUTO_MATCH_EXACT",
  "AUTO_MATCH_DATE_TOLERANCE",
  "AUTO_MATCH_GROUP",
  "AUTO_MATCH_DAILY_TOTAL",
]);

type PartitionResult = {
  results: ReconciliationResult[];
  engine: ReconciliationEngineOutput;
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
  }).run(transactions);
  const auditByGroup = new Map(engine.audit.filter((item) => item.transactionIds.length > 1).map((item) => [transactionSetKey(item.transactionIds), item]));
  const results = engine.matchGroups.map((group) => projectGroup(group, auditByGroup.get(transactionSetKey([...group.bankTransactionIds, ...group.ledgerTransactionIds])), ledgerById, statementById));
  for (const transaction of engine.transactions.filter((item) => !item.matchGroupId)) {
    const audit = engine.audit.find((item) => item.transactionIds.length === 1 && item.transactionIds[0] === transaction.id);
    results.push(projectSingle(transaction.status, transaction.id, audit, ledgerById, statementById));
  }
  return { results, engine };
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
  if (type === "date-window") return "AUTO_MATCH_DATE_TOLERANCE";
  if (type === "daily-total") return "AUTO_MATCH_DAILY_TOTAL";
  if (type === "bank-net-zero") return "BANK_NET_ZERO";
  return "AUTO_MATCH_GROUP";
}

function reason(status: ResultStatus): string {
  const reasons: Record<ResultStatus, string> = {
    AUTO_MATCH_EXACT: "Data e valor em centavos coincidem.",
    AUTO_MATCH_DATE_TOLERANCE: "O mesmo valor foi encontrado em até três dias.",
    AUTO_MATCH_VALUE_DATE: "Data e valor coincidem.",
    AUTO_MATCH_GROUP: "Valores de mesmo sinal fecham exatamente em grupo.",
    AUTO_MATCH_DAILY_TOTAL: "Os resíduos dos dois lados fecham exatamente no dia.",
    BANK_NET_ZERO: "Movimentos bancários opostos no mesmo dia não produzem efeito líquido.",
    AUTO_APPLICATION_EXCLUDED: "Movimento bancário segregado como aplicação automática.",
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
  return {
    ledgerAccount,
    statementAccounts: [...new Set(uniqueStatements.map((item) => `${item.bank} ${item.agency}/${item.bankAccount}`))],
    ledgerBalance: centsToDecimal(ledgerBalance.toString()),
    statementBalance: centsToDecimal(statementBalance.toString()),
    balanceDifference: centsToDecimal((ledgerBalance - statementBalance).toString()),
    reconciledCount: reconciledResults.length,
    reconciledValue: centsToDecimal(reconciledResults.reduce((sum, item) =>
      sum + (item.matchGroup ? BigInt(item.matchGroup.ledgerTotalCents) : item.ledger ? decimalToCents(item.ledger.value) : 0n), 0n).toString()),
    divergenceCount: 0,
    ledgerWithoutStatementCount: results.filter((item) => item.status === "LEDGER_WITHOUT_STATEMENT").length,
    statementWithoutLedgerCount: results.filter((item) => item.status === "STATEMENT_WITHOUT_LEDGER").length,
    ambiguityCount: 0,
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
  const coverageTransactions = conciliableBank;
  const coveredTransactions = coverageTransactions.filter((item) => coveredStatuses.has(item.status));
  const coveredAbsolute = totalCents(coveredTransactions.map((item) => absoluteCents(item.amountCents)));
  const totalAbsolute = totalCents(coverageTransactions.map((item) => absoluteCents(item.amountCents)));
  const counts = new Map<ResultStatus, bigint>();
  for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0n) + 1n);
  const pending = new Map<string, { bankCount: bigint; ledgerCount: bigint; bankValue: bigint; ledgerValue: bigint }>();
  for (const transaction of transactions.filter((item) => item.status === "BANK_ONLY" || item.status === "LEDGER_ONLY")) {
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
        covered: String(coveredTransactions.length),
        total: String(coverageTransactions.length),
        percentage: percentage(BigInt(coveredTransactions.length), BigInt(coverageTransactions.length)),
      },
      absoluteValue: {
        covered: centsToDecimal(coveredAbsolute.toString()),
        total: centsToDecimal(totalAbsolute.toString()),
        percentage: percentage(coveredAbsolute, totalAbsolute),
      },
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
