import { createHash, randomUUID } from "node:crypto";
import { extname, basename } from "node:path";
import { parseStatement as parseAnyStatement } from "../../preflight.js";
import { parseTabularStatement } from "../../parsers/tabular.js";
import type { SourceFileInput } from "../../parsers/types.js";
import { parseMoney } from "../../normalization.js";
import { runStatementQualityGates } from "../../statement-gates.js";
import type { CanonicalStatementDocument, StatementSourceFormat } from "../../statement-sources.js";
import { createNormalizedTransaction, type NormalizedTransaction } from "../../shared/domain/NormalizedTransaction.js";
import type { TransactionRepository } from "../../shared/domain/TransactionRepository.js";
import type { LayoutRepository } from "../../shared/domain/LayoutRepository.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportBatchIssue, ImportStatus } from "../domain/ImportBatch.js";
import type { AuditRepository } from "../../audit/domain/AuditEvent.js";
import type { EvidenceRepository } from "../../shared/domain/Evidence.js";
import { InMemoryImportBatchRepository } from "../infrastructure/InMemoryImportBatchRepository.js";
import { InMemoryAuditRepository } from "../../audit/infrastructure/InMemoryAuditRepository.js";
import { InMemoryEvidenceRepository } from "../../shared/infrastructure/InMemoryEvidenceRepository.js";
import { ITAU_CHECKING_XLSX_V1 } from "../../statements/profiles/itau-checking-xlsx-v1.js";
import { GENERIC_STATEMENT_V1 } from "../../statements/profiles/generic-statement-v1.js";
import type { BankAccountRepository } from "../../accounts/domain/AccountRepositories.js";

export interface ImportStatementInput {
  companyId: string;
  accountId: string;
  fileBuffer: Buffer;
  originalName: string;
  contentType?: string;
  dataSourceId?: string;
  actorId?: string;
  allowDuplicate?: boolean;
}

export interface ImportStatementResult {
  importBatchId: string;
  status: ImportStatus;
  transactions: NormalizedTransaction[];
  warnings: ImportBatchIssue[];
  duplicateOf?: string;
}

const allowedExtensions = new Set([".ofx", ".csv", ".xlsx", ".xls", ".xlsm", ".pdf"]);
const maxFileSize = 25 * 1024 * 1024;

export class ImportStatementUseCase {
  constructor(
    private readonly transactionRepo?: TransactionRepository,
    private readonly layoutRepo?: LayoutRepository,
    private readonly importBatchRepo: ImportBatchRepository = new InMemoryImportBatchRepository(),
    private readonly auditRepo: AuditRepository = new InMemoryAuditRepository(),
    private readonly evidenceRepo: EvidenceRepository = new InMemoryEvidenceRepository(),
    private readonly bankAccountRepo?: BankAccountRepository,
  ) {}

