import {
  ReconciliationEngine,
  type MatchableEntry,
  type MatchStatus,
  type ReconciliationEngineOptions,
} from "../domain/ReconciliationEngine.js";
import type { TransactionRepository } from "../../shared/domain/TransactionRepository.js";
import type { LedgerRepository } from "../../shared/domain/LedgerRepository.js";
import type { ReconciliationRunRepository } from "../domain/ReconciliationRunRepository.js";
import {
  isEffectiveReconciliation,
  type ReconciliationRun,
  type MatchGroup,
  type ReconciliationException,
  type ExceptionType,
} from "../domain/ReconciliationRun.js";
import { randomUUID } from "node:crypto";
import type Decimal from "decimal.js";
import { decimalString } from "../../shared/domain/Decimal.js";
import type { Evidence, EvidenceRepository } from "../../shared/domain/Evidence.js";
import type { AuditRepository } from "../../audit/domain/AuditEvent.js";
import type { ReconciliationConfigurationRepository } from "../domain/ReconciliationConfigurationRepository.js";

export interface ReconcileTransactionsInput {
  companyId: string;
  profileId: string;
  periodId: string;
  preparerId: string;
  valueTolerance?: Decimal.Value;
  dateToleranceDays?: number;
  matching?: ReconciliationEngineOptions;
}

