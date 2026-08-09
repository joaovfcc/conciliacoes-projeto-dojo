import { createHash } from "node:crypto";
import { parseMoney, money, periodOf } from "../normalization.js";
import { calculateBalanceCheck } from "../balance.js";
import { issue, stableId, unique } from "./utils.js";
import { v2AdapterRegistry } from "../adapters/index.js";
import type { ExtractedStatementSource, CanonicalStatementDocument } from "../statement-sources.js";
import { StatementParseError } from "./types.js";
import type { SourceFileInput, OcrProvider, OcrPage } from "./types.js";
import type { StatementRecord, DetectedStatement, ImportIssue, InvestmentEntry, ExtractionMethod, StatementClassification } from "../types.js";

type PdfPage = { page: number; text: string; confidence: string; method: ExtractionMethod };
type PdfDetails = { bank: string; agency: string; account: string; periods: string[]; finalBalance?: string };
type PdfStatementResult = { records: StatementRecord[]; investments: InvestmentEntry[]; metadata: DetectedStatement; issues: ImportIssue[] };

export function statementParseErrorFromPdfOpen(error: unknown): StatementParseError {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") {
    return new StatementParseError("PDF_PASSWORD_PROTECTED", "O PDF está protegido por senha. Exporte uma cópia sem proteção antes de enviá-la.");
  }
  return new StatementParseError("PDF_INVALID", "O PDF não pôde ser lido com segurança.");
}

export async function parsePdf(file: SourceFileInput, ocrProvider?: OcrProvider, maxPages?: number): Promise<PdfStatementResult> {
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

function isUsablePdfText(text: string): boolean {
  const meaningful = text.replace(/[^\p{L}\p{N}]/gu, "");
  const words = text.match(/\p{L}{3,}/gu) ?? [];
  const dates = text.match(/\d{2}[\/-]\d{2}/g) ?? [];
  return meaningful.length >= 40 && words.length >= 3 && dates.length >= 1;
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
