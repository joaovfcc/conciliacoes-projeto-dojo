import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { calculateBalanceCheck } from "./balance.js";
import { FinancialDocumentAdapterRegistry, scoredEvidence, type FinancialDocumentAdapter } from "./document-registry.js";
import { normalizeCode, normalizeDocument, normalizeHeader, parseDate, parseMoney, periodOf, money } from "./normalization.js";
import type {
  DetectedStatement,
  ExtractionMethod,
  ImportIssue,
  InvestmentEntry,
  LedgerRecord,
  PreflightResult,
  StatementClassification,
  StatementRecord,
} from "./types.js";
import { parseCsv as parseTabularCsv } from "./tabular/csv-reader.js";
import { parseSpreadsheet } from "./tabular/spreadsheet-reader.js";
import { classifySheet } from "./tabular/sheet-classifier.js";
import { detectLayout } from "./statements/layout-detector.js";
import { parseStatement as parseStatementGeneric } from "./statements/generic-statement-parser.js";
import { ITAU_CHECKING_XLSX_V1 } from "./statements/profiles/itau-checking-xlsx-v1.js";

const PROFILES = [ITAU_CHECKING_XLSX_V1];

export type SourceFileInput = {
  id: string;
  originalName: string;
  kind: "LEDGER" | "STATEMENT";
  contentType: string;
  buffer: Buffer;
};

export type OcrPage = { page: number; text: string; confidence: string };
export type OcrProvider = (file: SourceFileInput, pages: number[]) => Promise<OcrPage[]>;

export type ParsedInputBundle = {
  preflight: PreflightResult;
  ledgers: LedgerRecord[];
  statements: StatementRecord[];
  investments: InvestmentEntry[];
};

export class StatementParseError extends Error {
  constructor(readonly code: "PDF_LAYOUT_UNSUPPORTED" | "DOCUMENT_CLASSIFICATION_AMBIGUOUS" | "PDF_PASSWORD_PROTECTED" | "PDF_OCR_UNAVAILABLE" | "PDF_INVALID", message: string) {
    super(message);
  }
}

type LedgerFileMetadata = {
  ledgerAccount: string;
  bank: string;
  agency: string;
  bankAccount: string;
};

const aliases: Record<string, string[]> = {
  COMPANY: ["EMPRESA", "COD_EMPRESA"],
  BRANCH: ["FILIAL", "COD_FILIAL", "FILIAL_DE_ORIGEM"],
  ACCOUNT: ["CONTA_CONTABIL", "CONTA", "CT2_DEBITO", "CT2_CREDIT"],
  DATE: ["DATA", "DT_LANCAMENTO", "DATA_LANCAMENTO", "DTPOSTED"],
  DOCUMENT: ["DOCUMENTO", "DOC", "NUM_DOCUMENTO", "CHECKNUM", "REFNUM"],
  HISTORY: ["HISTORICO", "DESCRICAO", "MEMO", "NAME"],
  DEBIT: ["DEBITO", "VALOR_DEBITO"],
  CREDIT: ["CREDITO", "VALOR_CREDITO"],
  VALUE: ["VALOR", "VALOR_LIQUIDO", "TRNAMT"],
  SOURCE_ID: ["IDENTIFICADOR", "ID", "ID_PROTHEUS", "LOTE_SUB_DOC_LINHA", "FITID", "ID_BANCARIO"],
};

const aliasLookup = new Map(
  Object.entries(aliases).flatMap(([canonical, names]) => names.map((name) => [name, canonical])),
);