export class ReconcileTransactionsUseCase {
  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly runRepo?: ReconciliationRunRepository,
    private readonly evidenceRepo?: EvidenceRepository,
    private readonly auditRepo?: AuditRepository,
    private readonly configurationRepo?: ReconciliationConfigurationRepository,
  ) {}

  async execute(input: ReconcileTransactionsInput): Promise<ReconciliationRun> {
    const profile = await this.configurationRepo?.findProfileById(input.profileId);
    const period = await this.configurationRepo?.findPeriodById(input.periodId);
    const policy = await this.configurationRepo?.findPolicyByProfileId(input.profileId);
    if (this.configurationRepo && (!profile || profile.companyId !== input.companyId || profile.status !== "ACTIVE")) {
      throw new ReconciliationConfigurationError("O perfil não existe, está inativo ou pertence a outra empresa");
    }
    if (this.configurationRepo && (!period || period.companyId !== input.companyId || period.status !== "OPEN")) {
      throw new ReconciliationConfigurationError("A competência não existe, está fechada ou pertence a outra empresa");
    }
    const periodPrefix = period ? normalizePeriod(period.period) : undefined;
    const rawStatements = (await this.transactionRepo.findByCompanyId(input.companyId)).filter((transaction) =>
      (!profile || transaction.accountId === profile.bankAccountId)
      && (!periodPrefix || transaction.transactionDate.startsWith(periodPrefix)),
    );
    const rawLedgers = (await this.ledgerRepo.findByCompanyId(input.companyId)).filter((entry) =>
      (!profile || profile.ledgerAccountIds.includes(entry.ledgerAccountId))
      && (!periodPrefix || entry.transactionDate.startsWith(periodPrefix)),
    );

    const statements: MatchableEntry[] = rawStatements.map((tx) => ({
      id: tx.id,
      date: tx.transactionDate.split("T")[0]!,
      amount: tx.amount,
      nature: tx.nature as "DEBIT" | "CREDIT",
      ...(tx.description !== undefined ? { description: tx.description } : {}),
      ...(tx.documentNumber !== undefined && tx.documentNumber !== null ? { documentNumber: tx.documentNumber } : {}),
    }));

    const ledgers: MatchableEntry[] = rawLedgers.map((lx) => ({
      id: lx.id,
      date: lx.transactionDate,
      amount: lx.amount,
      nature: lx.nature as "DEBIT" | "CREDIT",
      ...(lx.description !== undefined ? { description: lx.description } : {}),
      ...(lx.documentNumber !== undefined && lx.documentNumber !== null ? { documentNumber: lx.documentNumber } : {}),
    }));

    const valueTolerance = policy?.amountTolerance ?? profile?.amountTolerance ?? input.valueTolerance ?? "0.00";
    const dateToleranceDays = policy?.dateToleranceDays ?? profile?.dateToleranceDays ?? input.dateToleranceDays ?? 0;
    const matching = policy ? {
      allowOneToMany: policy.allowOneToMany,
      allowManyToOne: policy.allowManyToOne,
      allowManyToMany: policy.allowManyToMany,
      ...(policy.descriptionSimilarityThreshold !== undefined
        ? { descriptionSimilarityThreshold: policy.descriptionSimilarityThreshold }
        : {}),
    } : input.matching;
    const engine = new ReconciliationEngine(valueTolerance, dateToleranceDays, matching);
    const results = engine.reconcile(ledgers, statements);

    const runId = randomUUID();
    const matchGroups: MatchGroup[] = [];
    const exceptions: ReconciliationException[] = [];
    const evidences: Evidence[] = [];
    const now = new Date();

    for (const result of results) {
      const evidenceId = `${runId}:${result.id}`;
      let matchGroupId: string | undefined;
      let exceptionId: string | undefined;
      if (result.status.startsWith("AUTO_MATCH_") || result.status === "BANK_NET_ZERO" || result.status === "GROUP_SUGGESTION") {
        const resultLedgers = result.ledgers ?? (result.ledger ? [result.ledger] : []);
        const resultStatements = result.statements ?? (result.statement ? [result.statement] : []);
        matchGroupId = `${runId}:${result.id}`;
        matchGroups.push({
          id: matchGroupId,
          reconciliationRunId: runId,
          ruleId: result.rule,
          cardinality: result.evidence.cardinality,
          confidence: result.evidence.confidence,
          matchedStatementIds: resultStatements.map((statement) => statement.id),
          matchedLedgerIds: resultLedgers.map((ledger) => ledger.id),
          ...(result.evidence.dateDifferenceDays !== undefined
            ? { dateDifferenceDays: result.evidence.dateDifferenceDays }
            : {}),
          amountDifference: decimalString(result.evidence.amountDifference),
          ...(result.evidence.descriptionSimilarity !== undefined
            ? { descriptionSimilarity: result.evidence.descriptionSimilarity }
            : {}),
          status: result.status === "GROUP_SUGGESTION" ? "SUGGESTED" : "AUTO_CONFIRMED",
          createdAt: now,
        });
      }

      if (!isTerminalAutomaticStatus(result.status)) {
        exceptionId = randomUUID();
        exceptions.push({
          id: exceptionId,
          reconciliationRunId: runId,
          type: this.mapExceptionType(result.status),
          status: "OPEN",
          ...(result.statement?.id !== undefined ? { statementId: result.statement.id } : {}),
          ...(result.ledger?.id !== undefined ? { ledgerId: result.ledger.id } : {}),
          candidateIds: result.candidates?.map((candidate) => candidate.id)
            ?? [...(result.ledgers ?? []), ...(result.statements ?? [])].map((candidate) => candidate.id),
          evidenceIds: [evidenceId],
          createdAt: now,
          updatedAt: now,
        });
      }
      evidences.push({
        id: evidenceId,
        reconciliationRunId: runId,
        ...(matchGroupId ? { matchGroupId } : {}),
        ...(exceptionId ? { exceptionId } : {}),
        type: "MATCH_DECISION",
        source: {
          ruleId: result.evidence.ruleId,
          cardinality: result.evidence.cardinality,
          ledgerIds: result.evidence.ledgerIds,
          statementIds: result.evidence.statementIds,
        },
        content: {
          status: result.evidence.status,
          confidence: result.evidence.confidence,
          amountDifference: result.evidence.amountDifference,
          dateDifferenceDays: result.evidence.dateDifferenceDays ?? null,
          descriptionSimilarity: result.evidence.descriptionSimilarity ?? null,
          evaluatedAt: result.evidence.evaluatedAt,
        },
        createdAt: now,
      });
    }

    const run: ReconciliationRun = {
      id: runId,
      companyId: input.companyId,
      profileId: input.profileId,
      periodId: input.periodId,
      preparerId: input.preparerId,
      status: "PREPARING",
      createdAt: now,
      updatedAt: now,
      matchGroups,
      exceptions,
    };

    if (this.runRepo) {
      await this.runRepo.save(run);
    }
    for (const evidence of evidences) await this.evidenceRepo?.save(evidence);
    await this.auditRepo?.append({
      id: randomUUID(),
      companyId: input.companyId,
      entityType: "RECONCILIATION_RUN",
      entityId: runId,
      action: "RECONCILIATION_EXECUTED",
      actorId: input.preparerId,
      occurredAt: now,
      metadata: {
        automaticMatches: matchGroups.filter(
          (group) => group.status === "AUTO_CONFIRMED" && isEffectiveReconciliation(group),
        ).length,
        suggestions: matchGroups.filter((group) => group.status === "SUGGESTED").length,
        exceptions: exceptions.length,
      },
    });

    return run;
  }

  private mapExceptionType(status: MatchStatus): ExceptionType {
    switch (status) {
      case "VALUE_ONLY_SUGGESTION": return "POSSIBLE_MATCH";
      case "VALUE_DIVERGENCE": return "AMOUNT_DIFFERENCE";
      case "DATE_DIVERGENCE": return "DATE_DIFFERENCE";
      case "AMBIGUOUS_MATCH": return "AMBIGUOUS_MATCH";
      case "GROUP_SUGGESTION": return "POSSIBLE_MATCH";
      case "LEDGER_WITHOUT_STATEMENT": return "LEDGER_ONLY";
      case "STATEMENT_WITHOUT_LEDGER": return "BANK_ONLY";
      default: return "SOURCE_ERROR";
    }
  }
}

function isTerminalAutomaticStatus(status: MatchStatus): boolean {
  return status.startsWith("AUTO_MATCH_") || status === "BANK_NET_ZERO" || status === "AUTO_APPLICATION_EXCLUDED";
}

export class ReconciliationConfigurationError extends Error {
  readonly code = "INVALID_RECONCILIATION_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "ReconciliationConfigurationError";
  }
}

function normalizePeriod(period: string): string {
  if (/^\d{6}$/.test(period)) return `${period.slice(0, 4)}-${period.slice(4, 6)}`;
  if (/^\d{4}-\d{2}$/.test(period)) return period;
  throw new ReconciliationConfigurationError("A competência deve usar YYYYMM ou YYYY-MM");
}
