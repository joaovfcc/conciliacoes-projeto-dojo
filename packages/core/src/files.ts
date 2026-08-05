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

type PdfLayout = "BRADESCO_CURRENT" | "BRB_CURRENT" | "SANTANDER_CURRENT" | "SOFISA_CURRENT" | "ITAU_CURRENT" | "BRADESCO_INVESTMENT" | "SANTANDER_INVESTMENT" | "ITAU_INVESTMENT" | "SOFISA_POSITION";

export const registeredPdfLayoutAdapters: readonly FinancialDocumentAdapter[] = [
  pdfLayoutAdapter("BRADESCO_CURRENT", "CURRENT_ACCOUNT", ["EXTRATO MENSAL / POR PERIODO", "EXTRATO DE:"], "237"),
  pdfLayoutAdapter("BRB_CURRENT", "CURRENT_ACCOUNT", ["DADOS DA CONTA ORIGEM", "TIPO DE EXTRATO"], "070"),
  pdfLayoutAdapter("SANTANDER_CURRENT", "CURRENT_ACCOUNT", ["INTERNET BANKING EMPRESARIAL", "CONTA CORRENTE"], "033"),
  pdfLayoutAdapter("SOFISA_CURRENT", "CURRENT_ACCOUNT", ["EXTRATO 45 DIAS", "ENTRADAS/SAIDAS"]),
  pdfLayoutAdapter("ITAU_CURRENT", "CURRENT_ACCOUNT", ["EXTRATO DE CONTA CORRENTE", "SALDO RESUMIDO"], "341", ["BANCO SAFRA"]),
  pdfLayoutAdapter("BRADESCO_INVESTMENT", "INVESTMENT_ACTIVITY", ["EXTRATO DE INVESTIMENTOS", "AGENCIA/CONTA"], "237"),
  pdfLayoutAdapter("SANTANDER_INVESTMENT", "INVESTMENT_ACTIVITY", ["EXTRATO DE MOVIMENTO E POSICAO"] , "033"),
  pdfLayoutAdapter("ITAU_INVESTMENT", "INVESTMENT_ACTIVITY", ["ITAU", "APLIC AUT MAIS", "EXTRATO DETALHADO DE MOVIMENTACAO"], "341", ["BANCO SAFRA"]),
  pdfLayoutAdapter("SOFISA_POSITION", "INVESTMENT_POSITION", ["CONSULTA DE POSICAO", "RENDA FIXA"]),
];

const pdfAdapterRegistry = new FinancialDocumentAdapterRegistry(registeredPdfLayoutAdapters);
const pdfLayoutsByAdapterId: Record<string, PdfLayout> = {
  BRADESCO_CURRENT: "BRADESCO_CURRENT",
  BRB_CURRENT: "BRB_CURRENT",
  SANTANDER_CURRENT: "SANTANDER_CURRENT",
  SOFISA_CURRENT: "SOFISA_CURRENT",
  ITAU_CURRENT: "ITAU_CURRENT",
  BRADESCO_INVESTMENT: "BRADESCO_INVESTMENT",
  SANTANDER_INVESTMENT: "SANTANDER_INVESTMENT",
  ITAU_INVESTMENT: "ITAU_INVESTMENT",
  SOFISA_POSITION: "SOFISA_POSITION",
};

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
  let allText = pages.map((item) => item.text).join("\n");
  let layout;
  try {
    layout = detectPdfLayout(allText);
  } catch (error) {
    const textPages = pages.filter((page) => page.method === "TEXT").map((page) => page.page);
    if (!(error instanceof StatementParseError) || error.code !== "PDF_LAYOUT_UNSUPPORTED" || !ocrProvider || textPages.length === 0) throw error;
    let replacement: OcrPage[];
    try { replacement = await ocrProvider(file, textPages); }
    catch { throw new StatementParseError("PDF_OCR_UNAVAILABLE", "Este PDF precisa de OCR, mas o OCR em português não está disponível neste ambiente."); }
    const byPage = new Map(replacement.map((page) => [page.page, page]));
    for (const page of pages) {
      const ocr = byPage.get(page.page);
      if (ocr) Object.assign(page, { text: ocr.text, confidence: ocr.confidence, method: "OCR" as const });
    }
    allText = pages.map((item) => item.text).join("\n");
    layout = detectPdfLayout(allText);
  }
  const method = extractionMethodOf(pages);
  const confidences = pages.map((item) => item.confidence);
  switch (layout) {
    case "BRADESCO_CURRENT": return parseBradescoCurrent(file, pages, method, confidences);
    case "BRB_CURRENT": return parseBrbCurrent(file, pages, method, confidences);
    case "SANTANDER_CURRENT": return parseSantanderCurrent(file, pages, method, confidences);
    case "SOFISA_CURRENT": return parseSofisaCurrent(file, pages, method, confidences);
    case "ITAU_CURRENT": return parseItauCurrent(file, pages, method, confidences);
    case "BRADESCO_INVESTMENT": return parseBradescoInvestment(file, pages, method, confidences);
    case "SANTANDER_INVESTMENT": return parseSantanderInvestment(file, pages, method, confidences);
    case "ITAU_INVESTMENT": return parseItauInvestment(file, pages, method, confidences);
    case "SOFISA_POSITION": return parseSofisaPosition(file, pages, method, confidences);
  }
}

