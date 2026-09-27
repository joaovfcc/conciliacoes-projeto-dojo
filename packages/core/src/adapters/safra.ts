import { money, parseDate, parseMoney } from "../normalization.js";
import {
  createSourceProvenance,
  type CanonicalBankTransaction,
  type CanonicalStatementDocument,
  type ExtractedStatementSource,
  type StatementSourceAdapter,
  type StatementSourceDetection,
  type StatementSourceValidation,
} from "../statement-sources.js";
import type { ImportIssue } from "../types.js";

const BANK_CODE = "422";
const MONEY = "-?(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}";

export const safraCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "SAFRA_CC_MOVIMENTACAO",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "SAFRA_CC_MOVIMENTACAO",
  detect(source): StatementSourceDetection {
    const text = normalized(source);
    const bank = text.includes("BANCO SAFRA");
    const title = text.includes("EXTRATO DE MOVIMENTACAO");
    const movements = text.includes("LANCAMENTOS REALIZADOS");
    return {
      matched: bank && title && movements,
      score: [bank, title, movements].filter(Boolean).length * 34,
      evidenceCodes: [
        ...(bank ? ["SIGNATURE:BANCO_SAFRA"] : []),
        ...(title ? ["SIGNATURE:EXTRATO_MOVIMENTACAO"] : []),
        ...(movements ? ["SIGNATURE:LANCAMENTOS_REALIZADOS"] : []),
      ],
    };
  },
  parse(source): CanonicalStatementDocument {
    const text = normalized(source);
    const period = /PERIODO\s+DE\s+(\d{2}\/\d{2}\/\d{4})\s+A\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
    const identityMatch = /AG\s*:\s*(\d+)\s*\|\s*CONTA\s*:\s*([\d-]+)/i.exec(text);
    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "SAFRA_CC_MOVIMENTACAO",
      adapterId: "SAFRA_CC_MOVIMENTACAO",
      adapterVersion: "1",
      identity: {
        bankCode: BANK_CODE,
        bankName: "SAFRA",
        ...(identityMatch?.[1] ? { agency: identifier(identityMatch[1]) } : {}),
        ...(identityMatch?.[2] ? { account: identifier(identityMatch[2]) } : {}),
      },
      ...(period ? { period: { start: parseDate(period[1]!), end: parseDate(period[2]!) } } : {}),
      transactions: parseTransactions(source, period?.[2]?.slice(-4)),
      issues: [],
    };
  },
  validate(document): StatementSourceValidation {
    const issues: ImportIssue[] = [...document.issues];
    if (!document.identity.agency || !document.identity.account) {
      issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta Safra não detectada." });
    }
    if (!document.period) issues.push({ severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato Safra não detectado." });
    if (!document.transactions.length) {
      issues.push({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento Safra foi extraído." });
    }
    return { accepted: !issues.some((issue) => issue.severity === "ERROR"), issues };
  },
};

function parseTransactions(source: ExtractedStatementSource & { format: "PDF" }, year = ""): CanonicalBankTransaction[] {
  const transactions: CanonicalBankTransaction[] = [];
  for (const page of source.pages ?? []) {
    for (const segment of datedSegments(page.text)) {
      const parsed = parseSegment(segment);
      if (!parsed || /^SALDO\b/i.test(parsed.description)) continue;
      const amount = parseMoney(parsed.amount);
      transactions.push({
        transactionId: `SAFRA_CC_MOVIMENTACAO-${transactions.length + 1}`,
        postingDate: parseDate(`${parsed.date}/${year}`),
        amount: money(amount),
        direction: amount.isNegative() ? "DEBIT" : "CREDIT",
        description: parsed.description,
        ...(parsed.documentNumber ? { documentNumber: parsed.documentNumber } : {}),
        provenance: createSourceProvenance({
          sourceId: source.sourceId,
          format: "PDF",
          adapterId: "SAFRA_CC_MOVIMENTACAO",
          adapterVersion: "1",
          rawHash: source.sha256,
          extractionMethod: page.method,
          page: page.page,
          row: transactions.length + 1,
        }),
      });
    }
  }
  return transactions;
}

function datedSegments(pageText: string): string[] {
  const segments: string[] = [];
  let current: string[] | undefined;
  for (const rawLine of pageText.split(/\r?\n/)) {
    const line = ascii(rawLine).replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/^\d{2}\/\d{2}(?:\s|$)/.test(line)) {
      if (current) segments.push(current.join(" "));
      current = [line];
    } else if (current && !isPageFurniture(line)) {
      current.push(line);
    }
  }
  if (current) segments.push(current.join(" "));
  return segments;
}

function parseSegment(segment: string): { date: string; description: string; documentNumber?: string; amount: string } | undefined {
  const match = new RegExp(`^(\\d{2}\\/\\d{2})\\s+(.+?)\\s+(${MONEY})$`).exec(segment);
  if (!match) return undefined;
  const beforeAmount = match[2]!.trim();
  const document = /(?:^|\s)(\d{5,})(?:\s|$)/g;
  let documentNumber: string | undefined;
  let candidate: RegExpExecArray | null;
  while ((candidate = document.exec(beforeAmount)) !== null) documentNumber = candidate[1];
  const description = documentNumber ? beforeAmount.replace(new RegExp(`\\s${documentNumber}(?=\\s|$)`), "").trim() : beforeAmount;
  return { date: match[1]!, description, ...(documentNumber ? { documentNumber } : {}), amount: match[3]! };
}

function isPageFurniture(line: string): boolean {
  return /^(BANCO SAFRA|CNPJ:|PAGINA\s+\d+\s+DE\s+\d+|CENTRAL DE|0800 |0300 |\(11\))/.test(line);
}

function identifier(value: string) { return { raw: value, normalized: value.replace(/\D/g, "") }; }
function normalized(source: ExtractedStatementSource) { return ascii((source.pages ?? []).map((page) => page.text).join("\n")).toUpperCase(); }
function ascii(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
