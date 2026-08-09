import type { ImportBatch, ImportedFile, ImportStatus } from "./ImportBatch.js";

export interface ImportBatchRepository {
  create(batch: ImportBatch): Promise<void>;
  findById(id: string): Promise<ImportBatch | null>;
  findDuplicate(companyId: string, bankAccountId: string | undefined, fileHash: string): Promise<ImportBatch | null>;
  updateStatus(
    id: string,
    status: ImportStatus,
    changes?: Partial<Pick<ImportBatch, "layoutVersionId" | "warnings" | "errors" | "validatedAt">>,
  ): Promise<void>;
  addFile(file: ImportedFile): Promise<void>;
}
