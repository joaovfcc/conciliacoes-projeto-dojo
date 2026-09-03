import { money, parseDate, parseMoney } from "../normalization.js";
import { createSourceProvenance, type CanonicalBankTransaction, type CanonicalStatementDocument, type ExtractedStatementSource, type StatementSourceAdapter, type StatementSourceDetection, type StatementSourceValidation } from "../statement-sources.js";
import type { ImportIssue } from "../types.js";

const BANK_CODE = "PINE";
const MONEY = "-?(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}";

export const pineCurrentAccountAdapter = pineAdapter("PINE_CC", "EXTRATO CONTA CORRENTE");
export const pineLinkedAccountAdapter = pineAdapter("PINE_CONTA_VINCULADA", "EXTRATO CONTA VINCULADA");

function pineAdapter(adapterId: "PINE_CC" | "PINE_CONTA_VINCULADA", signature: string): StatementSourceAdapter<"PDF"> {
  return {
    adapterId,
    adapterVersion: "1",
    format: "PDF",
    institutionCode: BANK_CODE,
    documentType: "CURRENT_ACCOUNT",
    layoutFamily: adapterId,
    detect(source): StatementSourceDetection {
      const text = normalized(source);
      const bank = text.includes("PINE");
      const layout = text.includes(signature);
      const columns = text.includes("DATA LANCAMENTO HISTORICO VALOR SALDO");
      return { matched: bank && layout && columns, score: [bank, layout, columns].filter(Boolean).length * 34, evidenceCodes: [...(bank ? ["SIGNATURE:PINE"] : []), ...(layout ? [`SIGNATURE:${adapterId}`] : []), ...(columns ? ["SIGNATURE:COLUMNS"] : [])] };
    },
    parse(source): CanonicalStatementDocument {
      const text = normalized(source);
      const transactions = parseTransactions(source, adapterId);
      const periodMatch = /EXTRATO\s+CONTA\s+(?:CORRENTE|VINCULADA)\s+DE\s+(\d{2}\/\d{2}\/\d{4})\s+ATE\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
      const agency = /AGENCIA\s*:\s*(\d+)/i.exec(text)?.[1];
      const account = /CONTA\s*:\s*([\d-]+)/i.exec(text)?.[1];
      const openingBalance = namedBalance(text, "SALDO ANTERIOR");
      const closingBalance = namedBalance(text, "SALDO DA CONTA");
      const declaresNoMovements = transactions.length === 0 && Boolean(periodMatch && openingBalance !== undefined && closingBalance !== undefined);
      return {
        sourceId: source.sourceId,
        format: "PDF",
        institutionCode: BANK_CODE,
        documentType: "CURRENT_ACCOUNT",
        layoutFamily: adapterId,
        adapterId,
        adapterVersion: "1",
        identity: { bankName: "PINE", ...(agency ? { agency: identity(agency) } : {}), ...(account ? { account: identity(account) } : {}) },
        ...(periodMatch ? { period: { start: parseDate(periodMatch[1]!), end: parseDate(periodMatch[2]!) } } : {}),
        transactions,
        ...(declaresNoMovements ? { declaresNoMovements: true } : {}),
        ...(openingBalance !== undefined ? { openingBalance } : {}),
        ...(closingBalance !== undefined ? { closingBalance } : {}),
        issues: [],
      };
    },
    validate(document): StatementSourceValidation {
      const issues: ImportIssue[] = [...document.issues];
      if (!document.identity.agency || !document.identity.account) issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: "Agência ou conta Pine não detectada." });
      if (!document.period) issues.push({ severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: "Período do extrato Pine não detectado." });
      if (!document.transactions.length && !document.declaresNoMovements) issues.push({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: "Nenhum movimento Pine foi extraído." });
      return { accepted: !issues.some((issue) => issue.severity === "ERROR"), issues };
    },
  };
}

function parseTransactions(source: ExtractedStatementSource & { format: "PDF" }, adapterId: string): CanonicalBankTransaction[] {
  const transactions: CanonicalBankTransaction[] = [];
  const full = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(.+?)\\s+(${MONEY})$`, "i");
  const dateAndAmount = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(${MONEY})$`, "i");
  for (const page of source.pages ?? []) {
    let pendingHistory = "";
    for (const originalLine of page.text.split(/\r?\n/)) {
      const line = ascii(originalLine).trim();
      if (!line || /^(?:SALDO|LIMITE|TOTAL DISPONIVEL|SAC:|OUVIDORIA)/i.test(line)) continue;
      const fullMatch = full.exec(line);
      if (fullMatch && !/SALDO/i.test(fullMatch[2]!)) {
        append(transactions, source, page, adapterId, fullMatch[1]!, fullMatch[2]!, fullMatch[3]!);
        pendingHistory = "";
        continue;
      }
      const dateMatch = dateAndAmount.exec(line);
      if (dateMatch && pendingHistory) {
        append(transactions, source, page, adapterId, dateMatch[1]!, pendingHistory, dateMatch[2]!);
        pendingHistory = "";
        continue;
      }
      if (!/^\d{2}\/\d{2}\/\d{4}\b/.test(line) && /^[A-Z]/i.test(line)) pendingHistory = pendingHistory ? `${pendingHistory} ${line}` : line;
    }
  }
  return transactions.sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.transactionId.localeCompare(right.transactionId));
}

function append(transactions: CanonicalBankTransaction[], source: ExtractedStatementSource, page: { page: number; method: "TEXT" | "OCR" }, adapterId: string, date: string, description: string, rawAmount: string): void {
  const amount = parseMoney(rawAmount);
  transactions.push({ transactionId: `${adapterId}-${transactions.length + 1}`, postingDate: parseDate(date), amount: money(amount), direction: amount.isNegative() ? "DEBIT" : "CREDIT", description: description.trim(), provenance: createSourceProvenance({ sourceId: source.sourceId, format: "PDF", adapterId, adapterVersion: "1", rawHash: source.sha256, extractionMethod: page.method, page: page.page, row: transactions.length + 1 }) });
}

function namedBalance(text: string, label: string): string | undefined { const match = new RegExp(`${label}\\s+(${MONEY})`, "i").exec(text); return match?.[1] ? money(parseMoney(match[1])) : undefined; }
function identity(value: string) { return { raw: value, normalized: value.replace(/\D/g, "") }; }
function normalized(source: ExtractedStatementSource) { return ascii((source.pages ?? []).map((page) => page.text).join("\n")).toUpperCase(); }
function ascii(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