export async function preflightFiles(
  ledgerFile: SourceFileInput,
  statementFiles: SourceFileInput[],
  ocrProvider?: OcrProvider,
  options: { maxPdfPages?: number } = {},
): Promise<ParsedInputBundle> {
  const ledgerResult = await parseLedger(ledgerFile);
  const statementResults = await Promise.all(statementFiles.map((file) => parseStatement(file, ocrProvider, options)));
  const statements = statementResults.flatMap((item) => item.records);
  const investments = statementResults.flatMap((item) => item.investments);
  const statementMetadata = statementResults.map((item) => item.metadata);
  const issues = [...ledgerResult.issues, ...statementResults.flatMap((item) => item.issues)];
  const companies = unique(ledgerResult.records.map((item) => item.company).filter(Boolean));
  const branches = unique(ledgerResult.records.map((item) => item.branch).filter(Boolean));
  if (companies.length > 1) issues.push(issue("ERROR", "MULTIPLAS_EMPRESAS", "O razão contém mais de uma empresa; envie um razão por empresa."));
  const periods = countPeriods([
    ...ledgerResult.records.map((item) => item.date),
    ...statements.map((item) => item.date),
  ]);
  const ledgerAccounts = [...groupCount(ledgerResult.records, (item) => `${item.company}|${item.branch}|${item.ledgerAccount}`).entries()].map(([key, recordCount]) => {
    const [company = "", branch = "", account = ""] = key.split("|");
    const metadata = account === ledgerResult.metadata.ledgerAccount ? ledgerResult.metadata : undefined;
    return { company, branch, account, bank: metadata?.bank ?? "", agency: metadata?.agency ?? "", bankAccount: metadata?.bankAccount ?? "", recordCount };
  });
  const preflight: PreflightResult = {
    companies,
    branches,
    detectedPeriods: [...periods.entries()].map(([period, recordCount]) => ({ period, recordCount })).sort((a, b) => a.period.localeCompare(b.period)),
    ledgerAccounts,
    statements: statementMetadata,
    investments,
    issues,
    requiresUserInput:
      companies.length !== 1 ||
      branches.length !== 1 ||
      periods.size !== 1 ||
      issues.some((item) => item.severity === "ERROR"),
  };
  return { preflight, ledgers: ledgerResult.records, statements, investments };
}

async function parseLedger(file: SourceFileInput): Promise<{ records: LedgerRecord[]; issues: ImportIssue[]; metadata: LedgerFileMetadata }> {
  const rows = await tabularRows(file);
  const issues: ImportIssue[] = [];
  const records: LedgerRecord[] = [];
  const reportAccount = rows.metadata.ledgerAccount;
  for (const row of rows.rows) {
    if (isLedgerStructureRow(row.values)) continue;
    try {
      const date = parseDate(row.values.DATE);
      const account = normalizeCode(row.values.ACCOUNT) || reportAccount;
      if (!account) throw new Error("Conta contábil ausente.");
      const company = normalizeCode(row.values.COMPANY);
      const branch = normalizeCode(row.values.BRANCH);
      let value;
      if (row.values.VALUE !== undefined && row.values.VALUE !== "") value = parseMoney(row.values.VALUE);
      else value = parseMoney(row.values.DEBIT || 0).minus(parseMoney(row.values.CREDIT || 0));
      records.push({
        id: stableId("LEDGER", file.id, row.position),
        company,
        branch,
        ledgerAccount: account,
        date,
        document: normalizeDocument(row.values.DOCUMENT),
        history: String(row.values.HISTORY ?? "").trim(),
        value: money(value),
        sourceId: normalizeCode(row.values.SOURCE_ID) || stableId("SOURCE", file.id, row.position),
        evidence: {
          fileId: file.id,
          originalName: file.originalName,
          line: row.position,
          extractionMethod: "TABULAR",
        },
      });
    } catch (error) {
      issues.push(issue("ERROR", "LINHA_RAZAO_INVALIDA", publicError(error), file.id, String(row.position)));
    }
  }
  if (records.length === 0) issues.push(issue("ERROR", "RAZAO_SEM_REGISTROS", "Nenhum lançamento válido foi encontrado no razão.", file.id));
  return { records, issues, metadata: rows.metadata };
}

function isLedgerStructureRow(values: Record<string, unknown>): boolean {
  const date = normalizeAscii(String(values.DATE ?? "")).trim().toUpperCase();
  return date === "DATA" || date === "CONTA" || /^\d+(?:\.\d+)+\.?$/.test(date) || /^CONTA\s*-/.test(date);
}