  async execute(input: ImportStatementInput): Promise<ImportStatementResult> {
    const importBatchId = randomUUID();
    const fileHash = createHash("sha256").update(input.fileBuffer).digest("hex");
    const duplicate = await this.importBatchRepo.findDuplicate(input.companyId, input.accountId, fileHash);
    if (duplicate && !input.allowDuplicate) {
      return {
        importBatchId: duplicate.id,
        status: "REJECTED",
        transactions: [],
        warnings: [{ code: "DUPLICATE_IMPORT", message: "Este arquivo já foi importado para a mesma empresa e conta.", severity: "ERROR" }],
        duplicateOf: duplicate.id,
      };
    }

    const now = new Date();
    await this.importBatchRepo.create({
      id: importBatchId,
      companyId: input.companyId,
      bankAccountId: input.accountId,
      ...(input.dataSourceId ? { dataSourceId: input.dataSourceId } : {}),
      fileHash,
      deduplicationKey: `${input.companyId}|${input.accountId}|${fileHash}${duplicate ? `|${importBatchId}` : ""}`,
      status: "RECEIVED",
      duplicateAuthorizationGranted: Boolean(duplicate && input.allowDuplicate),
      warnings: [],
      errors: [],
      createdAt: now,
      updatedAt: now,
    });

    const extension = extname(input.originalName).toLowerCase();
    const sanitizedName = sanitizeFileName(input.originalName);
    await this.importBatchRepo.addFile({
      id: randomUUID(), importBatchId, originalName: input.originalName, sanitizedName, extension,
      mimeType: input.contentType ?? "application/octet-stream", size: input.fileBuffer.length, createdAt: now,
    });
    await this.audit(importBatchId, input, "FILE_RECEIVED", { fileHash, extension, size: input.fileBuffer.length });

    const securityIssues = validateFile(input.fileBuffer, extension, input.contentType);
    if (securityIssues.length > 0) return this.reject(importBatchId, input, securityIssues);

    await this.importBatchRepo.updateStatus(importBatchId, "READING");
    const sourceFile: SourceFileInput = {
      id: importBatchId,
      originalName: input.originalName,
      kind: "STATEMENT",
      contentType: input.contentType ?? "application/octet-stream",
      buffer: input.fileBuffer,
    };

    try {
      let profiles = [ITAU_CHECKING_XLSX_V1, GENERIC_STATEMENT_V1];
      if (this.layoutRepo) {
        const accountLayouts = await this.layoutRepo.findActiveForAccount?.(input.accountId) ?? [];
        const stored = accountLayouts.length > 0
          ? accountLayouts
          : (await this.layoutRepo.findAll()).filter((profile) => profile.status === "VALIDATED");
        if (stored.length > 0) profiles = stored;
      }
      const parsed = [".csv", ".xlsx", ".xls", ".xlsm"].includes(extension)
        ? await parseTabularStatement(sourceFile, profiles)
        : await parseAnyStatement(sourceFile);
      const parseIssues = parsed.issues.map<ImportBatchIssue>((issue) => ({
        code: issue.code, message: issue.message, severity: issue.severity,
        ...(issue.sourcePosition ? { details: { sourcePosition: issue.sourcePosition } } : {}),
      }));
      if (parseIssues.some((issue) => issue.severity === "ERROR")) return this.reject(importBatchId, input, parseIssues);

      await this.importBatchRepo.updateStatus(importBatchId, "LAYOUT_DETECTED");
      await this.importBatchRepo.updateStatus(importBatchId, "PARSING");
      const format = sourceFormat(extension);
      const canonical = canonicalDocument(parsed, format, fileHash);
      const selectedAccount = await this.bankAccountRepo?.findById(input.accountId);
      if (this.bankAccountRepo && (!selectedAccount || selectedAccount.companyId !== input.companyId)) {
        return this.reject(importBatchId, input, [{
          code: "BANK_ACCOUNT_NOT_FOUND",
          message: "A conta bancária selecionada não pertence à empresa informada.",
          severity: "ERROR",
        }]);
      }
      const quality = runStatementQualityGates({
        document: canonical,
        sourceSupported: true,
        mappingStatus: "CONFIRMED",
        crosscheckStatus: "NOT_PROVIDED",
        ...(selectedAccount ? { expectedIdentity: {
          ...(selectedAccount.bankCode ? { bankCode: selectedAccount.bankCode } : {}),
          ...(selectedAccount.agency ? { agency: selectedAccount.agency } : {}),
          ...(selectedAccount.accountNumber
            ? { account: `${selectedAccount.accountNumber}${selectedAccount.accountDigit ?? ""}` }
            : {}),
        } } : {}),
      });
      const gateIssues: ImportBatchIssue[] = quality.gates.flatMap((gate) => gate.issueCodes.map((code) => ({
        code, message: `Gate ${gate.code}: ${code}`, severity: gate.status === "FAILED" ? "ERROR" as const : "WARNING" as const,
      })));
      if (quality.decision === "BLOCKED") return this.reject(importBatchId, input, [...parseIssues, ...gateIssues]);

      const parserId = parsed.metadata.parser || "UNKNOWN";
      const transactions = parsed.records.map((record) => {
        const value = parseMoney(record.value);
        return createNormalizedTransaction({
          id: record.id,
          companyId: input.companyId,
          accountId: input.accountId,
          importBatchId,
          transactionDate: record.date,
          amount: value.abs().toFixed(2),
          nature: value.isNegative() ? "DEBIT" : "CREDIT",
          description: record.history,
          ...(record.document ? { documentNumber: record.document } : {}),
          ...(record.runningBalance ? { balanceAfter: parseMoney(record.runningBalance).toFixed(2) as NormalizedTransaction["amount"] } : {}),
          source: {
            fileId: record.evidence.fileId,
            ...(record.evidence.line ? { row: record.evidence.line } : {}),
            rawValues: { date: record.date, document: record.document, description: record.history, value: record.value },
          },
          parsing: { layoutId: parserId, layoutVersion: 1, confidence: parserId.startsWith("generic-") ? 0.8 : 1, warnings: parseIssues.map((issue) => issue.code) },
        });
      });
      if (this.transactionRepo) await this.transactionRepo.saveAll(transactions);
      for (const transaction of transactions) {
        await this.evidenceRepo.save({
          id: randomUUID(), importBatchId, type: "TRANSACTION_SOURCE", source: transaction.source,
          content: { transactionId: transaction.id, layoutId: transaction.parsing.layoutId }, createdAt: new Date(),
        });
      }

      const requiresMapping = !parsed.metadata.bank || !parsed.metadata.account || parserId.startsWith("generic-");
      const status: ImportStatus = requiresMapping
        ? "NEEDS_MAPPING"
        : quality.decision === "REVIEW_REQUIRED" || parseIssues.length > 0 || gateIssues.length > 0
          ? "PARSED_WITH_WARNINGS"
          : "VALIDATED";
      const warnings = [...parseIssues, ...gateIssues].filter((issue) => issue.severity === "WARNING");
      await this.importBatchRepo.updateStatus(importBatchId, status, {
        warnings,
        ...(status === "VALIDATED" ? { validatedAt: new Date() } : {}),
      });
      await this.audit(importBatchId, input, status === "VALIDATED" ? "IMPORT_VALIDATED" : "IMPORT_REQUIRES_REVIEW", { status, transactionCount: transactions.length });
      return { importBatchId, status, transactions, warnings };
    } catch (error) {
      return this.reject(importBatchId, input, [{ code: "IMPORT_PIPELINE_FAILED", message: error instanceof Error ? error.message : "Falha na importação.", severity: "ERROR" }]);
    }
  }

