import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportBatch, ImportedFile, ImportStatus } from "../domain/ImportBatch.js";

export class InMemoryImportBatchRepository implements ImportBatchRepository {
  readonly batches = new Map<string, ImportBatch>();
  readonly files = new Map<string, ImportedFile>();

  async create(batch: ImportBatch): Promise<void> {
    if (this.batches.has(batch.id)) throw new Error("Lote de importação já existe.");
    this.batches.set(batch.id, structuredClone(batch));
  }

  async findById(id: string): Promise<ImportBatch | null> {
    const batch = this.batches.get(id);
    return batch ? structuredClone(batch) : null;
  }

  async findDuplicate(companyId: string, bankAccountId: string | undefined, fileHash: string): Promise<ImportBatch | null> {
    const batch = [...this.batches.values()].find(
      (candidate) =>
        candidate.companyId === companyId &&
        candidate.bankAccountId === bankAccountId &&
        candidate.fileHash === fileHash,
    );
    return batch ? structuredClone(batch) : null;
  }

  async updateStatus(
    id: string,
    status: ImportStatus,
    changes: Partial<Pick<ImportBatch, "layoutVersionId" | "warnings" | "errors" | "validatedAt">> = {},
  ): Promise<void> {
    const batch = this.batches.get(id);
    if (!batch) throw new Error("Lote de importação não encontrado.");
    this.batches.set(id, { ...batch, ...changes, status, updatedAt: new Date() });
  }

  async addFile(file: ImportedFile): Promise<void> {
    if (!this.batches.has(file.importBatchId)) throw new Error("Lote de importação não encontrado.");
    this.files.set(file.id, structuredClone(file));
  }
}