export function statementParseErrorFromPdfOpen(error: unknown): StatementParseError {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") {
    return new StatementParseError("PDF_PASSWORD_PROTECTED", "O PDF está protegido por senha. Exporte uma cópia sem proteção antes de enviá-la.");
  }
  return new StatementParseError("PDF_INVALID", "O PDF não pôde ser lido com segurança.");
}

function detectPdfLayout(text: string): PdfLayout {
  const selection = pdfAdapterRegistry.select({ fileId: "", originalName: "", text });
  if (selection.status === "AMBIGUOUS") throw new StatementParseError("DOCUMENT_CLASSIFICATION_AMBIGUOUS", "O banco ou o tipo de documento não pôde ser identificado com segurança.");
  if (selection.status === "UNSUPPORTED") throw new StatementParseError("PDF_LAYOUT_UNSUPPORTED", "O layout deste PDF ainda não é reconhecido com segurança.");
  const layout = pdfLayoutsByAdapterId[selection.adapter.id];
  if (!layout) throw new StatementParseError("PDF_LAYOUT_UNSUPPORTED", "O adapter selecionado não possui um parser registrado.");
  return layout;
}

function pdfLayoutAdapter(id: PdfLayout, kind: StatementClassification, signatures: string[], bankCode?: string, negativeSignatures: string[] = []): FinancialDocumentAdapter {
  const contract = {
    layoutFamily: id,
    positiveSignatures: signatures,
    negativeSignatures,
    balanceEvidenceStrategy: kind === "CURRENT_ACCOUNT" ? "RUNNING_BALANCE_WHEN_AVAILABLE" : kind === "INVESTMENT_POSITION" ? "FINAL_POSITION_ONLY" : "NOT_APPLICABLE",
  } as const;
  return {
    id,
    version: "1",
    kind,
    contract,
    detect: (input) => {
      const upper = normalizeAscii(input.text).toUpperCase();
      const positiveMatches = contract.positiveSignatures.filter((signature) => upper.includes(signature));
      const negativeMatches = contract.negativeSignatures.filter((signature) => upper.includes(signature));
      return scoredEvidence(kind, positiveMatches.length === contract.positiveSignatures.length ? 100 : positiveMatches.length * 20, positiveMatches, negativeMatches, bankCode);
    },
  };
}

