import type { Prisma, PrismaClient } from "@prisma/client";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportBatch, ImportBatchIssue, ImportedFile, ImportStatus } from "../domain/ImportBatch.js";

export class PrismaImportBatchRepository implements ImportBatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(batch: ImportBatch): Promise<void> {
    await this.prisma.importBatch.create({
      data: {
        id: batch.id,
        companyId: batch.companyId,
        bankAccountId: batch.bankAccountId ?? null,
        dataSourceId: batch.dataSourceId ?? null,
        layoutVersionId: batch.layoutVersionId ?? null,
        fileHash: batch.fileHash,
        deduplicationKey: batch.deduplicationKey,
        status: batch.status,
        duplicateAuthorizationGranted: batch.duplicateAuthorizationGranted,
        warnings: batch.warnings as unknown as Prisma.InputJsonValue,
        errors: batch.errors as unknown as Prisma.InputJsonValue,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        validatedAt: batch.validatedAt ?? null,
      },
    });
  }

  async findById(id: string): Promise<ImportBatch | null> {
    const record = await this.prisma.importBatch.findUnique({ where: { id } });
    return record ? this.toDomain(record) : null;
  }

  async findDuplicate(companyId: string, bankAccountId: string | undefined, fileHash: string): Promise<ImportBatch | null> {
    const record = await this.prisma.importBatch.findFirst({
      where: { companyId, bankAccountId: bankAccountId ?? null, fileHash },
      orderBy: { createdAt: "desc" },
    });
    return record ? this.toDomain(record) : null;
  }

  async updateStatus(
    id: string,
    status: ImportStatus,
    changes: Partial<Pick<ImportBatch, "layoutVersionId" | "warnings" | "errors" | "validatedAt">> = {},
  ): Promise<void> {
    await this.prisma.importBatch.update({
      where: { id },
      data: {
        status,
        ...(changes.layoutVersionId !== undefined ? { layoutVersionId: changes.layoutVersionId } : {}),
        ...(changes.warnings !== undefined
          ? { warnings: changes.warnings as unknown as Prisma.InputJsonValue }
          : {}),
        ...(changes.errors !== undefined ? { errors: changes.errors as unknown as Prisma.InputJsonValue } : {}),
        ...(changes.validatedAt !== undefined ? { validatedAt: changes.validatedAt } : {}),
      },
    });
  }

  async addFile(file: ImportedFile): Promise<void> {
    await this.prisma.importedFile.create({
      data: {
        id: file.id,
        importBatchId: file.importBatchId,
        originalName: file.originalName,
        sanitizedName: file.sanitizedName,
        extension: file.extension,
        mimeType: file.mimeType,
        size: file.size,
        storageKey: file.storageKey ?? null,
        createdAt: file.createdAt,
      },
    });
  }

  private toDomain(record: {
    id: string;
    companyId: string;
    bankAccountId: string | null;
    dataSourceId: string | null;
    layoutVersionId: string | null;
    fileHash: string;
    deduplicationKey: string;
    status: ImportStatus;
    duplicateAuthorizationGranted: boolean;
    warnings: Prisma.JsonValue;
    errors: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
    validatedAt: Date | null;
  }): ImportBatch {
    return {
      id: record.id,
      companyId: record.companyId,
      ...(record.bankAccountId ? { bankAccountId: record.bankAccountId } : {}),
      ...(record.dataSourceId ? { dataSourceId: record.dataSourceId } : {}),
      ...(record.layoutVersionId ? { layoutVersionId: record.layoutVersionId } : {}),
      fileHash: record.fileHash,
      deduplicationKey: record.deduplicationKey,
      status: record.status,
      duplicateAuthorizationGranted: record.duplicateAuthorizationGranted,
      warnings: (record.warnings ?? []) as unknown as ImportBatchIssue[],
      errors: (record.errors ?? []) as unknown as ImportBatchIssue[],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.validatedAt ? { validatedAt: record.validatedAt } : {}),
    };
  }
}