async function parseStatement(
  file: SourceFileInput,
  ocrProvider?: OcrProvider,
  options: { maxPdfPages?: number } = {},
): Promise<{ records: StatementRecord[]; metadata: DetectedStatement; issues: ImportIssue[]; investments: InvestmentEntry[] }> {
  const extension = extensionOf(file.originalName);
  if (extension === "ofx") return parseOfx(file);
  if (extension === "pdf") return parsePdf(file, ocrProvider, options.maxPdfPages);
  
  if (["csv", "xlsx", "xls", "xlsm"].includes(extension)) {
     return parseTabularStatement(file);
  }
  
  // Fallback para outros tipos de texto (se existirem, como o antigo tabularRows genérico)
  const rows = await tabularRows(file);
  const issues: ImportIssue[] = [];
  const records: StatementRecord[] = [];
  for (const row of rows.rows) {
    try {
      const date = parseDate(row.values.DATE);
      const value = parseMoney(row.values.VALUE);
      records.push(statementRecord(file, row.position, {
        date,
        document: normalizeDocument(row.values.DOCUMENT),
        history: String(row.values.HISTORY ?? "").trim(),
        value: money(value),
        sourceId: normalizeCode(row.values.SOURCE_ID),
        bank: "",
        agency: "",
        account: "",
        extractionMethod: "TABULAR",
        parser: "TABULAR_V1",
      }));
    } catch (error) {
      issues.push(issue("ERROR", "LINHA_EXTRATO_INVALIDA", publicError(error), file.id, String(row.position)));
    }
  }
  const metadata = statementMetadata(file, records, "TABULAR", "TABULAR_V1");
  return { records, metadata, issues, investments: [] };
}

async function parseTabularStatement(file: SourceFileInput): Promise<{ records: StatementRecord[]; metadata: DetectedStatement; issues: ImportIssue[]; investments: InvestmentEntry[] }> {
  const extension = extensionOf(file.originalName).toUpperCase();
  const format = extension === "CSV" ? "CSV" : (extension as "XLSX" | "XLS" | "XLSM");
  
  let doc;
  if (format === "CSV") {
    doc = parseTabularCsv({ buffer: file.buffer, fileName: file.originalName });
  } else {
    doc = parseSpreadsheet({ buffer: file.buffer, sourceFormat: format, fileName: file.originalName });
  }
  
  const issues: ImportIssue[] = [];
  const records: StatementRecord[] = [];
  
  for (const sheet of doc.sheets) {
    const classification = classifySheet(sheet);
    if (classification.role !== "TRANSACTIONAL") {
       continue;
    }
    
    const layoutMatch = detectLayout(sheet, PROFILES, format);
    if (!layoutMatch) {
       issues.push(issue("WARNING", "LAYOUT_NOT_DETECTED", `Layout não reconhecido na aba ${sheet.name}`, file.id));
       continue;
    }
    
    const profile = PROFILES.find(p => p.id === layoutMatch.profileId)!;
    const parsed = parseStatementGeneric(sheet, profile, layoutMatch.headerRowIndex, format, file.originalName);
    
    for (const tx of parsed.transactions) {
      records.push(statementRecord(file, tx.evidence.rowNumber, {
        date: tx.date,
        document: tx.document || "",
        history: tx.description,
        value: money(tx.direction === "DEBIT" ? -tx.amount : tx.amount),
        sourceId: "", // Not robust enough yet
        bank: profile.bankCode,
        agency: "", // Not extracted yet
        account: "",
        extractionMethod: "TABULAR",
        parser: profile.id
      }));
    }
  }
  
  if (records.length === 0) {
    issues.push(issue("ERROR", "TABULAR_SEM_MOVIMENTOS", "Nenhum movimento conciliável encontrado no arquivo tabular.", file.id));
  }
  
  const metadata = statementMetadata(file, records, "TABULAR", records[0]?.evidence?.parser || "GENERIC_TABULAR");
  return { records, metadata, issues, investments: [] };
}

