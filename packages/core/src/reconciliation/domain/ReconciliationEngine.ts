import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { dayDifference, normalizeDocument } from "../../normalization.js";
import { decimalString, type DecimalString } from "../../shared/domain/Decimal.js";

export interface MatchableEntry {
  id: string;
  date: string; // YYYY-MM-DD
  amount: Decimal.Value;
  documentNumber?: string;
  nature: "DEBIT" | "CREDIT";
  description?: string;
}

export type MatchRule =
  | "RULE_1_EXACT"
  | "RULE_2_DATE_TOLERANCE"
  | "RULE_3_MISSING_DOCUMENT"
  | "RULE_3_DESCRIPTION"
  | "RULE_4_GROUPING"
  | "RULE_4_VALUE_DIVERGENCE"
  | "RULE_5_DATE_DIVERGENCE"
  | "RULE_6_VALUE_ONLY"
  | "RULE_7_LEDGER_WITHOUT_STATEMENT"
  | "RULE_8_STATEMENT_WITHOUT_LEDGER"
  | "RULE_9_AMBIGUITY";

export type MatchStatus =
  | "AUTO_MATCH_EXACT"
  | "AUTO_MATCH_DATE_TOLERANCE"
  | "AUTO_MATCH_VALUE_DATE"
  | "AUTO_MATCH_DESCRIPTION"
  | "GROUP_SUGGESTION"
  | "VALUE_ONLY_SUGGESTION"
  | "VALUE_DIVERGENCE"
  | "DATE_DIVERGENCE"
  | "AMBIGUOUS_MATCH"
  | "LEDGER_WITHOUT_STATEMENT"
  | "STATEMENT_WITHOUT_LEDGER";

export interface MatchResult {
  id: string;
  status: MatchStatus;
  rule: MatchRule;
  ledger?: MatchableEntry;
  statement?: MatchableEntry;
  candidates?: MatchableEntry[];
  ledgers?: MatchableEntry[];
  statements?: MatchableEntry[];
  evidence: MatchEvidence;
}

export interface MatchEvidence {
  ruleId: MatchRule;
  cardinality: "ONE_TO_ONE" | "ONE_TO_MANY" | "MANY_TO_ONE" | "MANY_TO_MANY";
  ledgerIds: string[];
  statementIds: string[];
  dateDifferenceDays?: number;
  amountDifference: DecimalString;
  descriptionSimilarity?: number;
  confidence: number;
  status: MatchStatus;
  evaluatedAt: string;
}

export interface ReconciliationEngineOptions {
  descriptionSimilarityThreshold?: number;
  allowOneToMany?: boolean;
  allowManyToOne?: boolean;
  allowManyToMany?: boolean;
  maxGroupSize?: number;
  evaluatedAt?: string;
}

type CandidateStage = {
  status: Extract<MatchStatus, "AUTO_MATCH_EXACT" | "AUTO_MATCH_DATE_TOLERANCE" | "AUTO_MATCH_VALUE_DATE" | "AUTO_MATCH_DESCRIPTION">;
  rule: MatchRule;
  matches: (ledger: MatchableEntry, statement: MatchableEntry) => boolean;
  confidence: number;
};

export class ReconciliationEngine {
  constructor(
    private readonly valueTolerance: Decimal.Value = 0,
    private readonly dateToleranceDays: number = 0,
    private readonly options: ReconciliationEngineOptions = {},
  ) {}

