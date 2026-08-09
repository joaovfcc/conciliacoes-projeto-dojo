import type { NormalizedLedgerEntry } from "./NormalizedLedgerEntry.js";

export interface LedgerRepository {
  saveMany(entries: NormalizedLedgerEntry[]): Promise<void>;
  findByCompanyId(companyId: string): Promise<NormalizedLedgerEntry[]>;
}
