import type { LedgerRepository } from "../domain/LedgerRepository.js";
import type { NormalizedLedgerEntry } from "../domain/NormalizedLedgerEntry.js";
import type { NormalizedTransaction } from "../domain/NormalizedTransaction.js";
import type { TransactionRepository } from "../domain/TransactionRepository.js";

export class InMemoryTransactionRepository implements TransactionRepository {
  readonly transactions: NormalizedTransaction[] = [];

  async saveAll(transactions: NormalizedTransaction[]): Promise<void> {
    this.transactions.push(...structuredClone(transactions));
  }

  async findByCompanyId(companyId: string): Promise<NormalizedTransaction[]> {
    return structuredClone(this.transactions.filter((transaction) => transaction.companyId === companyId));
  }

  async findByImportBatchId(importBatchId: string): Promise<NormalizedTransaction[]> {
    return structuredClone(this.transactions.filter((transaction) => transaction.importBatchId === importBatchId));
  }
}

export class InMemoryLedgerRepository implements LedgerRepository {
  readonly entries: NormalizedLedgerEntry[] = [];

  async saveMany(entries: NormalizedLedgerEntry[]): Promise<void> {
    this.entries.push(...structuredClone(entries));
  }

  async findByCompanyId(companyId: string): Promise<NormalizedLedgerEntry[]> {
    return structuredClone(this.entries.filter((entry) => entry.companyId === companyId));
  }
}