function parseBradescoCurrent(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("BRADESCO", allText, /EXTRATO\s+DE:\s*AG\.?\s*:?\s*([0-9]+)\s*\|\s*CC\s*:?\s*([0-9\s-]+)/i);
  const records: StatementRecord[] = [];
  let currentDate = "";
  for (const page of pages) {
    const lines = pageLines(page.text);
    const header = lines.findIndex((line) => /DATA\s+LANCAMENTO.*CREDITO.*DEBITO.*SALDO/i.test(normalizeAscii(line)));
    if (header < 0 && !records.length) continue;
    let current: { date: string; document: string; history: string[]; value: string; runningBalance: string; line: number } | undefined;
    const pending: string[] = [];
    const flush = () => {
      if (!current) return;
      records.push(pdfRecord(file, page, current.line, {
        date: current.date,
        document: current.document,
        history: current.history.join(" "),
        value: current.value,
        runningBalance: current.runningBalance,
        bank: details.bank,
        agency: details.agency,
        account: details.account,
        parser: "BRADESCO_NET_EMPRESA_CC_V1",
      }));
      current = undefined;
    };
    for (const [lineIndex, line] of lines.entries()) {
      if (header >= 0 && lineIndex <= header) continue;
      if (/^(TOTAL\b|ULTIMOS LANCAMENTOS|SALDOS INVEST)/i.test(normalizeAscii(line))) { flush(); break; }
      if (!line || /SALDO ANTERIOR|DADOS ACIMA|EXTRATO DE:/i.test(line)) continue;
      const match = /^(?:(\d{2}\/\d{2}\/\d{4})\s+)?(?:(.*?)\s+)?(\d{5,8})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})$/.exec(line);
      if (match) {
        flush();
        currentDate = match[1] || currentDate;
        if (!currentDate) continue;
        current = { date: currentDate, document: match[3]!, history: [...pending, match[2] ?? ""].filter(Boolean), value: match[4]!, runningBalance: match[5]!, line: lineIndex + 1 };
        pending.length = 0;
      } else if (current) current.history.push(line);
      else pending.push(line);
    }
    flush();
  }
  return currentAccountResult(file, records, details, method, confidences, "BRADESCO_NET_EMPRESA_CC_V1", allText);
}

function parseBrbCurrent(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("BRB", allText, /NUMERO\s+DA\s+CONTA\s*\n?\s*([0-9.\-]+)/i);
  const records: StatementRecord[] = [];
  for (const page of pages) {
    const lines = pageLines(page.text);
    for (let index = 0; index < lines.length; index += 1) {
      const singleLine = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(\d{6,})\s+([\d.]+,\d{2})\s*([+-])\s+([\d.]+,\d{2})$/.exec(lines[index]!);
      if (singleLine) {
        const history = singleLine[2]!.trim();
        if (!/\bSALDO\b/i.test(history)) {
          records.push(pdfRecord(file, page, index + 1, {
            date: singleLine[1]!, document: singleLine[3]!, history,
            value: `${singleLine[5] === "-" ? "-" : ""}${singleLine[4]!}`,
            runningBalance: singleLine[6]!,
            bank: details.bank, agency: details.agency, account: details.account, parser: "BRB_CC_DETALHADO_V1",
          }));
        }
        continue;
      }
      const date = /^(\d{2}\/\d{2}\/\d{4})$/.exec(lines[index]!);
      if (!date) continue;
      const nextDate = lines.findIndex((line, offset) => offset > index && /^\d{2}\/\d{2}\/\d{4}$/.test(line));
      const end = nextDate < 0 ? lines.length : nextDate;
      const block = lines.slice(index + 1, end);
      const documentIndex = block.findIndex((line) => /^\d{6}$/.test(line));
      if (documentIndex < 0) continue;
      const valueIndex = block.findIndex((line, offset) => offset > documentIndex && /^[\d.]+,\d{2}$/.test(line));
      if (valueIndex < 0) continue;
      const sign = block[valueIndex + 1] === "-" ? "-" : "";
      const runningBalance = /^[-]?[\d.]+,\d{2}$/.test(block[valueIndex + 2] ?? "") ? block[valueIndex + 2] : undefined;
      const history = block.slice(0, documentIndex).filter((line) => !/^\d{4}$/.test(line)).join(" ");
      if (!history || /SALDO/i.test(history)) continue;
      records.push(pdfRecord(file, page, index + 1, {
        date: date[1]!, document: block[documentIndex]!, history, value: `${sign}${block[valueIndex]!}`,
        ...(runningBalance ? { runningBalance } : {}),
        bank: details.bank, agency: details.agency, account: details.account, parser: "BRB_CC_DETALHADO_V1",
      }));
    }
  }
  return currentAccountResult(file, records, details, method, confidences, "BRB_CC_DETALHADO_V1", allText);
}

