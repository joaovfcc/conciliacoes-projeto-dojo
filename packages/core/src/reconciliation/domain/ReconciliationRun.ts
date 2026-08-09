import type { DecimalString } from "../../shared/domain/Decimal.js";

export type ExceptionType =
  | "BANK_ONLY"
  | "LEDGER_ONLY"
  | "AMOUNT_DIFFERENCE"
  | "DATE_DIFFERENCE"
  | "POSSIBLE_MATCH"
  | "DUPLICATE"
  | "BALANCE_DIFFERENCE"
  | "SOURCE_ERROR"
  | "AMBIGUOUS_MATCH";

export type ExceptionStatus =
  | "OPEN"
  | "ASSIGNED"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "ACCEPTED_TIMING_DIFFERENCE"
  | "REJECTED";

export interface ReconciliationException {
  id: string;
  reconciliationRunId: string;
  type: ExceptionType;
  status: ExceptionStatus;
  assignedTo?: string;
  dueDate?: Date;
  resolutionCode?: string;
  explanation?: string;
  statementId?: string;
  ledgerId?: string;
  candidateIds: string[];
  evidenceIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MatchGroup {
  id: string;
  reconciliationRunId: string;
  ruleId: string;
  cardinality: "ONE_TO_ONE" | "ONE_TO_MANY" | "MANY_TO_ONE" | "MANY_TO_MANY";
  confidence: number;
  matchedStatementIds: string[];
  matchedLedgerIds: string[];
  dateDifferenceDays?: number;
  amountDifference?: DecimalString;
  descriptionSimilarity?: number;
  status: "AUTO_CONFIRMED" | "SUGGESTED" | "MANUALLY_CONFIRMED" | "REJECTED";
  actorId?: string;
  createdAt: Date;
}

export type ReconciliationRunStatus =
  | "PREPARING"
  | "READY_FOR_REVIEW"
  | "UNDER_REVIEW"
  | "REJECTED"
  | "APPROVED"
  | "CLOSED";

export interface ReconciliationRun {
  id: string;
  companyId: string;
  profileId: string;
  periodId: string;
  status: ReconciliationRunStatus;
  preparerId: string;
  reviewerId?: string;
  comments?: string;
  submittedAt?: Date;
  approvedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  matchGroups: MatchGroup[];
  exceptions: ReconciliationException[];
}
