import { z } from "zod";

export const ADVISOR_CONTRACT_VERSION_V1 = "1.0" as const;

export const advisorDecisionValues = ["SUGGEST_MATCH", "NO_MATCH", "REVIEW_REQUIRED"] as const;
export type AdvisorDecisionV1 = (typeof advisorDecisionValues)[number];

export const advisorReasonCodeValues = [
  "HISTORY_SIMILARITY",
  "DOCUMENT_REFERENCE",
  "PROBABLE_GROUP",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type AdvisorReasonCodeV1 = (typeof advisorReasonCodeValues)[number];

export const advisorErrorCodeValues = [
  "ADVISOR_DISABLED",
  "ADVISOR_TIMEOUT",
  "ADVISOR_UNAVAILABLE",
  "ADVISOR_CONTRACT_MISMATCH",
  "ADVISOR_INVALID_RESPONSE",
  "ADVISOR_UNKNOWN_ID",
  "ADVISOR_SCOPE_VIOLATION",
  "ADVISOR_REUSED_TRANSACTION",
  "ADVISOR_AMOUNT_MISMATCH",
  "ADVISOR_CARDINALITY_EXCEEDED",
  "ADVISOR_CIRCUIT_OPEN",
] as const;
export type AdvisorErrorCodeV1 = (typeof advisorErrorCodeValues)[number];

export const advisorSourceValues = ["LEDGER", "STATEMENT"] as const;
export type AdvisorSourceV1 = (typeof advisorSourceValues)[number];

export const advisorRequestEntryV1Schema = z.object({
  id: z.string().min(1),
  source: z.enum(advisorSourceValues),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.string().regex(/^-?\d+$/),
  document: z.string(),
  normalizedHistory: z.string(),
});
export type AdvisorRequestEntryV1 = z.infer<typeof advisorRequestEntryV1Schema>;

export const advisorRequestGroupV1Schema = z.object({
  groupId: z.string().min(1),
  anchorId: z.string().min(1),
  entries: z.array(advisorRequestEntryV1Schema).min(2),
});
export type AdvisorRequestGroupV1 = z.infer<typeof advisorRequestGroupV1Schema>;

export const advisorRequestV1Schema = z.object({
  contractVersion: z.literal(ADVISOR_CONTRACT_VERSION_V1),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  period: z.string().min(1),
  currency: z.literal("BRL"),
  promptVersion: z.string().min(1),
  groups: z.array(advisorRequestGroupV1Schema),
});
export type AdvisorRequestV1 = z.infer<typeof advisorRequestV1Schema>;

export const advisorSuggestionV1Schema = z.object({
  groupId: z.string().min(1),
  anchorId: z.string().min(1),
  candidateIds: z.array(z.string().min(1)),
  decision: z.enum(advisorDecisionValues),
  confidenceBps: z.number().int().min(0).max(10000),
  reasonCode: z.enum(advisorReasonCodeValues),
  explanationPtBr: z.string().min(1),
});
export type AdvisorSuggestionV1 = z.infer<typeof advisorSuggestionV1Schema>;

export const advisorResponseV1Schema = z.object({
  contractVersion: z.literal(ADVISOR_CONTRACT_VERSION_V1),
  requestId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  suggestions: z.array(advisorSuggestionV1Schema),
});
export type AdvisorResponseV1 = z.infer<typeof advisorResponseV1Schema>;