function parseOfx(file: SourceFileInput): { records: StatementRecord[]; metadata: DetectedStatement; issues: ImportIssue[]; investments: InvestmentEntry[] } {
  const text = decodeText(file.buffer);
  const blocks = [...text.matchAll(/<STMTTRN>(.*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gis)];
  const bank = tag(text, "BANKID");
  const agency = tag(text, "BRANCHID");
  const account = tag(text, "ACCTID");
  const records: StatementRecord[] = [];
  const issues: ImportIssue[] = [];
  for (const [index, match] of blocks.entries()) {
    try {
      const block = match[1] ?? "";
      const dateRaw = tag(block, "DTPOSTED").slice(0, 8);
      records.push(statementRecord(file, index + 1, {
        date: parseDate(dateRaw),
        document: normalizeDocument(tag(block, "CHECKNUM") || tag(block, "REFNUM")),
        history: tag(block, "MEMO") || tag(block, "NAME"),
        value: money(parseMoney(tag(block, "TRNAMT"))),
        sourceId: tag(block, "FITID"),
        bank,
        agency,
        account,
        extractionMethod: "OFX",
        parser: "OFX_STMTTRN_V1",
      }));
    } catch (error) {
      issues.push(issue("ERROR", "MOVIMENTO_OFX_INVALIDO", publicError(error), file.id, String(index + 1)));
    }
  }
  if (blocks.length === 0) issues.push(issue("ERROR", "OFX_SEM_MOVIMENTOS", "O OFX não possui blocos STMTTRN.", file.id));
  return { records, metadata: statementMetadata(file, records, "OFX", "OFX_STMTTRN_V1"), issues, investments: [] };
}

type PdfPage = { page: number; text: string; confidence: string; method: ExtractionMethod };
type PdfDetails = { bank: string; agency: string; account: string; periods: string[]; finalBalance?: string };
type PdfStatementResult = { records: StatementRecord[]; investments: InvestmentEntry[]; metadata: DetectedStatement; issues: ImportIssue[] };

import { v2AdapterRegistry } from "./adapters/index.js";
import type { ExtractedStatementSource, CanonicalStatementDocument } from "./statement-sources.js";
export function statementParseErrorFromPdfOpen(error: unknown): StatementParseError {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") {
    return new StatementParseError("PDF_PASSWORD_PROTECTED", "O PDF está protegido por senha. Exporte uma cópia sem proteção antes de enviá-la.");
  }
  return new StatementParseError("PDF_INVALID", "O PDF não pôde ser lido com segurança.");
}

async function parsePdf(file: SourceFileInput, ocrProvider?: OcrProvider, maxPages?: number): Promise<PdfStatementResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let document;
  try {
    document = await pdfjs.getDocument({ data: new Uint8Array(file.buffer), useSystemFonts: true }).promise;
  } catch (error) {
    throw statementParseErrorFromPdfOpen(error);
  }
  if (maxPages && document.numPages > maxPages) throw new StatementParseError("PDF_INVALID", `O PDF excede o limite de ${maxPages} páginas.`);
  const pages: PdfPage[] = [];
  const ocrPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = groupPdfItems(content.items as Array<{ str?: string; transform?: number[] }>);
    if (isUsablePdfText(text)) pages.push({ page: pageNumber, text, confidence: "100.00", method: "TEXT" });
    else ocrPages.push(pageNumber);
  }
  if (ocrPages.length) {
    if (!ocrProvider) throw new StatementParseError("PDF_OCR_UNAVAILABLE", "Este PDF precisa de OCR, mas o OCR em português não está disponível neste ambiente.");
    try {
      for (const page of await ocrProvider(file, ocrPages)) pages.push({ ...page, method: "OCR" });
    } catch {
      throw new StatementParseError("PDF_OCR_UNAVAILABLE", "Este PDF precisa de OCR, mas o OCR em português não está disponível neste ambiente.");
    }
  }
  pages.sort((left, right) => left.page - right.page);

  let source: ExtractedStatementSource & { format: "PDF" } = {
    sourceId: file.id,
    format: "PDF",
    sha256: createHash("sha256").update(new Uint8Array(file.buffer)).digest("hex"),
    pages: pages.map(p => ({
      page: p.page,
      text: p.text,
      method: p.method === "TEXT" || p.method === "OCR" ? p.method : "TEXT"
    }))
  };

  let selection = v2AdapterRegistry.select(source);
  if (selection.status === "UNSUPPORTED") {
    const textPages = pages.filter((page) => page.method === "TEXT").map((page) => page.page);
    if (!ocrProvider || textPages.length === 0) throw new StatementParseError("PDF_LAYOUT_UNSUPPORTED", "O layout deste PDF ainda não é reconhecido com segurança.");
    let replacement: OcrPage[];
    try { replacement = await ocrProvider(file, textPages); }
    catch { throw new StatementParseError("PDF_OCR_UNAVAILABLE", "Este PDF precisa de OCR, mas o OCR em português não está disponível neste ambiente."); }
    const byPage = new Map(replacement.map((page) => [page.page, page]));
    for (const page of pages) {
      const ocr = byPage.get(page.page);
      if (ocr) Object.assign(page, { text: ocr.text, confidence: ocr.confidence, method: "OCR" as const });
    }
    source = {
      ...source,
      pages: pages.map(p => ({
        page: p.page,
        text: p.text,
        method: p.method === "TEXT" || p.method === "OCR" ? p.method : "TEXT"
      }))
    };
    selection = v2AdapterRegistry.select(source);
  }

  if (selection.status === "AMBIGUOUS") throw new StatementParseError("DOCUMENT_CLASSIFICATION_AMBIGUOUS", "O banco ou o tipo de documento não pôde ser identificado com segurança.");
  if (selection.status === "UNSUPPORTED") throw new StatementParseError("PDF_LAYOUT_UNSUPPORTED", "O layout deste PDF ainda não é reconhecido com segurança.");

  const doc = await selection.adapter.parse(source);
  return adaptCanonicalToLegacyResult(file, pages, doc);
}

