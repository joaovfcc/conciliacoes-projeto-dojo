import type { DecimalString } from "../../shared/domain/Decimal.js";

export interface ReconciliationProfile {
  id: string;
  companyId: string;
  bankAccountId: string;
  ledgerAccountIds: string[];
  matchTypeId: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  amountTolerance: DecimalString;
  dateToleranceDays: number;
  preparerId?: string;
  reviewerIds?: string[];
  materialityThreshold?: DecimalString;
  status: "ACTIVE" | "INACTIVE";
}
