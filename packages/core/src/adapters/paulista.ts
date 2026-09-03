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

const BANK_CODE = "PAULISTA";
const MONEY = "-?(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}";

export const paulistaCurrentAccountAdapter = paulistaAdapter("PAULISTA_CC_DEMONSTRATIVO", "CONTA CORRENTE");
export const paulistaLinkedAccountAdapter = paulistaAdapter("PAULISTA_CONTA_VINCULADA", "CONTA VINCULADA");

function paulistaAdapter(
  adapterId: "PAULISTA_CC_DEMONSTRATIVO" | "PAULISTA_CONTA_VINCULADA",
  accountType: "CONTA CORRENTE" | "CONTA VINCULADA",
): StatementSourceAdapter<"PDF"> {
  return {
    adapterId,
    adapterVersion: "1",
    format: "PDF",
    institutionCode: BANK_CODE,
    documentType: "CURRENT_ACCOUNT",
    layoutFamily: adapterId,
    detect(source): StatementSourceDetection {
      const text = normalized(source);
      const bank = text.includes("BANCO PAULISTA");
      const layout = text.includes(accountType);
      const report = accountType === "CONTA CORRENTE"
        ? text.includes("DEMONSTRATIVO DE MOVIMENTACAO")
        : text.includes("EXTRATOS PARA CONFERENCIA");
      return {
        matched: bank && layout && report,
        score: [bank, layout, report].filter(Boolean).length * 34,
        evidenceCodes: [
          ...(bank ? ["SIGNATURE:BANCO_PAULISTA"] : []),
          ...(layout ? [`SIGNATURE:${accountType.replaceAll(" ", "_")}`] : []),
          ...(report ? ["SIGNATURE:LAYOUT"] : []),
        ],
      };
    },
    parse(source): CanonicalStatementDocument {
      const text = normalized(source);
      const transactions = transactionLines(source, adapterId);
      const period = periodOf(text, transactions);
      const openingBalance = balance(text, "SALDO DISPONIVEL INICIAL");
      const closingBalance = balance(text, "SALDO TOTAL") ?? balance(text, "SALDO DISPONIVEL FINAL");
      const agency = /(?:\b(\d{1,4})\s+AGENCIA:|AGENCIA:\s*(\d{1,4})\b)/i.exec(text);
      const account = /CONTA(?:\s+CORRENTE)?\s*:\s*([\d-]+)/i.exec(text)?.[1];
      const declaresNoMovements = transactions.length === 0 && Boolean(period && openingBalance && closingBalance);
      return {
        sourceId: source.sourceId,
        format: "PDF",
        institutionCode: BANK_CODE,
        documentType: "CURRENT_ACCOUNT",
        layoutFamily: adapterId,
        adapterId,
        adapterVersion: "1",
        identity: {
          bankName: "PAULISTA",
          ...(agency?.[1] || agency?.[2] ? { agency: identifier(agency[1] || agency[2]!) } : {}),
          ...(account ? { account: identifier(account) } : {}),
        },
        ...(period ? { period } : {}),
        transactions,
        ...(declaresNoMovements ? { declaresNoMovements: true } : {}),
        ...(openingBalance ? { openingBalance } : {}),
        ...(closingBalance ? { closingBalance } : {}),
        issues: [],
      };
    },
    validate(document): StatementSourceValidation {
      return validateCurrentAccount(document, "Banco Paulista");
    },
  };
}

function transactionLines(source: ExtractedStatementSource & { format: "PDF" }, adapterId: string): CanonicalBankTransaction[] {
  const transactions: CanonicalBankTransaction[] = [];
  const expression = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d{2}\\/\\d{2}\\/\\d{4}\\s+\\d{2}:\\d{2}:\\d{2}\\s+(.+?)\\s+(\\d{1,12})\\s+(${MONEY})\\s+([DC])$`, "i");
  for (const page of source.pages ?? []) {
    for (const line of page.text.split(/\r?\n/)) {
      const match = expression.exec(ascii(line).trim());
      if (!match) continue;
      const amount = parseMoney(`${match[5]!.toUpperCase() === "D" ? "-" : ""}${match[4]}`);
      transactions.push({
        transactionId: `${adapterId}-${transactions.length + 1}`,
        postingDate: parseDate(match[1]!),
        amount: money(amount),
        direction: amount.isNegative() ? "DEBIT" : "CREDIT",
        description: match[2]!.trim(),
        documentNumber: match[3]!,
        provenance: provenance(source, page, adapterId, transactions.length + 1),
      });
    }
  }
  return transactions.sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.transactionId.localeCompare(right.transactionId));
}

function periodOf(text: string, transactions: readonly CanonicalBankTransaction[]): { start: string; end: string } | undefined {
  const start = /DATA INICIAL\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1];
  const end = /DATA FINAL\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1];
  if (start && end) return { start: parseDate(start), end: parseDate(end) };
  if (!transactions.length) return undefined;
  const dates = transactions.map((transaction) => transaction.postingDate).sort();
  return { start: dates[0]!, end: dates.at(-1)! };
}

function balance(text: string, label: string): string | undefined {
  const token = "-?(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}";
  const after = new RegExp(`${label}[^\\d-]*(${token})`, "i").exec(text)?.[1];
  const before = new RegExp(`(${token})\\s+${label}`, "i").exec(text)?.[1];
  const value = after ?? before;
  return value ? money(parseMoney(value)) : undefined;
}

function validateCurrentAccount(document: CanonicalStatementDocument, label: string): StatementSourceValidation {
  const issues: ImportIssue[] = [...document.issues];
  if (!document.identity.agency || !document.identity.account) issues.push({ severity: "ERROR", code: "BANK_IDENTITY_MISSING", message: `Agência ou conta do ${label} não detectada.` });
  if (!document.period) issues.push({ severity: "ERROR", code: "STATEMENT_PERIOD_MISSING", message: `Período do extrato ${label} não detectado.` });
  if (!document.transactions.length && !document.declaresNoMovements) issues.push({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED", message: `Nenhum movimento do ${label} foi extraído.` });
  return { accepted: !issues.some((issue) => issue.severity === "ERROR"), issues };
}

function provenance(source: ExtractedStatementSource, page: { page: number; method: "TEXT" | "OCR" }, adapterId: string, row: number) {
  return createSourceProvenance({ sourceId: source.sourceId, format: "PDF", adapterId, adapterVersion: "1", rawHash: source.sha256, extractionMethod: page.method, page: page.page, row });
}

function identifier(value: string) { return { raw: value, normalized: value.replace(/\D/g, "") }; }
function normalized(source: ExtractedStatementSource) { return ascii((source.pages ?? []).map((page) => page.text).join("\n")).toUpperCase(); }
function ascii(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
