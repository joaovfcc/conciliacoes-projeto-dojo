import type { ReconciliationPolicy } from "./ReconciliationPolicy.js";
import type { ReconciliationProfile } from "./ReconciliationProfile.js";

export interface ReconciliationPeriod {
  id: string;
  companyId: string;
  period: string;
  status: "OPEN" | "CLOSED";
  closedAt?: Date;
}

export interface ReconciliationConfigurationRepository {
  saveProfile(profile: ReconciliationProfile): Promise<void>;
  findProfileById(id: string): Promise<ReconciliationProfile | null>;
  listProfilesByCompany(companyId: string): Promise<ReconciliationProfile[]>;
  savePolicy(policy: ReconciliationPolicy): Promise<void>;
  findPolicyByProfileId(profileId: string): Promise<ReconciliationPolicy | null>;
  savePeriod(period: ReconciliationPeriod): Promise<void>;
  findPeriodById(id: string): Promise<ReconciliationPeriod | null>;
}