  private async reject(importBatchId: string, input: ImportStatementInput, issues: ImportBatchIssue[]): Promise<ImportStatementResult> {
    await this.importBatchRepo.updateStatus(importBatchId, "REJECTED", { errors: issues });
    await this.audit(importBatchId, input, "IMPORT_REJECTED", { issueCodes: issues.map((issue) => issue.code) });
    return { importBatchId, status: "REJECTED", transactions: [], warnings: issues };
  }

  private async audit(entityId: string, input: ImportStatementInput, action: string, metadata: Record<string, unknown>): Promise<void> {
    await this.auditRepo.append({
      id: randomUUID(), companyId: input.companyId, entityType: "IMPORT_BATCH", entityId, action,
      ...(input.actorId ? { actorId: input.actorId } : {}), occurredAt: new Date(), metadata,
    });
  }
}

function validateFile(buffer: Buffer, extension: string, contentType: string | undefined): ImportBatchIssue[] {
  const issues: ImportBatchIssue[] = [];
  if (!allowedExtensions.has(extension)) issues.push({ code: "FILE_EXTENSION_UNSUPPORTED", message: "Extensão não suportada.", severity: "ERROR" });
  if (buffer.length === 0) issues.push({ code: "EMPTY_FILE", message: "O arquivo está vazio.", severity: "ERROR" });
  if (buffer.length > maxFileSize) issues.push({ code: "FILE_SIZE_LIMIT_EXCEEDED", message: "O arquivo excede 25 MB.", severity: "ERROR" });
  const starts = (value: string) => buffer.subarray(0, value.length).toString("latin1") === value;
  if (extension === ".pdf" && !starts("%PDF")) issues.push({ code: "MIME_SIGNATURE_MISMATCH", message: "Assinatura PDF inválida.", severity: "ERROR" });
  if ([".xlsx", ".xlsm"].includes(extension) && !starts("PK")) issues.push({ code: "MIME_SIGNATURE_MISMATCH", message: "Assinatura ZIP/XML inválida.", severity: "ERROR" });
  if (contentType?.includes("pdf") && extension !== ".pdf") issues.push({ code: "MIME_EXTENSION_MISMATCH", message: "MIME e extensão são incompatíveis.", severity: "ERROR" });
  return issues;
}

