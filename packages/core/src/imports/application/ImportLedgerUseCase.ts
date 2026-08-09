import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { parseLedger } from "../../parsers/ledger.js";
import type { SourceFileInput } from "../../parsers/types.js";
import { parseMoney } from "../../normalization.js";
import type { LedgerRepository } from "../../shared/domain/LedgerRepository.js";
import { createNormalizedLedgerEntry, type NormalizedLedgerEntry } from "../../shared/domain/NormalizedLedgerEntry.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportBatchIssue, ImportStatus } from "../domain/ImportBatch.js";
import type { AuditRepository } from "../../audit/domain/AuditEvent.js";
import type { EvidenceRepository } from "../../shared/domain/Evidence.js";
import { InMemoryImportBatchRepository } from "../infrastructure/InMemoryImportBatchRepository.js";
import { InMemoryAuditRepository } from "../../audit/infrastructure/InMemoryAuditRepository.js";
import { InMemoryEvidenceRepository } from "../../shared/infrastructure/InMemoryEvidenceRepository.js";

export interface ImportLedgerInput {
  fileId?: string;
  originalName: string;
  buffer: Buffer;
  companyId: string;
  importBatchId?: string;
  contentType?: string;
  actorId?: string;
  allowDuplicate?: boolean;
  ledgerAccountId?: string;
  ledgerAccountMappings?: Record<string, string>;
}

export interface ImportLedgerResult {
  importBatchId: string;
  status: ImportStatus;
  success: boolean;
  recordsProcessed: number;
  entries: NormalizedLedgerEntry[];
  warnings: ImportBatchIssue[];
  duplicateOf?: string;
}

export class ImportLedgerUseCase {
  constructor(
    private readonly ledgerRepo?: LedgerRepository,
    private readonly importBatchRepo: ImportBatchRepository = new InMemoryImportBatchRepository(),
    private readonly auditRepo: AuditRepository = new InMemoryAuditRepository(),
    private readonly evidenceRepo: EvidenceRepository = new InMemoryEvidenceRepository(),
  ) {}

  async execute(input: ImportLedgerInput): Promise<ImportLedgerResult> {
    const importBatchId = input.importBatchId ?? randomUUID();
    const fileId = input.fileId ?? randomUUID();
    const fileHash = createHash("sha256").update(input.buffer).digest("hex");
    const duplicate = await this.importBatchRepo.findDuplicate(input.companyId, undefined, fileHash);
    if (duplicate && !input.allowDuplicate) {
      return {
        importBatchId: duplicate.id,
        status: "REJECTED",
        success: false,
        recordsProcessed: 0,
        entries: [],
        warnings: [{ code: "DUPLICATE_IMPORT", message: "Este razão já foi importado para a empresa.", severity: "ERROR" }],
        duplicateOf: duplicate.id,
      };
    }
    const now = new Date();
    await this.importBatchRepo.create({
      id: importBatchId,
      companyId: input.companyId,
      fileHash,
      deduplicationKey: `${input.companyId}|LEDGER|${fileHash}${duplicate ? `|${importBatchId}` : ""}`,
      status: "RECEIVED",
      duplicateAuthorizationGranted: Boolean(duplicate && input.allowDuplicate),
      warnings: [], errors: [], createdAt: now, updatedAt: now,
    });
    const extension = extname(input.originalName).toLowerCase();
    const securityIssue = ![".csv", ".xlsx", ".xls", ".xlsm"].includes(extension)
      ? [{ code: "LEDGER_FORMAT_UNSUPPORTED", message: "O razão deve ser CSV, XLS, XLSX ou XLSM.", severity: "ERROR" as const }]
      : input.buffer.length === 0
        ? [{ code: "EMPTY_FILE", message: "O arquivo está vazio.", severity: "ERROR" as const }]
        : [];
    if (securityIssue.length > 0) return this.reject(importBatchId, input, securityIssue);
    await this.importBatchRepo.addFile({
      id: fileId, importBatchId, originalName: input.originalName,
      sanitizedName: input.originalName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120), extension,
      mimeType: input.contentType ?? "application/octet-stream", size: input.buffer.length, createdAt: now,
    });
    await this.importBatchRepo.updateStatus(importBatchId, "READING");

