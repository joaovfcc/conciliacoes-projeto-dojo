import type { DecimalString } from "../../shared/domain/Decimal.js";

export type MatchingStrategy =
  | "DATE_AMOUNT_DOCUMENT"
  | "DATE_AMOUNT_DESCRIPTION"
  | "AMOUNT_DOCUMENT"
  | "CUSTOM";

export interface ReconciliationPolicy {
  id: string;
  reconciliationProfileId: string;
  matchingStrategy: MatchingStrategy;
  dateToleranceDays: number;
  amountTolerance: DecimalString;
  allowOneToMany: boolean;
  allowManyToOne: boolean;
  allowManyToMany: boolean;
  descriptionSimilarityThreshold?: number;
  materialityThreshold?: DecimalString;
}
