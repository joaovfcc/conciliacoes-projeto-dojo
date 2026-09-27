import { normalizeText, extractDigits } from "./text-normalization.js";
import { normalizeCode } from "../normalization.js";
import { resolveBankInstitution } from "../bank-directory.js";

export interface BankMetadataCandidate {
  bank?: string;
  bankCode?: string;
  agency?: string;
  account?: string;
  confidence: number;
  evidence: string[];
}

/**
 * Words that must NEVER be accepted as account or agency numbers
 */
const FORBIDDEN_ACCOUNT_WORDS = new Set([
  "corrente",
  "extrato",
  "consultar",
  "consulta",
  "saldo",
  "conta",
  "resumo",
  "movimento",
  "movimentacao",
  "investimento",
  "investimentos",
  "poupanca",
  "aplicacao",
  "disponivel",
  "bloqueado",
  "periodo",
  "empresa",
  "data",
  "banco",
  "agencia",
  "analitico",
  "sintetico",
  "normal",
  "sim",
  "nao",
]);

/**
 * Validates whether a captured account token is valid (must start with digit and not be a forbidden word)
 */
export function isValidAccountNumber(raw: string | undefined): boolean {
  if (!raw) return false;
  const clean = raw.trim().toLowerCase();
  if (FORBIDDEN_ACCOUNT_WORDS.has(clean)) return false;
  // Must contain at least one digit and start with a digit (or digit formatted like 13000243-9)
  return /^[0-9][0-9A-Z.-]*$/.test(raw.trim()) && /[0-9]/.test(raw);
}

/**
 * Validates whether a captured agency token is valid
 */
export function isValidAgencyNumber(raw: string | undefined): boolean {
  if (!raw) return false;
  const clean = raw.trim().toLowerCase();
  if (FORBIDDEN_ACCOUNT_WORDS.has(clean)) return false;
  return /^[0-9][0-9A-Z.-]*$/.test(raw.trim()) && /[0-9]/.test(raw);
}

/**
 * Identifies a known bank from text tokens
 */
export function detectBankFromText(text: string): { bank?: string; bankCode?: string } | undefined {
  const institution = resolveBankInstitution(text);
  if (!institution) return undefined;
  return {
    bank: institution.canonicalName,
    ...(institution.bankCode ? { bankCode: institution.bankCode } : {}),
  };
}

/**
 * Extracts bank metadata candidates from structured rows or text lines
 */