function parseSantanderCurrent(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("SANTANDER", allText, /AGENCIA\s*:\s*([0-9]+)\s+CONTA\s*:\s*([0-9\s-]+)/i);
  const records = parseSingleLineRecords(file, pages, details, "SANTANDER_IBE_CC_V1", /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.]+,\d{2})(?:\s+-?[\d.]+,\d{2})?$/);
  return currentAccountResult(file, records, details, method, confidences, "SANTANDER_IBE_CC_V1", allText);
}

function parseSofisaCurrent(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("SOFISA", allText, /AGENCIA\s*:\s*([0-9]+)\s+CONTA\s*:\s*([0-9\s-]+)/i);
  const records: StatementRecord[] = [];
  for (const page of pages) {
    for (const [index, line] of pageLines(page.text).entries()) {
      if (/^SALDO\s+DISPONIVEL/i.test(normalizeAscii(line))) continue;
      const match = /^(\d{2}\/\d{2}\/\d{2})\s+\d+\s+(.+?)\s+(\d{5,8})\s+(-\s*)?([\d.]+,\d{2})$/.exec(line);
      if (!match) continue;
      records.push(pdfRecord(file, page, index + 1, {
        date: `${match[1]!.slice(0, 6)}20${match[1]!.slice(6)}`,
        document: match[3]!, history: match[2]!, value: `${match[4] ? "-" : ""}${match[5]!}`,
        bank: details.bank, agency: details.agency, account: details.account, parser: "SOFISA_NET_CC_V1",
      }));
    }
  }
  return currentAccountResult(file, records, details, method, confidences, "SOFISA_NET_CC_V1", allText);
}

function parseItauCurrent(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("ITAU", allText, /AG[EE]NCIA\s*:?\s*([0-9]+).*?CONTA\s*:?\s*([0-9\s-]+)/is);
  const transactionPattern = /^(\d{2}\/\d{2}(?:\/\d{4})?)\s+(.+?)\s+(-?[\d.]+,\d{2})\s*(-)?$/;
  const ignored = (line: string) => /(?:SALDO\s+(?:ANTERIOR|DO\s+DIA|FINAL|DISPONIVEL)|SDO\s+CTA\/APL)/i.test(line);
  const records = parseSingleLineRecords(file, pages, details, "ITAU_EMPRESAS_CC_V2", transactionPattern, ignored);
  const issues = pages.flatMap((page) => pageLines(page.text).flatMap((line, index) => /^\d{2}\/\d{2}\b/.test(line) && !ignored(line) && !transactionPattern.test(line) ? [issue("WARNING", "OCR_LINHA_INCOMPLETA", "Uma linha do extrato Itaú não foi usada porque o OCR não identificou um valor monetário completo.", file.id, `página ${page.page}, linha ${index + 1}`)] : []));
  const result = currentAccountResult(file, records, details, method, confidences, "ITAU_EMPRESAS_CC_V2", allText);
  return { ...result, issues: [...result.issues, ...issues] };
}

function parseBradescoInvestment(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("BRADESCO", allText, /([0-9]+)\s*\|\s*([0-9\s-]+)\s*AGENCIA\/CONTA/i);
  const investments = parseDatedInvestmentRows(file, pages, details, "BRADESCO_NET_EMPRESA_INVEST_V1", (line) => /\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}/.test(line) ? (/\s-\s/.test(line) ? "APPLICATION" : "REDEMPTION") : undefined);
  return investmentResult(file, investments, details, method, confidences, "BRADESCO_NET_EMPRESA_INVEST_V1", "INVESTMENT_ACTIVITY");
}

