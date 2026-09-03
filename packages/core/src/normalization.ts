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
  let match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (match) return validateDate(`${match[3]}-${match[2]}-${match[1]}`);
  match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (match) return validateDate(`${match[3]}-${match[2]}-${match[1]}`);
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return validateDate(text);
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return validateDate(`${match[1]}-${match[2]}-${match[3]}`);
  throw new Error(`Data inválida: ${text || "ausente"}.`);
}

function validateDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Data inválida: ${value}.`);
  }
  return value;
}

export function periodOf(value: string): string {
  return value.slice(0, 7).replace("-", "");
}

export function dayDifference(left: string, right: string): number {
  return Math.abs(
    (Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000,
  );
}