  public reconcile(ledgers: MatchableEntry[], statements: MatchableEntry[]): MatchResult[] {
    const results: MatchResult[] = [];
    const usedLedgers = new Set<string>();
    const usedStatements = new Set<string>();
    const tolerance = new Decimal(this.valueTolerance);

    const stages: CandidateStage[] = [
      {
        status: "AUTO_MATCH_EXACT",
        rule: "RULE_1_EXACT",
        matches: (ledger, statement) =>
          this.sameValue(ledger.amount, statement.amount, tolerance) &&
          ledger.date === statement.date &&
          this.sameNonEmptyDocument(ledger.documentNumber, statement.documentNumber) &&
          this.compatibleNature(ledger.nature, statement.nature),
        confidence: 1,
      },
      {
        status: "AUTO_MATCH_DATE_TOLERANCE",
        rule: "RULE_2_DATE_TOLERANCE",
        matches: (ledger, statement) =>
          this.sameValue(ledger.amount, statement.amount, tolerance) &&
          this.sameNonEmptyDocument(ledger.documentNumber, statement.documentNumber) &&
          this.compatibleNature(ledger.nature, statement.nature) &&
          dayDifference(ledger.date, statement.date) <= this.dateToleranceDays,
        confidence: 0.98,
      },
      {
        status: "AUTO_MATCH_VALUE_DATE",
        rule: "RULE_3_MISSING_DOCUMENT",
        matches: (ledger, statement) =>
          this.sameValue(ledger.amount, statement.amount, tolerance) &&
          ledger.date === statement.date &&
          this.compatibleNature(ledger.nature, statement.nature) &&
          (!normalizeDocument(ledger.documentNumber || "") || !normalizeDocument(statement.documentNumber || "")),
        confidence: 0.95,
      },
      {
        status: "AUTO_MATCH_DESCRIPTION",
        rule: "RULE_3_DESCRIPTION",
        matches: (ledger, statement) =>
          this.sameValue(ledger.amount, statement.amount, tolerance) &&
          this.compatibleNature(ledger.nature, statement.nature) &&
          dayDifference(ledger.date, statement.date) <= this.dateToleranceDays &&
          this.descriptionSimilarity(ledger.description, statement.description) >= (this.options.descriptionSimilarityThreshold ?? 0.85),
        confidence: 0.9,
      },
    ];

    for (const stage of stages) {
      const matches = this.globallyForcedCandidates(
        this.stableEntries(ledgers).filter((item) => !usedLedgers.has(item.id)),
        this.stableEntries(statements).filter((item) => !usedStatements.has(item.id)),
        stage.matches,
      );
      for (const { ledger, statement } of matches) {
        usedLedgers.add(ledger.id);
        usedStatements.add(statement.id);
        results.push(this.makeResult(stage.status, stage.rule, ledger, statement, undefined, stage.confidence));
      }
    }

    results.push(...this.groupSuggestions(
      this.stableEntries(ledgers).filter((item) => !usedLedgers.has(item.id)),
      this.stableEntries(statements).filter((item) => !usedStatements.has(item.id)),
      tolerance,
    ));

    const reportedStatements = new Set<string>(usedStatements);
    for (const ledger of this.stableEntries(ledgers)) {
      if (usedLedgers.has(ledger.id)) continue;

      const remaining = this.stableEntries(statements).filter((item) => !usedStatements.has(item.id));
      const valueCandidates = remaining.filter((item) => this.sameValue(ledger.amount, item.amount, tolerance) && this.compatibleNature(ledger.nature, item.nature));

      if (valueCandidates.length > 1) {
        results.push(this.makeResult("AMBIGUOUS_MATCH", "RULE_9_AMBIGUITY", ledger, undefined, valueCandidates));
        continue;
      }

      if (valueCandidates.length === 1) {
        const statement = valueCandidates[0]!;
        const status = this.sameNonEmptyDocument(ledger.documentNumber, statement.documentNumber) && dayDifference(ledger.date, statement.date) > this.dateToleranceDays
          ? "DATE_DIVERGENCE"
          : "VALUE_ONLY_SUGGESTION";
        results.push(this.makeResult(status, status === "DATE_DIVERGENCE" ? "RULE_5_DATE_DIVERGENCE" : "RULE_6_VALUE_ONLY", ledger, statement));
        reportedStatements.add(statement.id);
        continue;
      }

      const valueDivergences = remaining.filter(
        (item) => ledger.date === item.date && this.sameNonEmptyDocument(ledger.documentNumber, item.documentNumber) && this.compatibleNature(ledger.nature, item.nature),
      );

      if (valueDivergences.length === 1) {
        const statement = valueDivergences[0]!;
        results.push(this.makeResult("VALUE_DIVERGENCE", "RULE_4_VALUE_DIVERGENCE", ledger, statement));
        reportedStatements.add(statement.id);
        continue;
      }
      if (valueDivergences.length > 1) {
        results.push(this.makeResult("AMBIGUOUS_MATCH", "RULE_9_AMBIGUITY", ledger, undefined, valueDivergences));
        continue;
      }

      results.push(this.makeResult("LEDGER_WITHOUT_STATEMENT", "RULE_7_LEDGER_WITHOUT_STATEMENT", ledger));
    }

    for (const statement of this.stableEntries(statements)) {
      if (!usedStatements.has(statement.id) && !reportedStatements.has(statement.id)) {
        results.push(this.makeResult("STATEMENT_WITHOUT_LEDGER", "RULE_8_STATEMENT_WITHOUT_LEDGER", undefined, statement));
      }
    }

    return results;
  }

  private globallyForcedCandidates(
    ledgers: MatchableEntry[],
    statements: MatchableEntry[],
    matches: (ledger: MatchableEntry, statement: MatchableEntry) => boolean,
  ): Array<{ ledger: MatchableEntry; statement: MatchableEntry }> {
    const candidatePairs: Array<[string, string]> = [];
    for (const ledger of ledgers) {
      for (const statement of statements) {
        if (!matches(ledger, statement)) continue;
        candidatePairs.push([ledger.id, statement.id]);
      }
    }
    const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
    const statementById = new Map(statements.map((statement) => [statement.id, statement]));
    return this.resolveGloballyForcedPairs([...ledgerById.keys()], [...statementById.keys()], candidatePairs).map(([ledgerId, statementId]) => ({
      ledger: ledgerById.get(ledgerId)!,
      statement: statementById.get(statementId)!,
    }));
  }