export function extractBankMetadataFromLines(lines: string[]): BankMetadataCandidate {
  let detectedBank: string | undefined;
  let detectedBankCode: string | undefined;
  let detectedAgency: string | undefined;
  let detectedAccount: string | undefined;
  const evidence: string[] = [];
  let score = 0;

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const trimmed = line.trim();

    // 1. Detect Bank
    if (!detectedBank) {
      const bankResult = detectBankFromText(trimmed);
      if (bankResult) {
        detectedBank = bankResult.bank;
        detectedBankCode = bankResult.bankCode;
        score += 30;
        evidence.push(`Banco identificado: ${detectedBank} em "${trimmed.slice(0, 80)}"`);
      }
    }

    // 2. Comprehensive unified pattern (e.g., BANCO SANTANDER AG. 3377 C/C. 130002439 or BANCO ITAU AG. 191 C/C26775-6)
    const unifiedPattern = /(?:BANCO\s+([A-ZÀ-Ú0-9]+))?.*?(?:AG\.?|AG[EÊ]NCIA:?)\s*([0-9A-Z-]+).*?(?:C\/?C\.?|CONTA(?:\s*CORRENTE)?\.?|CC\.?)\s*([0-9][0-9A-Z.-]*)/i;
    const unifiedMatch = unifiedPattern.exec(trimmed);
    if (unifiedMatch) {
      const [, matchedBank, matchedAgency, matchedAccount] = unifiedMatch;
      if (matchedBank && !detectedBank) {
        const bankResult = detectBankFromText(matchedBank);
        if (bankResult) {
          detectedBank = bankResult.bank;
          detectedBankCode = bankResult.bankCode;
        } else {
          detectedBank = normalizeCode(matchedBank);
        }
        score += 30;
      }
      if (matchedAgency && isValidAgencyNumber(matchedAgency) && !detectedAgency) {
        detectedAgency = normalizeCode(matchedAgency.replace(/\D/g, ""));
        score += 25;
        evidence.push(`Agência identificada (padrão unificado): ${detectedAgency}`);
      }
      if (matchedAccount && isValidAccountNumber(matchedAccount) && !detectedAccount) {
        detectedAccount = normalizeCode(matchedAccount.replace(/[^0-9A-Z-]/gi, ""));
        score += 35;
        evidence.push(`Conta identificada (padrão unificado): ${detectedAccount}`);
      }
    }

    // 3. Isolated Agency Pattern
    if (!detectedAgency) {
      const agencyPattern = /(?:AG[EÊ]NCIA|AG\.?|AG)\s*[:#.]?\s*([0-9A-Z-]+)/i;
      const agencyMatch = agencyPattern.exec(trimmed);
      if (agencyMatch?.[1] && isValidAgencyNumber(agencyMatch[1])) {
        detectedAgency = normalizeCode(agencyMatch[1].replace(/\D/g, ""));
        score += 25;
        evidence.push(`Agência identificada: ${detectedAgency} em "${trimmed.slice(0, 80)}"`);
      }
    }

    // 4. Isolated Account Pattern (ensuring it starts with digit and isn't forbidden word)
    if (!detectedAccount) {
      const accountPattern = /(?:CONTA(?:\s*CORRENTE)?|C\/?C\.?|CC)\s*[:#.]?\s*([0-9][0-9A-Z.-]*)/i;
      const accountMatch = accountPattern.exec(trimmed);
      if (accountMatch?.[1] && isValidAccountNumber(accountMatch[1])) {
        detectedAccount = normalizeCode(accountMatch[1].replace(/[^0-9A-Z-]/gi, ""));
        score += 35;
        evidence.push(`Conta identificada: ${detectedAccount} em "${trimmed.slice(0, 80)}"`);
      }
    }
  }

  const confidence = Math.min(100, score);
  return {
    ...(detectedBank ? { bank: detectedBank } : {}),
    ...(detectedBankCode ? { bankCode: detectedBankCode } : {}),
    ...(detectedAgency ? { agency: detectedAgency } : {}),
    ...(detectedAccount ? { account: detectedAccount } : {}),
    confidence,
    evidence,
  };
}

/**
 * Extracts bank metadata from a 2D matrix of cells (such as header rows of a spreadsheet)
 */
export function extractBankMetadataFromGrid(rows: Array<Array<{ displayValue: string }>>): BankMetadataCandidate {
  const textLines: string[] = [];

  // Pass 1: Stringify rows
  for (const row of rows) {
    const line = row.map((cell) => cell.displayValue).filter(Boolean).join(" ");
    if (line) textLines.push(line);

    // Pass 1b: Search adjacent key-value pairs e.g. [col 0: "Agência", col 1: "3377"]
    for (let c = 0; c < row.length - 1; c++) {
      const label = normalizeText(row[c]?.displayValue);
      const nextVal = row[c + 1]?.displayValue?.trim() ?? "";

      if ((label === "agencia" || label === "ag") && isValidAgencyNumber(nextVal)) {
        textLines.push(`Agência: ${nextVal}`);
      }
      if ((label === "conta" || label === "conta corrente" || label === "c c" || label === "cc") && isValidAccountNumber(nextVal)) {
        textLines.push(`Conta: ${nextVal}`);
      }
      if ((label === "banco") && nextVal) {
        textLines.push(`Banco: ${nextVal}`);
      }
    }
  }

  return extractBankMetadataFromLines(textLines);
}
