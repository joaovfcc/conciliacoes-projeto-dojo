import type { Prisma, PrismaClient } from "@prisma/client";
import type { LedgerRepository } from "../domain/LedgerRepository.js";
import type { NormalizedLedgerEntry } from "../domain/NormalizedLedgerEntry.js";

export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveMany(entries: NormalizedLedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const data: Prisma.NormalizedLedgerEntryUncheckedCreateInput[] = entries.map(entry => ({
      id: entry.id,
      companyId: entry.companyId,
      ledgerAccountId: entry.ledgerAccountId,
      importBatchId: entry.importBatchId,
      transactionDate: new Date(entry.transactionDate),
      amount: entry.amount,
      nature: entry.nature,
      description: entry.description,
      ...(entry.documentNumber !== undefined ? { documentNumber: entry.documentNumber } : {}),
      source: entry.source as unknown as Prisma.InputJsonValue,
    }));

    // For SQLite we need to avoid skipDuplicates since it's not supported in createMany
    for (const record of data) {
      await this.prisma.normalizedLedgerEntry.upsert({
        where: { id: record.id },
        update: record,
        create: record,
      });
    }
  }

  async findByCompanyId(companyId: string): Promise<NormalizedLedgerEntry[]> {
    const records = await this.prisma.normalizedLedgerEntry.findMany({
      where: { companyId, importBatch: { status: "VALIDATED" } },
    });

    return records.map(record => ({
      id: record.id,
      companyId: record.companyId,
      ledgerAccountId: record.ledgerAccountId,
      importBatchId: record.importBatchId,
      transactionDate: record.transactionDate.toISOString().split("T")[0]!,
      amount: record.amount.toFixed(2) as NormalizedLedgerEntry["amount"],
      nature: record.nature as "DEBIT" | "CREDIT",
      description: record.description,
      ...(record.documentNumber !== null ? { documentNumber: record.documentNumber } : {}),
      source: record.source as unknown as NormalizedLedgerEntry["source"],
    }));
  }
}
