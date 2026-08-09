import type { NormalizedTransaction } from "./NormalizedTransaction.js";

export interface TransactionRepository {
  saveAll(transactions: NormalizedTransaction[]): Promise<void>;
  findByCompanyId(companyId: string): Promise<NormalizedTransaction[]>;
  findByImportBatchId(importBatchId: string): Promise<NormalizedTransaction[]>;
}