function parseSantanderInvestment(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("SANTANDER", allText, /AGENCIA\s*:\s*([0-9]+)\s+CONTA\s*:\s*([0-9\s-]+)/i);
  const investments: InvestmentEntry[] = [];
  for (const page of pages) for (const [index, line] of pageLines(page.text).entries()) {
    const match = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/.exec(line);
    if (!match) continue;
    const values = match[2]!.match(/-?[\d.]+,\d{2}/g) ?? [];
    if (values.length < 7) continue;
    if (!isZero(values[0]!)) investments.push(investmentEntry(file, page, index + 1, details, "APPLICATION", values[0]!, "Aplicação automática", "SANTANDER_IBE_INVEST_V1", match[1]!));
    if (!isZero(values[5]!)) investments.push(investmentEntry(file, page, index + 1, details, "REDEMPTION", values[5]!, "Resgate automático", "SANTANDER_IBE_INVEST_V1", match[1]!));
    if (!isZero(values[6]!)) investments.push(investmentEntry(file, page, index + 1, details, "EARNING", values[6]!, "Rendimento pago", "SANTANDER_IBE_INVEST_V1", match[1]!));
  }
  return investmentResult(file, investments, details, method, confidences, "SANTANDER_IBE_INVEST_V1", "INVESTMENT_ACTIVITY");
}

function parseItauInvestment(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("ITAU", allText, /(?:AG[EE]NCIA\s*:?\s*|AG[EE]NCIA\/CONTA\s*:?\s*)([0-9]+)(?:\s*-|.*?CONTA\s*:?\s*)([0-9\s-]+)/is);
  const investments = parseDatedInvestmentRows(file, pages, details, "ITAU_APLIC_AUT_MAIS_V1", (line) => /^\d{2}\/\d{2}\/\d{4}\s+R/i.test(line) || /RESG|VENC/i.test(normalizeAscii(line)) ? "REDEMPTION" : /REND|RENTAB/i.test(normalizeAscii(line)) ? "EARNING" : /^\d{2}\/\d{2}\/\d{4}\s+A/i.test(line) || /APLIC/i.test(normalizeAscii(line)) ? "APPLICATION" : undefined);
  return investmentResult(file, investments, details, method, confidences, "ITAU_APLIC_AUT_MAIS_V1", "INVESTMENT_ACTIVITY");
}

function parseSofisaPosition(file: SourceFileInput, pages: PdfPage[], method: ExtractionMethod, confidences: string[]): PdfStatementResult {
  const allText = pages.map((page) => page.text).join("\n");
  const details = bankDetails("SOFISA", allText, /AGENCIA\s*:\s*([0-9]+)\s+CONTA\s*:\s*([0-9\s-]+)/i);
  const finalBalance = /VALOR\s+LIQUIDO\s+TOTAL\s+R\$\s*([\d.]+,\d{2})/i.exec(normalizeAscii(allText))?.[1];
  const date = /(\d{2}\/\d{2}\/\d{4})/.exec(allText)?.[1];
  const investments = finalBalance ? [investmentEntry(file, pages[0]!, 1, details, "POSITION", finalBalance, "Posição líquida de renda fixa", "SOFISA_RENDA_FIXA_POSICAO_V1", date)] : [];
  return investmentResult(file, investments, { ...details, ...(finalBalance ? { finalBalance } : {}) }, method, confidences, "SOFISA_RENDA_FIXA_POSICAO_V1", "INVESTMENT_POSITION");
}