function adaptCanonicalToLegacyResult(file: SourceFileInput, pages: PdfPage[], doc: CanonicalStatementDocument): PdfStatementResult {
  const method = extractionMethodOf(pages);
  const confidences = pages.map((item) => item.confidence);
  const confidence = confidences.length ? money(confidences.reduce((sum, item) => sum + Number(item), 0) / confidences.length) : undefined;

  const issues: ImportIssue[] = doc.issues.map(i => issue(i.severity, i.code, i.message, file.id));

  const records: StatementRecord[] = doc.transactions.map((tx, idx) => {
    const pageIndex = (tx.provenance as any)?.page || 1;
    const pageObj = pages.find(p => p.page === pageIndex) || pages[0]!;
    return {
      id: stableId("STATEMENT", file.id, idx + 1),
      bank: doc.identity.bankName || "",
      agency: doc.identity.agency?.normalized || "",
      bankAccount: doc.identity.account?.normalized || "",
      date: tx.postingDate,
      document: tx.documentNumber || "",
      history: tx.description,
      value: money(parseMoney(tx.amount)),
      ...(tx.runningBalance ? { runningBalance: money(parseMoney(tx.runningBalance)) } : {}),
      sourceId: stableId("SOURCE", file.id, idx + 1),
      evidence: {
        fileId: file.id,
        originalName: file.originalName,
        extractionMethod: pageObj.method,
        parser: doc.adapterId + "_V" + doc.adapterVersion,
        line: idx + 1,
        page: pageObj.page,
        sourceText: tx.description,
        confidence: pageObj.confidence,
      }
    };
  });

  const investments: InvestmentEntry[] = (doc.investments || []).map((inv, idx) => {
    const pageIndex = (inv.provenance as any)?.page || 1;
    const pageObj = pages.find(p => p.page === pageIndex) || pages[0]!;
    return {
      id: stableId("INVESTMENT", file.id, `${idx + 1}:${inv.kind}`),
      fileId: file.id,
      originalName: file.originalName,
      bank: doc.identity.bankName || "",
      agency: doc.identity.agency?.normalized || "",
      account: doc.identity.account?.normalized || "",
      ...(inv.postingDate ? { date: inv.postingDate } : {}),
      kind: inv.kind as "APPLICATION" | "REDEMPTION" | "EARNING" | "POSITION",
      amount: money(parseMoney(inv.amount)),
      description: inv.description,
      evidence: {
        fileId: file.id,
        originalName: file.originalName,
        page: pageObj.page,
        line: idx + 1,
        sourceText: inv.description,
        extractionMethod: pageObj.method,
        parser: doc.adapterId + "_V" + doc.adapterVersion,
        confidence: pageObj.confidence,
      }
    };
  });

  const periodStrings = [
    ...(doc.period?.start ? [periodOf(doc.period.start)] : []),
    ...(doc.period?.end ? [periodOf(doc.period.end)] : []),
  ];

  const balanceCheck = calculateBalanceCheck(records.map((record) => ({ amount: record.value, ...(record.runningBalance ? { runningBalance: record.runningBalance } : {}) })));

  if (doc.documentType === "CURRENT_ACCOUNT") {
    if (records.length === 0) {
      if (doc.declaresNoMovements) {
        issues.push(issue("WARNING", "EXTRATO_SEM_MOVIMENTOS", "O extrato declara explicitamente que não houve lançamentos no período.", file.id));
      } else {
        issues.push(issue("ERROR", "STATEMENT_MOVEMENTS_NOT_EXTRACTED", "O extrato não possui movimentos extraídos nem uma declaração explícita de ausência de lançamentos.", file.id));
      }
    }
    if (balanceCheck.status === "FAILED") {
      issues.push(issue("ERROR", "BALANCE_INTEGRITY_FAILED", "Os saldos acumulados extraídos não são compatíveis com os movimentos do extrato.", file.id));
    } else if (records.length && balanceCheck.status === "NOT_AVAILABLE") {
      issues.push(issue("WARNING", "BALANCE_CONTROL_NOT_AVAILABLE", "O layout não forneceu saldos acumulados suficientes para validar a completude matemática.", file.id));
    }
  } else if (doc.documentType === "INVESTMENT_POSITION") {
    issues.push(issue("WARNING", "POSICAO_INVESTIMENTO_INFORMATIVA", "O documento contém uma posição de investimento para conferência e não será conciliado lançamento a lançamento.", file.id));
  } else if (doc.documentType === "INVESTMENT_ACTIVITY") {
    issues.push(issue("WARNING", "MOVIMENTOS_INVESTIMENTO_INFORMATIVOS", "Os movimentos de investimento são informativos e não serão conciliados com o razão.", file.id));
  }

  const metadata: DetectedStatement = {
    fileId: file.id,
    originalName: file.originalName,
    bank: doc.identity.bankName || "",
    agency: doc.identity.agency?.normalized || "",
    account: doc.identity.account?.normalized || "",
    periods: unique(periodStrings),
    recordCount: records.length || investments.length,
    extractionMethod: method,
    parser: doc.adapterId + "_V" + doc.adapterVersion,
    classification: doc.documentType as StatementClassification,
    reconciliationEligible: doc.documentType === "CURRENT_ACCOUNT",
    balanceCheck,
    ...(doc.closingBalance ? { finalBalance: money(parseMoney(doc.closingBalance)) } : {}),
    ...(confidence ? { confidence } : {})
  };

  return { records, investments, metadata, issues };
}

