import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { dayDifference, money, normalizeDocument } from "./normalization.js";
import type {
  AccountMapping,
  ConfirmProcessingRequest,
  DecisionLevel,
  LedgerRecord,
  ProcessingResult,
  ReconciliationResult,
  ResultStatus,
  StatementRecord,
} from "./types.js";

const automaticStatuses = new Set<ResultStatus>([
  "AUTO_MATCH_EXACT",
  "AUTO_MATCH_DATE_TOLERANCE",
  "AUTO_MATCH_VALUE_DATE",
]);

type CandidateStage = {
  status: Extract<ResultStatus, "AUTO_MATCH_EXACT" | "AUTO_MATCH_DATE_TOLERANCE" | "AUTO_MATCH_VALUE_DATE">;
  rule: string;
  matches: (ledger: LedgerRecord, statement: StatementRecord) => boolean;
};

export function reconcile(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  confirmation: ConfirmProcessingRequest,
): ProcessingResult {
  const selectedPrefix = periodPrefix(confirmation.period);
  const scopedLedgers = ledgers.filter(
    (item) =>
      (!item.company || item.company === confirmation.company) &&
      (!confirmation.branch || !item.branch || item.branch === confirmation.branch) &&
      item.date.startsWith(selectedPrefix),
  );
  const scopedStatements = statements.filter((item) => item.date.startsWith(selectedPrefix));
  const results = reconcileMappedAccounts(scopedLedgers, scopedStatements, confirmation);
  const ledgerAccountByStatementFile = new Map<string, string>();
  for (const mapping of confirmation.mappings) {
    for (const fileId of mapping.statementFileIds) ledgerAccountByStatementFile.set(fileId, mapping.ledgerAccount);
  }
  const summaryAccounts = [...new Set(confirmation.mappings.map((item) => item.ledgerAccount))].sort();
  const summaries = summaryAccounts.map((ledgerAccount) => summarize(ledgerAccount, results.filter((item) =>
    item.ledger?.ledgerAccount === ledgerAccount ||
    (!item.ledger && item.statement && ledgerAccountByStatementFile.get(item.statement.evidence.fileId) === ledgerAccount),
  )));
  const rejectedLedgers = ledgers.filter((item) => !item.date.startsWith(selectedPrefix)).length;
  const rejectedStatements = statements.filter((item) => !item.date.startsWith(selectedPrefix)).length;
  const issues = [];
  if (rejectedLedgers) issues.push({ severity: "WARNING" as const, code: "RAZAO_FORA_COMPETENCIA", message: `${rejectedLedgers} registro(s) do razão foram rejeitados por estarem fora da competência confirmada.` });
  if (rejectedStatements) issues.push({ severity: "WARNING" as const, code: "EXTRATO_FORA_COMPETENCIA", message: `${rejectedStatements} registro(s) de extrato foram rejeitados por estarem fora da competência confirmada.` });
  return {
    company: confirmation.company,
    branch: confirmation.branch ?? "",
    period: confirmation.period,
    executedAt: new Date().toISOString(),
    summaries,
    results,
    issues,
    files: [],
    investments: [],
  };
}

function reconcileMappedAccounts(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  confirmation: ConfirmProcessingRequest,
): ReconciliationResult[] {
  const results: ReconciliationResult[] = [];
  const mappedStatementFileIds = new Set<string>();
  const mappedLedgerAccounts = new Set<string>();

  for (const mapping of stableMappings(confirmation.mappings)) {
    const fileIds = new Set(mapping.statementFileIds);
    mapping.statementFileIds.forEach((fileId) => mappedStatementFileIds.add(fileId));
    mappedLedgerAccounts.add(mapping.ledgerAccount);
    const partitionLedgers = ledgers.filter((item) => item.ledgerAccount === mapping.ledgerAccount);
    const partitionStatements = statements.filter((item) => fileIds.has(item.evidence.fileId));
    results.push(...reconcilePartition(partitionLedgers, partitionStatements, confirmation));
  }

  for (const ledger of stableLedgers(ledgers)) {
    if (!mappedLedgerAccounts.has(ledger.ledgerAccount)) {
      results.push(makeResult("LEDGER_WITHOUT_STATEMENT", "RULE_7_UNMAPPED_LEDGER", confirmation, ledger));
    }
  }
  for (const statement of stableStatements(statements)) {
    if (!mappedStatementFileIds.has(statement.evidence.fileId)) {
      results.push(makeResult("STATEMENT_WITHOUT_LEDGER", "RULE_8_UNMAPPED_STATEMENT", confirmation, undefined, statement));
    }
  }
  return results.sort((left, right) => left.id.localeCompare(right.id));
}