function parseSingleLineRecords(file: SourceFileInput, pages: PdfPage[], details: PdfDetails, parser: string, pattern: RegExp, shouldSkip: (line: string) => boolean = (line) => /\bSALDO\b/i.test(line)): StatementRecord[] {
  const records: StatementRecord[] = [];
  const year = inferYear(pages.map((page) => page.text).join("\n"));
  for (const page of pages) for (const [index, line] of pageLines(page.text).entries()) {
    if (shouldSkip(line)) continue;
    const match = pattern.exec(line);
    if (!match) continue;
    const rawDate = match[1]!;
    const date = rawDate.length === 5 ? `${rawDate}/${year}` : rawDate;
    const negative = match[4] === "-" || match[3]!.startsWith("-");
    const body = match[2]!.trim().split(/\s+/);
    const document = /^\d{4,8}$/.test(body.at(-1) ?? "") ? body.pop()! : "";
    records.push(pdfRecord(file, page, index + 1, {
      date, document, history: body.join(" "), value: `${negative ? "-" : ""}${match[3]!.replace(/^-/, "")}`,
      bank: details.bank, agency: details.agency, account: details.account, parser,
    }));
  }
  return records;
}

function parseDatedInvestmentRows(file: SourceFileInput, pages: PdfPage[], details: PdfDetails, parser: string, classify: (line: string) => InvestmentEntry["kind"] | undefined): InvestmentEntry[] {
  const entries: InvestmentEntry[] = [];
  for (const page of pages) for (const [index, line] of pageLines(page.text).entries()) {
    const kind = classify(line);
    const date = /^(\d{2}\/\d{2}\/\d{4})/.exec(line)?.[1];
    const values = line.match(/-?[\d.]+,\d{2}/g) ?? [];
    if (!kind || !date || !values.length) continue;
    entries.push(investmentEntry(file, page, index + 1, details, kind, values[0]!, kind === "APPLICATION" ? "Aplicação" : kind === "REDEMPTION" ? "Resgate/Vencimento" : "Rendimento", parser, date));
  }
  return entries;
}

function currentAccountResult(file: SourceFileInput, records: StatementRecord[], details: PdfDetails, method: ExtractionMethod, confidences: string[], parser: string, documentText: string): PdfStatementResult {
  const normalizedText = normalizeAscii(documentText).toUpperCase();
  const hasExplicitNoMovements = normalizedText.includes("SEM MOVIMENT") || normalizedText.includes("NAO HOUVE LANC") || normalizedText.includes("SEM TRANSAC");
  const balanceCheck = calculateBalanceCheck(records.map((record) => ({ amount: record.value, ...(record.runningBalance ? { runningBalance: record.runningBalance } : {}) })));
  const issues = records.length
    ? []
    : hasExplicitNoMovements
      ? [issue("WARNING", "EXTRATO_SEM_MOVIMENTOS", "O extrato declara explicitamente que não houve lançamentos no período.", file.id)]
      : [issue("ERROR", "STATEMENT_MOVEMENTS_NOT_EXTRACTED", "O extrato não possui movimentos extraídos nem uma declaração explícita de ausência de lançamentos.", file.id)];
  if (balanceCheck.status === "FAILED") issues.push(issue("ERROR", "BALANCE_INTEGRITY_FAILED", "Os saldos acumulados extraídos não são compatíveis com os movimentos do extrato.", file.id));
  else if (records.length && balanceCheck.status === "NOT_AVAILABLE") issues.push(issue("WARNING", "BALANCE_CONTROL_NOT_AVAILABLE", "O layout não forneceu saldos acumulados suficientes para validar a completude matemática.", file.id));
  return { records, investments: [], metadata: detectedStatement(file, details, records, method, confidences, parser, "CURRENT_ACCOUNT", true), issues };
}

function investmentResult(file: SourceFileInput, investments: InvestmentEntry[], details: PdfDetails, method: ExtractionMethod, confidences: string[], parser: string, classification: StatementClassification): PdfStatementResult {
  const message = classification === "INVESTMENT_POSITION" ? "O documento contém uma posição de investimento para conferência e não será conciliado lançamento a lançamento." : "Os movimentos de investimento são informativos e não serão conciliados com o razão.";
  const periods = unique(investments.flatMap((item) => item.date ? [periodOf(item.date)] : []));
  return { records: [], investments, metadata: detectedStatement(file, { ...details, periods: periods.length ? periods : details.periods }, [], method, confidences, parser, classification, false, investments.length), issues: [issue("WARNING", classification === "INVESTMENT_POSITION" ? "POSICAO_INVESTIMENTO_INFORMATIVA" : "MOVIMENTOS_INVESTIMENTO_INFORMATIVOS", message, file.id)] };
}