function extractionMethodOf(pages: PdfPage[]): ExtractionMethod {
  return pages.some((item) => item.method === "OCR") && pages.some((item) => item.method === "TEXT") ? "MIXED" : pages.some((item) => item.method === "OCR") ? "OCR" : "TEXT";
}

function isZero(value: string): boolean { return parseMoney(value).isZero(); }

function isUsablePdfText(text: string): boolean {
  const meaningful = text.replace(/[^\p{L}\p{N}]/gu, "");
  const words = text.match(/\p{L}{3,}/gu) ?? [];
  const dates = text.match(/\d{2}[\/-]\d{2}/g) ?? [];
  return meaningful.length >= 40 && words.length >= 3 && dates.length >= 1;
}

async function tabularRows(file: SourceFileInput): Promise<{ rows: Array<{ position: number; values: Record<string, unknown> }>; metadata: LedgerFileMetadata }> {
  const extension = extensionOf(file.originalName);
  let rawRows: unknown[][];
  let baseLine = 1;
  const metadata: LedgerFileMetadata = { ledgerAccount: "", bank: "", agency: "", bankAccount: "" };
  if (extension === "csv") {
    const text = decodeText(file.buffer);
    const delimiter = [";", ",", "\t", "|"].sort((a, b) => (text.split(b).length - text.split(a).length))[0] ?? ";";
    rawRows = parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: true }) as unknown[][];
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    let best: { score: number; rows: unknown[][]; header: number } = { score: -1, rows: [], header: 0 };
    workbook.eachSheet((sheet) => {
      const rows = sheet.getSheetValues().slice(1).map((row) => Array.isArray(row) ? row.slice(1) : []);
      for (const [index, row] of rows.slice(0, 25).entries()) {
        const score = row.map(normalizeHeader).filter((header) => aliasLookup.has(header)).length;
        if (score > best.score) best = { score, rows, header: index };
      }
      for (const row of rows.slice(0, 100)) {
        for (const value of row) {
          const match = /\bCONTA\s*-\s*([0-9][0-9.]*)\s*-/i.exec(String(value ?? ""));
          if (match) {
            metadata.ledgerAccount = match[1]!.replace(/\D/g, "");
            const details = String(value ?? "");
            const bankMatch = /\bBANCO\s+([A-ZÀ-Ú0-9]+).*?\bAG\.?\s*([0-9]+).*?\bC\/?C\s*([0-9-]+)/i.exec(details);
            if (bankMatch) {
              metadata.bank = normalizeCode(bankMatch[1]);
              metadata.agency = normalizeCode(bankMatch[2]);
              metadata.bankAccount = normalizeCode(bankMatch[3]);
            }
          }
        }
      }
    });
    rawRows = best.rows.slice(best.header);
    baseLine = best.header + 1;
  }
  if (!rawRows.length) throw new Error("O arquivo tabular está vazio.");
  const headers = rawRows[0]!.map((value) => aliasLookup.get(normalizeHeader(value)) ?? normalizeHeader(value));
  const rows = rawRows.slice(1).map((row, index) => ({
    position: baseLine + index + 1,
    values: Object.fromEntries(headers.map((header, column) => [header, row[column]])),
  })).filter((row) => Object.values(row.values).some((value) => value !== null && value !== undefined && value !== ""));
  return { rows, metadata };
}