function sanitizeFileName(name: string): string {
  const safe = basename(name).normalize("NFKC").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return safe || "arquivo";
}

function sourceFormat(extension: string): StatementSourceFormat {
  const value = extension.slice(1).toUpperCase();
  if (["OFX", "CSV", "XLSX", "XLS", "XLSM", "PDF"].includes(value)) return value as StatementSourceFormat;
  throw new Error("Formato não suportado.");
}

function canonicalDocument(
  parsed: Awaited<ReturnType<typeof parseAnyStatement>>,
  format: StatementSourceFormat,
  fileHash: string,
): CanonicalStatementDocument {
  const dates = parsed.records.map((record) => record.date).sort();
  const extractionMethod = format === "CSV" ? "CSV" : format === "OFX" ? "OFX" : ["XLSX", "XLS", "XLSM"].includes(format) ? "TABULAR" : "TEXT";
  const first = parsed.records.find((record) => record.runningBalance !== undefined);
  const last = [...parsed.records].reverse().find((record) => record.runningBalance !== undefined);
  const openingBalance = first?.runningBalance
    ? parseMoney(first.runningBalance).minus(parseMoney(first.value)).toFixed(2)
    : undefined;
  return {
    sourceId: parsed.metadata.fileId,
    format,
    institutionCode: parsed.metadata.bank || "UNCONFIRMED",
    documentType: parsed.metadata.classification,
    layoutFamily: parsed.metadata.parser,
    adapterId: parsed.metadata.parser,
    adapterVersion: "1",
    identity: {
      bankName: parsed.metadata.bank || "UNCONFIRMED",
      ...(parsed.metadata.agency ? { agency: { raw: parsed.metadata.agency, normalized: parsed.metadata.agency.replace(/\D/g, "") } } : {}),
      ...(parsed.metadata.account ? { account: { raw: parsed.metadata.account, normalized: parsed.metadata.account.replace(/\D/g, "") } } : {}),
    },
    ...(dates[0] && dates.at(-1) ? { period: { start: dates[0], end: dates.at(-1)! } } : {}),
    transactions: parsed.records.map((record) => {
      const amount = parseMoney(record.value);
      return {
        transactionId: record.id,
        postingDate: record.date,
        amount: amount.toFixed(2),
        direction: amount.isNegative() ? "DEBIT" as const : "CREDIT" as const,
        description: record.history,
        ...(record.document ? { documentNumber: record.document } : {}),
        ...(record.runningBalance ? { runningBalance: record.runningBalance } : {}),
        provenance: {
          sourceId: record.evidence.fileId,
          format,
          adapterId: parsed.metadata.parser,
          adapterVersion: "1",
          rawHash: fileHash,
          extractionMethod,
          ...(record.evidence.page ? { page: record.evidence.page } : {}),
          ...(record.evidence.line ? { row: record.evidence.line } : {}),
        },
      };
    }),
    ...(openingBalance ? { openingBalance } : {}),
    ...(last?.runningBalance || parsed.metadata.finalBalance
      ? { closingBalance: last?.runningBalance ?? parsed.metadata.finalBalance! }
      : {}),
    issues: parsed.issues,
  };
}