function reconcilePartition(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  confirmation: ConfirmProcessingRequest,
): ReconciliationResult[] {
  const results: ReconciliationResult[] = [];
  const usedLedgers = new Set<string>();
  const usedStatements = new Set<string>();
  const tolerance = new Decimal(confirmation.valueTolerance);
  const stages: CandidateStage[] = [
    {
      status: "AUTO_MATCH_EXACT",
      rule: "RULE_1_EXACT",
      matches: (ledger, statement) =>
        sameValue(ledger.value, statement.value, tolerance) &&
        ledger.date === statement.date &&
        sameNonEmptyDocument(ledger.document, statement.document),
    },
    {
      status: "AUTO_MATCH_DATE_TOLERANCE",
      rule: "RULE_2_DATE_TOLERANCE",
      matches: (ledger, statement) =>
        sameValue(ledger.value, statement.value, tolerance) &&
        sameNonEmptyDocument(ledger.document, statement.document) &&
        dayDifference(ledger.date, statement.date) <= confirmation.dateToleranceDays,
    },
    {
      status: "AUTO_MATCH_VALUE_DATE",
      rule: "RULE_3_MISSING_DOCUMENT",
      matches: (ledger, statement) =>
        sameValue(ledger.value, statement.value, tolerance) &&
        ledger.date === statement.date &&
        (!normalizeDocument(ledger.document) || !normalizeDocument(statement.document)),
    },
  ];

  for (const stage of stages) {
    const matches = globallyForcedCandidates(
      stableLedgers(ledgers).filter((item) => !usedLedgers.has(item.id)),
      stableStatements(statements).filter((item) => !usedStatements.has(item.id)),
      stage.matches,
    );
    for (const { ledger, statement } of matches) {
      usedLedgers.add(ledger.id);
      usedStatements.add(statement.id);
      results.push(makeResult(stage.status, stage.rule, confirmation, ledger, statement));
    }
  }

  const reportedStatements = new Set<string>(usedStatements);
  for (const ledger of stableLedgers(ledgers)) {
    if (usedLedgers.has(ledger.id)) continue;
    const remaining = stableStatements(statements).filter((item) => !usedStatements.has(item.id));
    const valueCandidates = remaining.filter((item) => sameValue(ledger.value, item.value, tolerance));
    if (valueCandidates.length > 1) {
      results.push(makeResult("AMBIGUOUS_MATCH", "RULE_9_AMBIGUITY", confirmation, ledger, undefined, valueCandidates));
      continue;
    }
    if (valueCandidates.length === 1) {
      const statement = valueCandidates[0]!;
      const status = sameNonEmptyDocument(ledger.document, statement.document) && dayDifference(ledger.date, statement.date) > confirmation.dateToleranceDays
        ? "DATE_DIVERGENCE"
        : "VALUE_ONLY_SUGGESTION";
      results.push(makeResult(status, status === "DATE_DIVERGENCE" ? "RULE_5_DATE_DIVERGENCE" : "RULE_6_VALUE_ONLY", confirmation, ledger, statement));
      reportedStatements.add(statement.id);
      continue;
    }

    const valueDivergences = remaining.filter(
      (item) => ledger.date === item.date && sameNonEmptyDocument(ledger.document, item.document),
    );
    if (valueDivergences.length === 1) {
      const statement = valueDivergences[0]!;
      results.push(makeResult("VALUE_DIVERGENCE", "RULE_4_VALUE_DIVERGENCE", confirmation, ledger, statement));
      reportedStatements.add(statement.id);
      continue;
    }
    if (valueDivergences.length > 1) {
      results.push(makeResult("AMBIGUOUS_MATCH", "RULE_9_AMBIGUITY", confirmation, ledger, undefined, valueDivergences));
      continue;
    }
    results.push(makeResult("LEDGER_WITHOUT_STATEMENT", "RULE_7_LEDGER_WITHOUT_STATEMENT", confirmation, ledger));
  }

  for (const statement of stableStatements(statements)) {
    if (!usedStatements.has(statement.id) && !reportedStatements.has(statement.id)) {
      results.push(makeResult("STATEMENT_WITHOUT_LEDGER", "RULE_8_STATEMENT_WITHOUT_LEDGER", confirmation, undefined, statement));
    }
  }
  return results;
}