  private resolveGloballyForcedPairs(leftIds: readonly string[], rightIds: readonly string[], candidatePairs: ReadonlyArray<readonly [string, string]>): Array<[string, string]> {
    const left = [...new Set(leftIds)].sort();
    const right = [...new Set(rightIds)].sort();
    const pairs = candidatePairs
      .filter(([leftId, rightId]) => left.includes(leftId) && right.includes(rightId))
      .map(([leftId, rightId]) => [leftId, rightId] as [string, string])
      .filter((pair, index, values) => values.findIndex(([leftId, rightId]) => leftId === pair[0] && rightId === pair[1]) === index)
      .sort(([leftA, rightA], [leftB, rightB]) => leftA.localeCompare(leftB) || rightA.localeCompare(rightB));

    const maximum = this.maximumMatching(left, pairs);
    const maximumSize = maximum.size;
    if (!maximumSize) return [];

    return [...maximum.entries()]
      .filter(([leftId, rightId]) => this.maximumMatching(left, pairs.filter(([candidateLeft, candidateRight]) => candidateLeft !== leftId || candidateRight !== rightId)).size < maximumSize)
      .sort(([leftA], [leftB]) => leftA.localeCompare(leftB));
  }

  private maximumMatching(leftIds: readonly string[], pairs: ReadonlyArray<readonly [string, string]>): Map<string, string> {
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

  private makeResult(
    status: MatchStatus,
    rule: MatchRule,
    ledger?: MatchableEntry,
    statement?: MatchableEntry,
    candidates?: MatchableEntry[],
    confidence = 0,
  ): MatchResult {
    const ledgers = ledger ? [ledger] : [];
    const statements = statement ? [statement] : [];
    const evidence = this.evidence(status, rule, ledgers, statements, "ONE_TO_ONE", confidence);
    return {
      id: this.resultId(status, rule, ledgers, statements),
      status,
      rule,
      ...(ledger !== undefined ? { ledger } : {}),
      ...(statement !== undefined ? { statement } : {}),
      ...(candidates !== undefined ? { candidates: this.stableEntries(candidates) } : {}),
      evidence,
    };
  }

  private groupSuggestions(ledgers: MatchableEntry[], statements: MatchableEntry[], tolerance: Decimal): MatchResult[] {
    const results: MatchResult[] = [];
    const max = Math.max(2, Math.min(this.options.maxGroupSize ?? 3, 5));
    if (this.options.allowOneToMany) {
      for (const ledger of ledgers) {
        for (const group of this.combinations(statements.filter((item) => this.compatibleNature(ledger.nature, item.nature)), max)) {
          if (!this.groupDatesCompatible([ledger], group) || !this.sameTotal([ledger], group, tolerance)) continue;
          results.push(this.makeGroupResult([ledger], group, "ONE_TO_MANY"));
          break;
        }
      }
    }
    if (this.options.allowManyToOne) {
      for (const statement of statements) {
        for (const group of this.combinations(ledgers.filter((item) => this.compatibleNature(item.nature, statement.nature)), max)) {
          if (!this.groupDatesCompatible(group, [statement]) || !this.sameTotal(group, [statement], tolerance)) continue;
          results.push(this.makeGroupResult(group, [statement], "MANY_TO_ONE"));
          break;
        }
      }
    }
    if (this.options.allowManyToMany) {
      const ledgerGroups = this.combinations(ledgers, max);
      const statementGroups = this.combinations(statements, max);
      for (const ledgerGroup of ledgerGroups) {
        const statementGroup = statementGroups.find((group) =>
          ledgerGroup.every((ledger) => group.every((statement) => this.compatibleNature(ledger.nature, statement.nature))) &&
          this.groupDatesCompatible(ledgerGroup, group) && this.sameTotal(ledgerGroup, group, tolerance));
        if (statementGroup) results.push(this.makeGroupResult(ledgerGroup, statementGroup, "MANY_TO_MANY"));
      }
    }
    return results.filter((result, index, all) => all.findIndex((candidate) => candidate.id === result.id) === index);
  }

  private makeGroupResult(
    ledgers: MatchableEntry[],
    statements: MatchableEntry[],
    cardinality: MatchEvidence["cardinality"],
  ): MatchResult {
    const stableLedgers = this.stableEntries(ledgers);
    const stableStatements = this.stableEntries(statements);
    return {
      id: this.resultId("GROUP_SUGGESTION", "RULE_4_GROUPING", stableLedgers, stableStatements),
      status: "GROUP_SUGGESTION",
      rule: "RULE_4_GROUPING",
      ledgers: stableLedgers,
      statements: stableStatements,
      evidence: this.evidence("GROUP_SUGGESTION", "RULE_4_GROUPING", stableLedgers, stableStatements, cardinality, 0.75),
    };
  }

  private evidence(
    status: MatchStatus,
    rule: MatchRule,
    ledgers: MatchableEntry[],
    statements: MatchableEntry[],
    cardinality: MatchEvidence["cardinality"],
    confidence: number,
  ): MatchEvidence {
    const ledgerTotal = ledgers.reduce((total, entry) => total.plus(entry.amount), new Decimal(0));
    const statementTotal = statements.reduce((total, entry) => total.plus(entry.amount), new Decimal(0));
    const dateDifferences = ledgers.flatMap((ledger) => statements.map((statement) => dayDifference(ledger.date, statement.date)));
    const similarities = ledgers.flatMap((ledger) => statements.map((statement) => this.descriptionSimilarity(ledger.description, statement.description)));
    return {
      ruleId: rule,
      cardinality,
      ledgerIds: ledgers.map((entry) => entry.id),
      statementIds: statements.map((entry) => entry.id),
      ...(dateDifferences.length ? { dateDifferenceDays: Math.max(...dateDifferences) } : {}),
      amountDifference: decimalString(ledgerTotal.minus(statementTotal).abs()),
      ...(similarities.some((value) => value > 0) ? { descriptionSimilarity: Math.max(...similarities) } : {}),
      confidence,
      status,
      evaluatedAt: this.options.evaluatedAt ?? "1970-01-01T00:00:00.000Z",
    };
  }

  private resultId(status: MatchStatus, rule: MatchRule, ledgers: MatchableEntry[], statements: MatchableEntry[]): string {
    const hash = createHash("sha256").update(JSON.stringify({
      status, rule, ledgers: ledgers.map((entry) => entry.id).sort(), statements: statements.map((entry) => entry.id).sort(),
    })).digest("hex").slice(0, 16).toUpperCase();
    return `REC-V2-${hash}`;
  }

  private combinations(entries: MatchableEntry[], maxSize: number): MatchableEntry[][] {
    const stable = this.stableEntries(entries);
    const output: MatchableEntry[][] = [];
    const visit = (start: number, current: MatchableEntry[]) => {
      if (current.length >= 2) output.push([...current]);
      if (current.length === maxSize || output.length >= 500) return;
      for (let index = start; index < stable.length && output.length < 500; index += 1) {
        current.push(stable[index]!); visit(index + 1, current); current.pop();
      }
    };
    visit(0, []);
    return output;
  }

  private sameTotal(left: MatchableEntry[], right: MatchableEntry[], tolerance: Decimal): boolean {
    const leftTotal = left.reduce((total, entry) => total.plus(entry.amount), new Decimal(0));
    const rightTotal = right.reduce((total, entry) => total.plus(entry.amount), new Decimal(0));
    return leftTotal.minus(rightTotal).abs().lte(tolerance);
  }

  private groupDatesCompatible(left: MatchableEntry[], right: MatchableEntry[]): boolean {
    return left.every((one) => right.every((other) => dayDifference(one.date, other.date) <= this.dateToleranceDays));
  }

  private descriptionSimilarity(left?: string, right?: string): number {
    const normalize = (value: string | undefined) => normalizeDocument(value ?? "").replace(/[^A-Z0-9 ]/g, "");
    const leftTokens = new Set(normalize(left).split(/\s+/).filter(Boolean));
    const rightTokens = new Set(normalize(right).split(/\s+/).filter(Boolean));
    if (!leftTokens.size || !rightTokens.size) return 0;
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return intersection / new Set([...leftTokens, ...rightTokens]).size;
  }

  private stableEntries(entries: MatchableEntry[]): MatchableEntry[] {
    return [...entries].sort((left, right) => left.id.localeCompare(right.id));
  }

  private sameValue(left: Decimal.Value, right: Decimal.Value, tolerance: Decimal): boolean {
    return new Decimal(left).minus(right).abs().lte(tolerance);
  }

  private sameNonEmptyDocument(left?: string, right?: string): boolean {
    const normalizedLeft = normalizeDocument(left || "");
    const normalizedRight = normalizeDocument(right || "");
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  }

  private compatibleNature(ledgerNature: string, statementNature: string): boolean {
    // In many accounting setups, ledger DEBIT matches bank statement DEBIT or vice-versa depending on the profile.
    // For this generic engine, we assume they must match exactly or rely on the profile to normalize the sign beforehand.
    return ledgerNature === statementNature;
  }
}
