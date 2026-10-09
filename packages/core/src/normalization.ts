import Decimal from "decimal.js";
import { resolveBankInstitution } from "@conciliacao/core/bank-directory";

const accents = /[\u0300-\u036f]/g;

export type BankAccountIdentityInput = {
  bank?: string;
  agency?: string;
  account?: string;
  bankAccount?: string;
};

export type BankAccountIdentityField = "BANK" | "AGENCY" | "ACCOUNT";

export type BankAccountIdentityComparison = {
  status: "CONFIRMED" | "PARTIAL" | "CONFLICT";
  conflictingFields: BankAccountIdentityField[];
  missingFields: BankAccountIdentityField[];
};

export type BankAccountRegistrationInput = {
  bankCode?: string;
  agency?: string;
  accountNumber?: string;
  accountDigit?: string;
};

export type NormalizedBankAccountRegistration = {
  bankCode?: string;
  agency?: string;
  accountNumber?: string;
  accountDigit?: string;
};

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(accents, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function bankAccountsConflict(
  ledger: BankAccountIdentityInput,
  statement: BankAccountIdentityInput,
): boolean {
  return compareBankAccountIdentities(ledger, statement).status === "CONFLICT";
}

export function bankAccountsMatch(
  ledger: BankAccountIdentityInput,
  statement: BankAccountIdentityInput,
): boolean {
  return compareBankAccountIdentities(ledger, statement).status === "CONFIRMED";
}

export function compareBankAccountIdentities(
  ledger: BankAccountIdentityInput,
  statement: BankAccountIdentityInput,
): BankAccountIdentityComparison {
  const leftBank = normalizeBank(ledger.bank);
  const rightBank = normalizeBank(statement.bank);
  const leftAgency = parseBankAccountIdentifier(ledger.agency);
  const rightAgency = parseBankAccountIdentifier(statement.agency);
  // Ledger summaries expose the accounting code as `account` and the bank
  // account as `bankAccount`. Prefer the unambiguous bank field whenever it is
  // available so an accounting code is never compared with a statement account.
  const leftAccount = parseBankAccountIdentifier(ledger.bankAccount ?? ledger.account);
  const rightAccount = parseBankAccountIdentifier(statement.bankAccount ?? statement.account);
  const conflictingFields: BankAccountIdentityField[] = [];
  const missingFields: BankAccountIdentityField[] = [];

  compareField("BANK", leftBank, rightBank, (left, right) => left === right, conflictingFields, missingFields);
  compareField("AGENCY", leftAgency, rightAgency, accountsCompatible, conflictingFields, missingFields);
  compareField("ACCOUNT", leftAccount, rightAccount, accountsCompatible, conflictingFields, missingFields);

  return {
    status: conflictingFields.length > 0 ? "CONFLICT" : missingFields.length > 0 ? "PARTIAL" : "CONFIRMED",
    conflictingFields,
    missingFields,
  };
}

export function normalizeBankAccountRegistration(
  input: BankAccountRegistrationInput,
): NormalizedBankAccountRegistration {
  const account = parseBankAccountIdentifier(input.accountNumber);
  const explicitDigit = normalizeIdentifierPart(input.accountDigit);
  if (explicitDigit && !account?.base) throw new Error("Informe o número da conta antes do dígito.");
  if (account?.digit && explicitDigit && account.digit !== explicitDigit) {
    throw new Error("O dígito da conta diverge do número informado.");
  }
  const bankCode = normalizeBankCode(input.bankCode);
  const agencyIdentity = parseBankAccountIdentifier(input.agency);
  const agency = agencyIdentity
    ? `${agencyIdentity.base}${agencyIdentity.digit ? `-${agencyIdentity.digit}` : ""}`
    : "";
  return {
    ...(bankCode ? { bankCode } : {}),
    ...(agency ? { agency } : {}),
    ...(account?.base ? { accountNumber: account.base } : {}),
    ...(explicitDigit || account?.digit ? { accountDigit: explicitDigit || account!.digit } : {}),
  };
}

function normalizeBank(value: string | undefined): string {
  const detected = resolveBankInstitution(value);
  if (detected) return detected.canonicalName;
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function normalizeDigits(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

type ParsedBankAccountIdentifier = {
  base: string;
  digit?: string;
  compact: string;
};

function parseBankAccountIdentifier(value: string | undefined): ParsedBankAccountIdentifier | undefined {
  const raw = (value ?? "").normalize("NFKC").trim().toUpperCase();
  if (!raw) return undefined;
  const explicitDigit = /^(.+?)[-\/]([A-Z0-9])$/.exec(raw);
  if (explicitDigit) {
    const base = normalizeIdentifierPart(explicitDigit[1]);
    const digit = normalizeIdentifierPart(explicitDigit[2]);
    if (!base || !digit) return undefined;
    return { base, digit, compact: `${base}${digit}` };
  }
  const base = normalizeIdentifierPart(raw);
  return base ? { base, compact: base } : undefined;
}

function normalizeIdentifierPart(value: string | undefined): string {
  const compact = (value ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^\d+$/.test(compact) ? compact.replace(/^0+(?=\d)/, "") : compact;
}

function normalizeBankCode(value: string | undefined): string {
  const compact = normalizeIdentifierPart(value);
  return /^\d{1,3}$/.test(compact) ? compact.padStart(3, "0") : compact;
}

function compareField<T>(
  field: BankAccountIdentityField,
  left: T | undefined,
  right: T | undefined,
  matches: (left: T, right: T) => boolean,
  conflictingFields: BankAccountIdentityField[],
  missingFields: BankAccountIdentityField[],
): void {
  if (!left || !right) {
    missingFields.push(field);
    return;
  }
  if (!matches(left, right)) conflictingFields.push(field);
}

function accountsCompatible(left: ParsedBankAccountIdentifier, right: ParsedBankAccountIdentifier): boolean {
  if (left.compact === right.compact) return true;
  if (left.base === right.base) return !left.digit || !right.digit || left.digit === right.digit;
  if (left.digit && !right.digit) return right.base === `${left.base}${left.digit}`;
  if (right.digit && !left.digit) return left.base === `${right.base}${right.digit}`;
  return false;
}

export function normalizeDocumentId(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return "";

  // 1. Purely numeric sequence (e.g. "000064773" -> "64773", "0000" -> "0")
  if (/^\d+$/.test(raw)) {
    return raw.replace(/^0+(?=\d)/, "");
  }

  // 2. Text prefix + separator + leading zeros number (e.g. "DOC-000064773" -> "DOC-64773", "NF 000123" -> "NF 123")
  const prefixMatch = /^([A-Z]{2,10})([-_\s/]+)0+(\d+)$/.exec(raw);
  if (prefixMatch) {
    const [, prefix, sep, num] = prefixMatch;
    return `${prefix}${sep}${num}`;
  }

  // 3. Leading zeros number + single letter/digit suffix (e.g. "000064773-A" -> "64773-A")
  const suffixMatch = /^0+(\d+)(-[A-Z0-9])$/.exec(raw);
  if (suffixMatch) {
    const [, num, suffix] = suffixMatch;
    return `${num}${suffix}`;
  }

  // 4. Preserve alphanumeric tokens like "ABC000123", "001-002", "64773-A"
  return raw;
}

export const NON_DOCUMENT_NUMERIC_CODES = new Set([
  // Operation codes & small numbers
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
  // Common bank compensation codes
  "001", "033", "33", "104", "237", "341", "389", "422", "748", "756", "077", "77", "260", "336",
  // Common years
  "2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028", "2029", "2030",
]);

export function isDocumentIdentifier(value: string | undefined): boolean {
  if (!value) return false;
  const norm = normalizeDocumentId(value);
  if (NON_DOCUMENT_NUMERIC_CODES.has(norm)) return false;
  return /^\d+$/.test(norm) || /^[A-Z]{2,10}[-_\s/]?\d+$/i.test(norm) || /^\d+-[A-Z0-9]+$/i.test(norm);
}

/**
 * Universal document number extraction from accounting or banking descriptions.
 * Handles Brazilian banking standards (Febraban) and ERP formats (Protheus, SAP, etc.).
 */
export function extractDocumentNumber(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const raw = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

  // 1. Explicit Title/Document prefixes (accounting & banking)
  // e.g. "BAIXA TIT. - 000064833", "BXA. JUROS - 000064833", "TIT. 64833", "TITULO 64833"
  const titleMatch = /\b(?:BAIXA\s+TIT(?:ULO)?\.?|BXA\.?\s*(?:TIT(?:ULO)?\.?|JUROS|DESC|MULTA|ACRESC)?|TIT\.?|TITULO|TITULOS)\s*[-–:#/]?\s*0*([1-9]\d{2,12})\b/i.exec(raw);
  if (titleMatch && titleMatch[1] && !NON_DOCUMENT_NUMERIC_CODES.has(titleMatch[1])) {
    return titleMatch[1];
  }

  // 2. Invoice / Tax / Commercial Document prefixes
  // e.g. "NF 12345", "NF-E 00012345", "FATURA 64833", "DUPLICATA 64833", "BOLETO 64833", "CHQ 123456"
  const docMatch = /\b(?:NF[-–\s]*E?|NOTA\s+FISCAL|FATURA|FAT|DUP|DUPLICATA|CHQ|CHEQUE|BOL|BOLETO|BORDERO|BORD|DOC(?:TO)?|DOCUMENTO)\s*[-–:#/]?\s*0*([1-9]\d{2,12})\b/i.exec(raw);
  if (docMatch && docMatch[1] && !NON_DOCUMENT_NUMERIC_CODES.has(docMatch[1])) {
    return docMatch[1];
  }

  // 3. Payment / Liquidation / Electronic Banking prefixes across ALL Brazilian banks
  // e.g. "PGTO ITAU 64833", "PAGTO ELETRONICO 64833", "LIQ.TIT.OUTRO BCO 64833", "SISPAG 64833", "PAGFOR 64833", "DEB T COB 64833"
  const paymentMatch = /\b(?:PGTO|PAGTO|PAGAMENTO|LIQ\.?\s*TIT\.?|LIQUIDACAO|DEB\.?\s*T\.?\s*COB|SISPAG|PAGFOR)\b.*?\b0*([1-9]\d{3,12})\b/i.exec(raw);
  if (paymentMatch && paymentMatch[1] && !NON_DOCUMENT_NUMERIC_CODES.has(paymentMatch[1])) {
    return paymentMatch[1];
  }

  // 4. Electronic Transfer prefixes (TED, PIX, DOC)
  const transferMatch = /\b(?:TED|PIX|TRANSF)\b.*?\b0*([1-9]\d{3,12})\b/i.exec(raw);
  if (transferMatch && transferMatch[1] && !NON_DOCUMENT_NUMERIC_CODES.has(transferMatch[1])) {
    return transferMatch[1];
  }

  // 5. Fallback: Search for an isolated numeric token (4 to 10 digits) that is not a date, CNPJ, or bank code
  const tokens = raw.split(/[^A-Z0-9]+/).filter((t) => /^\d{4,10}$/.test(t));
  const candidateTokens = tokens
    .map((t) => t.replace(/^0+(?=\d)/, ""))
    .filter((t) => !NON_DOCUMENT_NUMERIC_CODES.has(t) && !isDateLikeNumber(t));

  if (candidateTokens.length === 1) {
    return candidateTokens[0];
  }

  return undefined;
}

function isDateLikeNumber(value: string): boolean {
  if (value.length === 8) {
    const yyyy1 = Number(value.slice(0, 4));
    const yyyy2 = Number(value.slice(4, 8));
    if ((yyyy1 >= 2020 && yyyy1 <= 2035) || (yyyy2 >= 2020 && yyyy2 <= 2035)) return true;
  }
  return false;
}

export function resolveTransactionDocument(
  document: string | undefined,
  history: string | undefined,
): string | undefined {
  const rawDoc = (document ?? "").trim();
  const normDoc = normalizeDocumentId(rawDoc);

  // If rawDoc is valid and not a generic code or small number, use it
  if (normDoc && !NON_DOCUMENT_NUMERIC_CODES.has(normDoc) && isDocumentIdentifier(normDoc)) {
    return normDoc;
  }

  // Otherwise, extract from description/history
  if (history) {
    const extracted = extractDocumentNumber(history);
    if (extracted) return normalizeDocumentId(extracted);
  }

  return normDoc && !NON_DOCUMENT_NUMERIC_CODES.has(normDoc) ? normDoc : undefined;
}

export function normalizeDocument(value: unknown): string {
  return normalizeDocumentId(value);
}

export function parseMoney(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") return new Decimal(String(value));
  let text = String(value ?? "").trim();
  if (!text) throw new Error("Valor monetário ausente.");
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/R\$|\s/gi, "").replace(/[CD]$/i, (marker) => {
    if (marker.toUpperCase() === "D") negative = true;
    return "";
  });
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot) text = text.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) text = text.replace(/,/g, "");
  else if (lastComma >= 0) text = text.replace(",", ".");
  text = text.replace(/[^0-9+\-.]/g, "");
  const result = new Decimal(text);
  return negative ? result.abs().negated() : result;
}

export function money(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(2).toFixed(2);
}

export function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();

  // Excel serial dates (e.g. 45292 = 2024-01-01)
  if (typeof value === "number" || (/^\d{5}(?:\.\d+)?$/.test(text) && Number(text) >= 30000 && Number(text) <= 75000)) {
    const serial = typeof value === "number" ? value : Number(text);
    const utcDays = Math.floor(serial - 25569);
    const dateObj = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(dateObj.getTime())) {
      return dateObj.toISOString().slice(0, 10);
    }
  }

  // 1. ISO format: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (isoMatch) {
    const y = isoMatch[1]!;
    const m = isoMatch[2]!.padStart(2, "0");
    const d = isoMatch[3]!.padStart(2, "0");
    return validateDate(`${y}-${m}-${d}`);
  }

  // 2. Compact YYYYMMDD
  const compactMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compactMatch) {
    return validateDate(`${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`);
  }

  // 3. Delimited dates: D/M/Y or M/D/Y with /, -, or . (1 or 2 digits day/month, 2 or 4 digits year)
  const delimitedMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (delimitedMatch) {
    const n1 = Number(delimitedMatch[1]);
    const n2 = Number(delimitedMatch[2]);
    const rawYear = delimitedMatch[3]!;
    const year = rawYear.length === 2
      ? (Number(rawYear) < 70 ? 2000 + Number(rawYear) : 1900 + Number(rawYear))
      : Number(rawYear);

    // Disambiguation between DD/MM/YYYY and MM/DD/YYYY
    if (n1 > 12 && n2 <= 12) {
      // First is day (>12), second is month (standard BR)
      const m = String(n2).padStart(2, "0");
      const d = String(n1).padStart(2, "0");
      return validateDate(`${year}-${m}-${d}`);
    } else if (n2 > 12 && n1 <= 12) {
      // First is month, second is day (>12, US style e.g. 12/31/25)
      const m = String(n1).padStart(2, "0");
      const d = String(n2).padStart(2, "0");
      return validateDate(`${year}-${m}-${d}`);
    } else {
      // Both <= 12: try standard Brazilian DD/MM/YYYY first
      const m1 = String(n2).padStart(2, "0");
      const d1 = String(n1).padStart(2, "0");
      try {
        return validateDate(`${year}-${m1}-${d1}`);
      } catch {
        // Fallback to MM/DD/YYYY if DD/MM was invalid
        const m2 = String(n1).padStart(2, "0");
        const d2 = String(n2).padStart(2, "0");
        return validateDate(`${year}-${m2}-${d2}`);
      }
    }
  }

  throw new Error(`Data inválida: ${text || "ausente"}.`);
}

function validateDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Data inválida: ${value}.`);
  }
  return value;
}

/**
 * Normaliza códigos de conta contábil removendo caracteres de máscara (pontos, traços, barras)
 * e espaços em branco para permitir comparação resiliente entre ERPs e cadastros.
 */
export function normalizeLedgerAccount(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

/**
 * Compara duas contas contábeis ignorando pontuação de máscara (ex: "1.1.1.0.2027" === "11102027").
 * Se ambos forem puramente numéricos, também tolera zeros à esquerda não significativos.
 */
export function ledgerAccountsMatch(left: unknown, right: unknown): boolean {
  const normLeft = normalizeLedgerAccount(left);
  const normRight = normalizeLedgerAccount(right);

  if (!normLeft || !normRight) return false;
  if (normLeft === normRight) return true;

  // Se forem puramente numéricos, comparar sem zeros à esquerda
  if (/^\d+$/.test(normLeft) && /^\d+$/.test(normRight)) {
    const unpaddedLeft = normLeft.replace(/^0+/, "");
    const unpaddedRight = normRight.replace(/^0+/, "");
    return (unpaddedLeft || "0") === (unpaddedRight || "0");
  }

  return false;
}

export function periodOf(value: string): string {
  return value.slice(0, 7).replace("-", "");
}

export function dayDifference(left: string, right: string): number {
  return Math.abs(
    (Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000,
  );
}
