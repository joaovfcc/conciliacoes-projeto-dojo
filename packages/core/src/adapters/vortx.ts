import { money, parseDate, parseMoney } from "../normalization.js";
import { createSourceProvenance, type CanonicalBankTransaction, type CanonicalStatementDocument, type ExtractedStatementSource, type StatementSourceAdapter, type StatementSourceDetection, type StatementSourceValidation } from "../statement-sources.js";
import type { ImportIssue } from "../types.js";

const BANK_CODE = "310";
const MONEY = "-?R\\$\\s*(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}";

export const vortxCurrentAccountAdapter: StatementSourceAdapter<"PDF"> = {
  adapterId: "VORTX_CC",
  adapterVersion: "1",
  format: "PDF",
  institutionCode: BANK_CODE,
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "VORTX_CC",
  detect(source): StatementSourceDetection {
    const text = normalized(source);
    const detailed = text.includes("EXTRATO DETALHADO");
    const columns = text.includes("DATA LANCAMENTO NOME BANCO AGENCIA CONTA VALOR");
    const identity = /\b310\s+\d+\s+[\d-]+/.test(text);
    return { matched: detailed && columns && identity, score: [detailed, columns, identity].filter(Boolean).length * 34, evidenceCodes: [...(detailed ? ["SIGNATURE:EXTRATO_DETALHADO"] : []), ...(columns ? ["SIGNATURE:COLUMNS"] : []), ...(identity ? ["SIGNATURE:BANK_310"] : [])] };
  },
  parse(source): CanonicalStatementDocument {
    const text = normalized(source);
    const transactions = parseTransactions(source);
    const identityMatch = /\b310\s+(\d+)\s+([\d-]+)/.exec(text);
    const period = /PERIODO\s*:\s*(\d{2}\/\d{2}\/\d{4})\s+A\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
    const openingBalance = /SALDO INICIAL\s+R\$\s*([\d.]+,\d{2})/i.exec(text)?.[1];
    const closingBalance = /SALDO FINAL\s+R\$\s*([\d.]+,\d{2})/i.exec(text)?.[1];
    return {
      sourceId: source.sourceId,
      format: "PDF",
      institutionCode: BANK_CODE,
      documentType: "CURRENT_ACCOUNT",
      layoutFamily: "VORTX_CC",
      adapterId: "VORTX_CC",
      adapterVersion: "1",
      identity: { bankCode: BANK_CODE, bankName: "VORTX", ...(identityMatch?.[1] ? { agency: identity(identityMatch[1]) } : {}), ...(identityMatch?.[2] ? { account: identity(identityMatch[2]) } : {}) },
      ...(period ? { period: { start: parseDate(period[1]!), end: parseDate(period[2]!) } } : {}),
      transactions,
      ...(openingBalance ? { openingBalance: money(parseMoney(openingBalance)) } : {}),
      ...(closingBalance ? { closingBalance: money(parseMoney(closingBalance)) } : {}),
      issues: [],
    };
  },
  validate(document): StatementSourceValidation {
    const issues: ImportIssue[] = [...document.issues];
    if (!document.identity.agency || !document.identity.account) issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta Vórtx não detectada." });
    if (!document.period) issues.push({ severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato Vórtx não detectado." });
    if (!document.transactions.length) issues.push({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento Vórtx foi extraído." });
    return { accepted: !issues.some((issue) => issue.severity === "ERROR"), issues };
  },
};

function parseTransactions(source: ExtractedStatementSource & { format: "PDF" }): CanonicalBankTransaction[] {
  const transactions: CanonicalBankTransaction[] = [];
  const expression = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d{2}:\\d{2}\\s+(.+?)\\s+(${MONEY})\\s+R\\$\\s*[\\d.]+,\\d{2}$`, "i");
  for (const page of source.pages ?? []) {
    for (const originalLine of page.text.split(/\r?\n/)) {
      const match = expression.exec(ascii(originalLine).trim());
      if (!match) continue;
      const amount = parseMoney(match[3]!);
      transactions.push({
        transactionId: `VORTX_CC-${transactions.length + 1}`,
        postingDate: parseDate(match[1]!),
        amount: money(amount),
        direction: amount.isNegative() ? "DEBIT" : "CREDIT",
        description: match[2]!.trim(),
        provenance: createSourceProvenance({ sourceId: source.sourceId, format: "PDF", adapterId: "VORTX_CC", adapterVersion: "1", rawHash: source.sha256, extractionMethod: page.method, page: page.page, row: transactions.length + 1 }),
      });
    }
  }
  return transactions.sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.transactionId.localeCompare(right.transactionId));
}

function identity(value: string) { return { raw: value, normalized: value.replace(/\D/g, "") }; }
function normalized(source: ExtractedStatementSource) { return ascii((source.pages ?? []).map((page) => page.text).join("\n")).toUpperCase(); }
function ascii(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