function globallyForcedCandidates(
  ledgers: LedgerRecord[],
  statements: StatementRecord[],
  matches: (ledger: LedgerRecord, statement: StatementRecord) => boolean,
): Array<{ ledger: LedgerRecord; statement: StatementRecord }> {
  const candidatePairs: Array<[string, string]> = [];
  for (const ledger of ledgers) {
    for (const statement of statements) {
      if (!matches(ledger, statement)) continue;
      candidatePairs.push([ledger.id, statement.id]);
    }
  }
  const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
  const statementById = new Map(statements.map((statement) => [statement.id, statement]));
  return resolveGloballyForcedPairs([...ledgerById.keys()], [...statementById.keys()], candidatePairs).map(([ledgerId, statementId]) => ({
    ledger: ledgerById.get(ledgerId)!,
    statement: statementById.get(statementId)!,
  }));
}

export function resolveGloballyForcedPairs(leftIds: readonly string[], rightIds: readonly string[], candidatePairs: ReadonlyArray<readonly [string, string]>): Array<[string, string]> {
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

function stableMappings(mappings: AccountMapping[]): AccountMapping[] {
  return [...mappings].sort((left, right) => {
    const leftKey = `${left.ledgerAccount}|${[...left.statementFileIds].sort().join("|")}`;
    const rightKey = `${right.ledgerAccount}|${[...right.statementFileIds].sort().join("|")}`;
    return leftKey.localeCompare(rightKey);
  });
}

function stableLedgers(ledgers: LedgerRecord[]): LedgerRecord[] {
  return [...ledgers].sort((left, right) => left.id.localeCompare(right.id));
}

function stableStatements(statements: StatementRecord[]): StatementRecord[] {
  return [...statements].sort((left, right) => left.id.localeCompare(right.id));
}

function makeResult(
  status: ResultStatus,
  rule: string,
  confirmation: ConfirmProcessingRequest,
  ledger?: LedgerRecord,
  statement?: StatementRecord,
  candidates?: StatementRecord[],
): ReconciliationResult {
  const orderedCandidates = candidates ? stableStatements(candidates) : undefined;
  const key = [status, ledger?.id ?? "", statement?.id ?? "", ...(orderedCandidates ?? []).map((item) => item.id)].join("|");
  const reasons: Record<ResultStatus, string> = {
    AUTO_MATCH_EXACT: "Conta mapeada, documento, data e valor coincidem de forma única.",
    AUTO_MATCH_DATE_TOLERANCE: "Conta mapeada, documento e valor coincidem; a data está dentro da tolerância confirmada.",
    AUTO_MATCH_VALUE_DATE: "Conta mapeada, valor e data coincidem; ao menos um documento está ausente e o candidato é único.",
    VALUE_ONLY_SUGGESTION: "O valor coincide, mas faltam evidências suficientes para uma conciliação automática.",
    VALUE_DIVERGENCE: "Conta, documento e data coincidem, mas o valor diverge.",
    DATE_DIVERGENCE: "Conta, documento e valor coincidem, mas a data está fora da tolerância confirmada.",
    LEDGER_WITHOUT_STATEMENT: "Nenhum movimento bancário elegível foi encontrado para a conta mapeada.",
    STATEMENT_WITHOUT_LEDGER: "Nenhum lançamento contábil elegível foi encontrado para a conta mapeada.",
    AMBIGUOUS_MATCH: "Há mais de uma associação de mesma força; nenhuma escolha automática foi feita.",
    POSSIBLE_DUPLICATE: "A origem possui uma assinatura duplicada que exige revisão.",
  };
  const result: ReconciliationResult = {
    id: `REC-${createHash("sha256").update(key).digest("hex").slice(0, 12).toUpperCase()}`,
    status,
    rule,
    decisionLevel: decisionLevel(status),
    reason: reasons[status],
    valueTolerance: money(confirmation.valueTolerance),
  };
  if (ledger) result.ledger = ledger;
  if (statement) result.statement = statement;
  if (orderedCandidates?.length) result.candidates = orderedCandidates;
  if (ledger && statement) {
    result.valueDifference = money(new Decimal(ledger.value).minus(statement.value));
    result.dateDifference = dayDifference(ledger.date, statement.date);
  }
  return result;
}

function decisionLevel(status: ResultStatus): DecisionLevel {
  return automaticStatuses.has(status) ? "AUTOMATIC" : "REVIEW_REQUIRED";
}

function summarize(ledgerAccount: string, results: ReconciliationResult[]) {
  const uniqueLedgers = uniqueBy(results.flatMap((item) => item.ledger ? [item.ledger] : []));
  const uniqueStatements = uniqueBy(results.flatMap((item) => item.statement ? [item.statement] : []));
  const ledgerBalance = uniqueLedgers.reduce((sum, item) => sum.plus(item.value), new Decimal(0));
  const statementBalance = uniqueStatements.reduce((sum, item) => sum.plus(item.value), new Decimal(0));
  const reconciledResults = results.filter((item) => automaticStatuses.has(item.status));
  const exceptions = results.filter((item) => !automaticStatuses.has(item.status));
  return {
    ledgerAccount,
    statementAccounts: [...new Set(uniqueStatements.map((item) => `${item.bank} ${item.agency}/${item.bankAccount}`))],
    ledgerBalance: money(ledgerBalance),
    statementBalance: money(statementBalance),
    balanceDifference: money(ledgerBalance.minus(statementBalance)),
    reconciledCount: reconciledResults.length,
    reconciledValue: money(reconciledResults.reduce((sum, item) => sum.plus(item.ledger?.value ?? 0), new Decimal(0))),
    divergenceCount: results.filter((item) => item.status === "VALUE_DIVERGENCE" || item.status === "DATE_DIVERGENCE").length,
    ledgerWithoutStatementCount: results.filter((item) => item.status === "LEDGER_WITHOUT_STATEMENT").length,
    statementWithoutLedgerCount: results.filter((item) => item.status === "STATEMENT_WITHOUT_LEDGER").length,
    ambiguityCount: results.filter((item) => item.status === "AMBIGUOUS_MATCH").length,
    duplicateCount: results.filter((item) => item.status === "POSSIBLE_DUPLICATE").length,
    status: exceptions.length === 0 ? "CONCILIADA" as const : "COM_DIVERGENCIAS" as const,
  };
}

function uniqueBy<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function sameValue(left: string, right: string, tolerance: Decimal): boolean {
  return new Decimal(left).minus(right).abs().lte(tolerance);
}

function sameNonEmptyDocument(left: string, right: string): boolean {
  const normalizedLeft = normalizeDocument(left);
  const normalizedRight = normalizeDocument(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function periodPrefix(period: string): string {
  return `${period.slice(0, 4)}-${period.slice(4, 6)}`;
}