function statementRecord(file: SourceFileInput, position: number | string, data: {
  date: string; document: string; history: string; value: string; sourceId: string;
  bank: string; agency: string; account: string; extractionMethod: ExtractionMethod; parser: string; runningBalance?: string;
  page?: number; sourceText?: string; confidence?: string;
}): StatementRecord {
  return {
    id: stableId("STATEMENT", file.id, position), bank: data.bank, agency: data.agency,
    bankAccount: data.account, date: data.date, document: data.document, history: data.history,
    value: data.value, ...(data.runningBalance ? { runningBalance: data.runningBalance } : {}), sourceId: data.sourceId || stableId("SOURCE", file.id, position),
    evidence: {
      fileId: file.id, originalName: file.originalName, extractionMethod: data.extractionMethod,
      parser: data.parser,
      ...(typeof position === "number" ? { line: position } : {}),
      ...(data.page ? { page: data.page } : {}),
      ...(data.sourceText ? { sourceText: data.sourceText } : {}),
      ...(data.confidence ? { confidence: data.confidence } : {}),
    },
  };
}

function statementMetadata(file: SourceFileInput, records: StatementRecord[], extractionMethod: ExtractionMethod, parser: string, confidences: string[] = []): DetectedStatement {
  const first = records[0];
  const confidence = confidences.length ? money(confidences.reduce((sum, item) => sum + Number(item), 0) / confidences.length) : undefined;
  return {
    fileId: file.id, originalName: file.originalName, bank: first?.bank ?? "", agency: first?.agency ?? "",
    account: first?.bankAccount ?? "", periods: unique(records.map((item) => periodOf(item.date))),
    recordCount: records.length, extractionMethod, parser, classification: "CURRENT_ACCOUNT", reconciliationEligible: true, balanceCheck: calculateBalanceCheck(records.map((record) => ({ amount: record.value, ...(record.runningBalance ? { runningBalance: record.runningBalance } : {}) }))), ...(confidence ? { confidence } : {}),
  };
}

function groupPdfItems(items: Array<{ str?: string; transform?: number[] }>): string {
  const lines = new Map<number, string[]>();
  for (const item of items) {
    const y = Math.round(item.transform?.[5] ?? 0);
    const words = lines.get(y) ?? [];
    if (item.str?.trim()) words.push(item.str.trim());
    lines.set(y, words);
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, words]) => words.join(" ")).join("\n");
}

function inferYear(text: string): string {
  const match = /(?:20)\d{2}/.exec(text);
  return match?.[0] ?? String(new Date().getUTCFullYear());
}

function tag(text: string, name: string): string {
  return new RegExp(`<${name}>([^<\\r\\n]+)`, "i").exec(text)?.[1]?.trim() ?? "";
}

function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  return utf8.includes("�") ? buffer.toString("latin1") : utf8;
}

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function stableId(prefix: string, fileId: string, position: string | number): string {
  return `${prefix}-${createHash("sha256").update(`${fileId}|${position}`).digest("hex").slice(0, 16)}`;
}

function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function groupCount<T>(items: T[], key: (item: T) => string): Map<string, number> { const result = new Map<string, number>(); for (const item of items) result.set(key(item), (result.get(key(item)) ?? 0) + 1); return result; }
function countPeriods(dates: string[]): Map<string, number> { return groupCount(dates, periodOf); }
function issue(severity: "WARNING" | "ERROR", code: string, message: string, fileId?: string, sourcePosition?: string): ImportIssue { return { severity, code, message, ...(fileId ? { fileId } : {}), ...(sourcePosition ? { sourcePosition } : {}) }; }
function publicError(error: unknown): string { return error instanceof Error ? error.message : "O registro não pôde ser interpretado."; }