function detectedStatement(file: SourceFileInput, details: PdfDetails, records: StatementRecord[], method: ExtractionMethod, confidences: string[], parser: string, classification: StatementClassification, reconciliationEligible: boolean, recordCount = records.length): DetectedStatement {
  const confidence = confidences.length ? money(confidences.reduce((sum, item) => sum + Number(item), 0) / confidences.length) : undefined;
  const recordPeriods = unique(records.map((item) => periodOf(item.date)));
  const detailPeriods = details.periods.filter((item) => /^\d{6}$/.test(item));
  return { fileId: file.id, originalName: file.originalName, bank: details.bank, agency: details.agency, account: details.account, periods: recordPeriods.length ? recordPeriods : detailPeriods, recordCount, extractionMethod: method, parser, classification, reconciliationEligible, balanceCheck: calculateBalanceCheck(records.map((record) => ({ amount: record.value, ...(record.runningBalance ? { runningBalance: record.runningBalance } : {}) }))), ...(details.finalBalance ? { finalBalance: money(parseMoney(details.finalBalance)) } : {}), ...(confidence ? { confidence } : {}) };
}

function bankDetails(bank: string, text: string, matcher: RegExp): PdfDetails {
  const match = matcher.exec(normalizeAscii(text));
  const agency = match?.[1]?.replace(/\D/g, "") ?? "";
  const account = match?.[2]?.replace(/\s+/g, "").trim().replace(/\s+/g, "") ?? match?.[1]?.replace(/\s+/g, "") ?? "";
  return { bank, agency: matcher.source.includes("NUMERO") ? "" : agency, account, periods: periodsIn(text) };
}

function periodsIn(text: string): string[] {
  const values = [...text.matchAll(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/g)].map((match) => `${match[3]}${match[2]}`);
  return unique(values);
}

function pdfRecord(file: SourceFileInput, page: PdfPage, line: number, data: { date: string; document: string; history: string; value: string; runningBalance?: string; bank: string; agency: string; account: string; parser: string }): StatementRecord {
  return statementRecord(file, `${page.page}:${line}`, { ...data, date: parseDate(data.date), value: money(parseMoney(data.value)), ...(data.runningBalance ? { runningBalance: money(parseMoney(data.runningBalance)) } : {}), sourceId: "", extractionMethod: page.method, page: page.page, sourceText: data.history, confidence: page.confidence });
}

function investmentEntry(file: SourceFileInput, page: PdfPage, line: number, details: PdfDetails, kind: InvestmentEntry["kind"], amount: string, description: string, parser: string, date?: string): InvestmentEntry {
  return { id: stableId("INVESTMENT", file.id, `${page.page}:${line}:${kind}`), fileId: file.id, originalName: file.originalName, bank: details.bank, agency: details.agency, account: details.account, ...(date ? { date: parseDate(date) } : {}), kind, amount: money(parseMoney(amount)), description, evidence: { fileId: file.id, originalName: file.originalName, page: page.page, line, sourceText: description, extractionMethod: page.method, parser, confidence: page.confidence } };
}

function extractionMethodOf(pages: PdfPage[]): ExtractionMethod {
  return pages.some((item) => item.method === "OCR") && pages.some((item) => item.method === "TEXT") ? "MIXED" : pages.some((item) => item.method === "OCR") ? "OCR" : "TEXT";
}

function pageLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim().replace(/(?<=\d)\s+([.,])\s*(?=\d)/g, "$1").replace(/(?<=\d[.,])\s+(?=\d)/g, "")).filter(Boolean);
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
