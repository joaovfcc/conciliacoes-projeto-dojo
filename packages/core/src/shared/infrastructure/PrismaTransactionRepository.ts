import type { Prisma, PrismaClient } from "@prisma/client";
import type { NormalizedTransaction } from "../domain/NormalizedTransaction.js";
import type { TransactionRepository } from "../domain/TransactionRepository.js";

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveAll(transactions: NormalizedTransaction[]): Promise<void> {
    if (transactions.length === 0) return;

    // Prisma doesn't natively support bulk upsert in sqlite easily,
    // but we can use createMany for inserts
    const data: Prisma.NormalizedTransactionCreateManyInput[] = transactions.map((t) => ({
      id: t.id,
      companyId: t.companyId,
      accountId: t.accountId,
      importBatchId: t.importBatchId,
      transactionDate: new Date(t.transactionDate),
      postingDate: t.postingDate ? new Date(t.postingDate) : null,
      amount: t.amount,
      nature: t.nature,
      description: t.description,
      documentNumber: t.documentNumber ?? null,
      counterpartyDocument: t.counterpartyDocument ?? null,
      balanceAfter: t.balanceAfter ?? null,
      source: t.source as unknown as Prisma.InputJsonValue,
      parsing: t.parsing as unknown as Prisma.InputJsonValue,
    }));

    await this.prisma.normalizedTransaction.createMany({
      data,
    });
  }

  async findByCompanyId(companyId: string): Promise<NormalizedTransaction[]> {
    const records = await this.prisma.normalizedTransaction.findMany({
      where: { companyId, importBatch: { status: "VALIDATED" } },
    });
    return records.map(this.mapToDomain);
  }

  async findByImportBatchId(importBatchId: string): Promise<NormalizedTransaction[]> {
    const records = await this.prisma.normalizedTransaction.findMany({
      where: { importBatchId },
    });
    return records.map(this.mapToDomain);
  }

  private mapToDomain(record: Prisma.NormalizedTransactionGetPayload<object>): NormalizedTransaction {
    return {
      id: record.id,
      companyId: record.companyId,
      accountId: record.accountId,
      importBatchId: record.importBatchId,
      transactionDate: record.transactionDate.toISOString().split("T")[0]!,
      ...(record.postingDate ? { postingDate: record.postingDate.toISOString().split("T")[0]! } : {}),
      amount: record.amount.toFixed(2) as NormalizedTransaction["amount"],
      nature: record.nature as "DEBIT" | "CREDIT",
      description: record.description,
      ...(record.documentNumber ? { documentNumber: record.documentNumber } : {}),
      ...(record.counterpartyDocument ? { counterpartyDocument: record.counterpartyDocument } : {}),
      ...(record.balanceAfter !== null
        ? { balanceAfter: record.balanceAfter.toFixed(2) as NormalizedTransaction["amount"] }
        : {}),
      source: record.source as unknown as NormalizedTransaction["source"],
      parsing: record.parsing as unknown as NormalizedTransaction["parsing"],
    };
  }
}