    const file: SourceFileInput = {
      id: fileId, originalName: input.originalName, buffer: input.buffer, kind: "LEDGER",
      contentType: input.contentType ?? "application/octet-stream",
    };
    try {
      const parsed = await parseLedger(file);
      const issues = parsed.issues.map<ImportBatchIssue>((issue) => ({ code: issue.code, message: issue.message, severity: issue.severity }));
      if (issues.some((issue) => issue.severity === "ERROR")) return this.reject(importBatchId, input, issues);
      await this.importBatchRepo.updateStatus(importBatchId, "PARSING");
      const missingMappings = new Set<string>();
      const entries = parsed.records.map((record) => {
        const ledgerAccountId = input.ledgerAccountMappings?.[record.ledgerAccount] ?? input.ledgerAccountId;
        if (!ledgerAccountId) missingMappings.add(record.ledgerAccount);
        const amount = parseMoney(record.value);
        return createNormalizedLedgerEntry({
          id: record.id,
          companyId: input.companyId,
          ledgerAccountId: ledgerAccountId ?? record.ledgerAccount,
          importBatchId,
          transactionDate: record.date,
          amount: amount.abs().toFixed(2),
          nature: amount.isNegative() ? "DEBIT" : "CREDIT",
          description: record.history,
          ...(record.document ? { documentNumber: record.document } : {}),
          source: {
            fileId,
            ...(record.evidence.line ? { row: record.evidence.line, line: record.evidence.line } : {}),
            extractionMethod: record.evidence.extractionMethod,
            rawValues: {
              company: record.company, branch: record.branch, ledgerAccount: record.ledgerAccount,
              date: record.date, document: record.document, description: record.history, value: record.value,
            },
          },
        });
      });
      if (missingMappings.size > 0) {
        const warnings: ImportBatchIssue[] = [{
          code: "LEDGER_ACCOUNT_MAPPING_REQUIRED",
          message: `Contas contábeis sem vínculo: ${[...missingMappings].sort().join(", ")}.`,
          severity: "WARNING",
        }];
        await this.importBatchRepo.updateStatus(importBatchId, "NEEDS_MAPPING", { warnings });
        return { importBatchId, status: "NEEDS_MAPPING", success: false, recordsProcessed: entries.length, entries, warnings };
      }
      if (this.ledgerRepo) await this.ledgerRepo.saveMany(entries);
      for (const entry of entries) {
        await this.evidenceRepo.save({
          id: randomUUID(), importBatchId, type: "LEDGER_SOURCE", source: entry.source,
          content: { ledgerEntryId: entry.id, ledgerAccountId: entry.ledgerAccountId }, createdAt: new Date(),
        });
      }
      const status: ImportStatus = issues.length > 0 ? "PARSED_WITH_WARNINGS" : "VALIDATED";
      await this.importBatchRepo.updateStatus(importBatchId, status, { warnings: issues, ...(status === "VALIDATED" ? { validatedAt: new Date() } : {}) });
      await this.auditRepo.append({
        id: randomUUID(), companyId: input.companyId, entityType: "IMPORT_BATCH", entityId: importBatchId,
        action: "LEDGER_IMPORT_VALIDATED", ...(input.actorId ? { actorId: input.actorId } : {}), occurredAt: new Date(),
        metadata: { recordsProcessed: entries.length },
      });
      return { importBatchId, status, success: true, recordsProcessed: entries.length, entries, warnings: issues };
    } catch (error) {
      return this.reject(importBatchId, input, [{ code: "LEDGER_IMPORT_FAILED", message: error instanceof Error ? error.message : "Falha ao importar razão.", severity: "ERROR" }]);
    }
  }

  private async reject(importBatchId: string, input: ImportLedgerInput, warnings: ImportBatchIssue[]): Promise<ImportLedgerResult> {
    await this.importBatchRepo.updateStatus(importBatchId, "REJECTED", { errors: warnings });
    await this.auditRepo.append({
      id: randomUUID(), companyId: input.companyId, entityType: "IMPORT_BATCH", entityId: importBatchId,
      action: "LEDGER_IMPORT_REJECTED", ...(input.actorId ? { actorId: input.actorId } : {}), occurredAt: new Date(),
      metadata: { issueCodes: warnings.map((warning) => warning.code) },
    });
    return { importBatchId, status: "REJECTED", success: false, recordsProcessed: 0, entries: [], warnings };
  }
}
