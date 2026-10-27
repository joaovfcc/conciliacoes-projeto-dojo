import { createHash } from "node:crypto";
import { calculateBalanceCheck } from "../balance.js";
import { parseMoney, periodOf, money } from "../normalization.js";
import type { ImportIssue, StatementRecord, DetectedStatement, ExtractionMethod } from "../types.js";
import type { SourceFileInput } from "./types.js";

export function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  return utf8.includes("\ufffd") ? buffer.toString("latin1") : utf8;
}

export function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function stableId(prefix: string, fileId: string, position: string | number): string {
  return `${prefix}-${createHash("sha256").update(`${fileId}|${position}`).digest("hex").slice(0, 16)}`;
}

export function normalizeAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function unique(values: string[]): string[] { return [...new Set(values)]; }

export function groupCount<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) result.set(key(item), (result.get(key(item)) ?? 0) + 1);
  return result;
}

export function countPeriods(dates: string[]): Map<string, number> { return groupCount(dates, periodOf); }

export function issue(severity: "WARNING" | "ERROR", code: string, message: string, fileId?: string, sourcePosition?: string): ImportIssue {
  return { severity, code, message, ...(fileId ? { fileId } : {}), ...(sourcePosition ? { sourcePosition } : {}) };
}

export function publicError(error: unknown): string { return error instanceof Error ? error.message : "O registro não pôde ser interpretado."; }

export function isZero(value: string): boolean { return parseMoney(value).isZero(); }

export function tag(text: string, name: string): string {
  return new RegExp(`<${name}>([^<\\r\\n]+)`, "i").exec(text)?.[1]?.trim() ?? "";
}

export function inferYear(text: string): string {
  const match = /(?:20)\d{2}/.exec(text);
  return match?.[0] ?? String(new Date().getUTCFullYear());
}

export function statementRecord(file: SourceFileInput, position: number | string, data: {
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

export function statementMetadata(
  file: SourceFileInput,
  records: StatementRecord[],
  extractionMethod: ExtractionMethod,
  parser: string,
  confidences: string[] = [],
  controls: { openingBalance?: string; closingBalance?: string; balanceMovements?: StatementRecord[] } = {},
  overrides: { bank?: string | undefined; agency?: string | undefined; account?: string | undefined; reconciliationEligible?: boolean | undefined } = {},
): DetectedStatement {
  const first = records[0];
  const confidence = confidences.length ? money(confidences.reduce((sum, item) => sum + Number(item), 0) / confidences.length) : undefined;
  const balanceCheck = calculateBalanceCheck(
    (controls.balanceMovements ?? records).map((record) => ({
      amount: record.value,
      ...(record.runningBalance ? { runningBalance: record.runningBalance } : {}),
    })),
    "0.01",
    {
      ...(controls.openingBalance !== undefined ? { openingBalance: controls.openingBalance } : {}),
      ...(controls.closingBalance !== undefined ? { closingBalance: controls.closingBalance } : {}),
    },
  );
  const openingBalance = controls.openingBalance ?? balanceCheck.openingBalance;
  const closingBalance = controls.closingBalance ?? balanceCheck.extractedClosingBalance;
  const finalBalance = closingBalance;
  return {
    fileId: file.id, originalName: file.originalName,
    bank: overrides.bank ?? first?.bank ?? "",
    agency: overrides.agency ?? first?.agency ?? "",
    account: overrides.account ?? first?.bankAccount ?? "",
    periods: unique(records.map((item) => periodOf(item.date))),
    recordCount: records.length, extractionMethod, parser, classification: "CURRENT_ACCOUNT",
    reconciliationEligible: overrides.reconciliationEligible ?? (records.length > 0),
    ...(openingBalance !== undefined ? { openingBalance } : {}),
    ...(closingBalance !== undefined ? { closingBalance } : {}),
    ...(finalBalance !== undefined ? { finalBalance } : {}), balanceCheck, ...(confidence ? { confidence } : {}),
  };
}
