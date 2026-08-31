import Decimal from "decimal.js";

const accents = /[\u0300-\u036f]/g;

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
  ledger: { bank?: string; agency?: string; bankAccount?: string },
  statement: { bank?: string; agency?: string; account?: string; bankAccount?: string },
): boolean {
  const comparisons = [
    [normalizeBank(ledger.bank), normalizeBank(statement.bank)],
    [normalizeDigits(ledger.agency), normalizeDigits(statement.agency)],
    [normalizeDigits(ledger.bankAccount), normalizeDigits(statement.account ?? statement.bankAccount)],
  ];
  return comparisons.some(([left, right]) => Boolean(left && right && left !== right));
}

export function bankAccountsMatch(
  ledger: { bank?: string; agency?: string; bankAccount?: string },
  statement: { bank?: string; agency?: string; account?: string; bankAccount?: string },
): boolean {
  const ledgerAccount = normalizeDigits(ledger.bankAccount);
  const statementAccount = normalizeDigits(statement.account ?? statement.bankAccount);
  return Boolean(ledgerAccount && statementAccount && ledgerAccount === statementAccount && !bankAccountsConflict(ledger, statement));
}

function normalizeBank(value: string | undefined): string {
  const normalized = (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const aliases: Record<string, string> = {
    "001": "BANCO_DO_BRASIL",
    "033": "SANTANDER",
    "070": "BRB",
    "104": "CAIXA",
    "237": "BRADESCO",
    "341": "ITAU",
  };
  if (aliases[normalized]) return aliases[normalized];
  return normalized
    .replace(/^BANCO/, "")
    .replace(/^UNIBANCO/, "ITAU")
    .replace(/^ITAUUNIBANCO/, "ITAU")
    .replace(/^BANCOSANTANDER/, "SANTANDER")
    .replace(/^BRADESCOBANK/, "BRADESCO");
}

function normalizeDigits(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
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
