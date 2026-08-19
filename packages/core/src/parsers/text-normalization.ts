import Decimal from "decimal.js";

const ACCENTS = /[\u0300-\u036f]/g;

/**
 * Universal text normalization for headers, aliases and metadata tokens:
 * - strips accents
 * - converts to lowercase
 * - replaces non-alphanumeric chars with spaces
 * - trims and collapses multiple spaces
 */
export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(ACCENTS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Normalizes header keys for standard lookup:
 * e.g., "Valor (R$)" -> "valor r"
 * e.g., "Lançamento" -> "lancamento"
 */
export function normalizeHeaderKey(value: unknown): string {
  return normalizeText(value);
}

/**
 * Removes non-digits from string while preserving leading/trailing numbers
 */
export function extractDigits(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
}

/**
 * Flexible money parser supporting:
 * - Brazilian format: "1.000,00", "1000,00"
 * - Standard decimal format: "1000.00"
 * - Negative prefixes: "-1.000,00", "- 1000,00"
 * - Accounting parentheses: "(1.000,00)", "( 1000.00 )"
 * - Trailing indicators: "1.000,00 D", "1.000,00 C", "1000.00D", "1000.00C"
 * - R$ prefix / currency symbols
 */
export function parseFlexibleMoney(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new Error(`Valor numérico inválido: ${value}`);
    }
    return new Decimal(value);
  }

  let text = String(value ?? "").trim();
  if (!text) {
    throw new Error("Valor numérico ausente.");
  }

  // Remove currency prefixes
  text = text.replace(/^R\$\s*/i, "").replace(/[\s\u00A0]+/g, " ").trim();

  let isNegative = false;
  // Check parentheses e.g. (1.000,00)
  if (text.startsWith("(") && text.endsWith(")")) {
    isNegative = true;
    text = text.slice(1, -1).trim();
  }

  // Check prefix minus
  if (text.startsWith("-")) {
    isNegative = true;
    text = text.slice(1).trim();
  }

  // Check suffix indicator D (Débito) or C (Crédito)
  if (/[dD]$/.test(text)) {
    isNegative = true;
    text = text.slice(0, -1).trim();
  } else if (/[cC]$/.test(text)) {
    text = text.slice(0, -1).trim();
  }

  // Clean remaining whitespace
  text = text.trim();
  if (!text) {
    throw new Error("Valor numérico vazio após normalização.");
  }

  // Determine decimal separator:
  // If text contains both '.' and ',', check which comes last
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");

  let sanitized: string;
  if (lastComma > -1 && lastComma > lastDot) {
    // Brazilian format: 1.234,56 -> remove dots, replace comma with dot
    sanitized = text.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1 && lastDot > lastComma) {
    // Standard format: 1,234.56 -> remove commas
    sanitized = text.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Only comma: 1234,56 -> 1234.56
    sanitized = text.replace(",", ".");
  } else {
    // Only digits or standard dot
    sanitized = text;
  }

  // Remove any remaining invalid characters except minus and dot
  sanitized = sanitized.replace(/[^0-9.-]/g, "");

  try {
    const dec = new Decimal(sanitized);
    return isNegative ? dec.abs().neg() : dec;
  } catch (error) {
    throw new Error(`Não foi possível interpretar o valor numérico "${value}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
