import { parseDate, parseMoney, normalizeDocument, money } from "../normalization.js";
import { issue, publicError, statementRecord, statementMetadata, extensionOf } from "./utils.js";
import { parseCsv as parseTabularCsv } from "../tabular/csv-reader.js";
import { parseSpreadsheet } from "../tabular/spreadsheet-reader.js";
import { classifySheet } from "../tabular/sheet-classifier.js";
import { detectLayoutResult } from "../statements/layout-detector.js";
import { parseStatement as parseStatementGeneric } from "../statements/generic-statement-parser.js";
import { detectLayoutWithGemini, buildDynamicStatementProfile } from "../tabular/gemini-layout-detector.js";
import type { SourceFileInput } from "./types.js";
import type { StatementRecord, DetectedStatement, ImportIssue, InvestmentEntry } from "../types.js";
import type { StatementLayoutProfile } from "../statements/statement-types.js";

export async function parseTabularStatement(
  file: SourceFileInput,
  profiles: StatementLayoutProfile[],
): Promise<{ records: StatementRecord[]; metadata: DetectedStatement; issues: ImportIssue[]; investments: InvestmentEntry[] }> {
  const extension = extensionOf(file.originalName).toUpperCase();
  const format = extension === "CSV" ? "CSV" : (extension as "XLSX" | "XLS" | "XLSM");

  let doc;
  if (format === "CSV") {
    doc = parseTabularCsv({ buffer: file.buffer, fileName: file.originalName });
  } else {
    doc = parseSpreadsheet({ buffer: file.buffer, sourceFormat: format, fileName: file.originalName });
  }

  const issues: ImportIssue[] = [];
  const records: StatementRecord[] = [];
  const balanceMovements: StatementRecord[] = [];
  let openingBalance: string | undefined;
  let closingBalance: string | undefined;
  let detectedParserId: string | undefined;
  let detectedBank: string | undefined;
  let detectedAgency: string | undefined;
  let detectedAccount: string | undefined;

  // Prefer sheets classified as TRANSACTIONAL; fall back to visible non-empty sheets if none match
  const transactionalSheets = doc.sheets.filter((sheet) => classifySheet(sheet).role === "TRANSACTIONAL");
  const sheetsToProcess = transactionalSheets.length > 0 ? transactionalSheets : doc.sheets.filter((s) => !s.hidden && s.rows.length > 0);

  for (const sheet of sheetsToProcess) {
    let profile: StatementLayoutProfile | undefined;
    let headerRowIndex = 0;

    // 1. Try local deterministic profile detection
    if (profiles.length > 0) {
      const detection = detectLayoutResult(sheet, profiles, format, file.originalName);
      if (detection.match && !detection.requiresReview) {
        profile = profiles.find((p) => p.id === detection.match!.profileId);
        headerRowIndex = detection.match.headerRowIndex;
      }
    }

    // 2. If deterministic detection didn't match with high confidence, use Gemini Layout Detective
    if (!profile) {
      try {
        const geminiResult = await detectLayoutWithGemini(sheet, "STATEMENT");
        if (geminiResult && geminiResult.confidence !== "LOW") {
          profile = buildDynamicStatementProfile(sheet, geminiResult);
          headerRowIndex = geminiResult.headerRowIndex;
        }
      } catch (err) {
        console.warn(`[parseTabularStatement] Gemini layout detection error on sheet ${sheet.name}:`, err);
      }
    }

    // 3. Last fallback: if Gemini is unavailable, try best local candidate even if requiresReview was true
    if (!profile && profiles.length > 0) {
      const fallbackDetection = detectLayoutResult(sheet, profiles, format, file.originalName);
      if (fallbackDetection.match) {
        profile = profiles.find((p) => p.id === fallbackDetection.match!.profileId);
        headerRowIndex = fallbackDetection.match.headerRowIndex;
      }
    }

    if (!profile) {
      issues.push(issue("WARNING", "LAYOUT_NOT_DETECTED", `Layout não reconhecido na aba ${sheet.name}`, file.id));
      continue;
    }

    const parsed = parseStatementGeneric(sheet, profile, headerRowIndex, format, file.originalName);

    const sheetBank = profile.bankCode || parsed.metadata?.bank || "";
    const sheetAgency = parsed.metadata?.agency || "";
    const sheetAccount = parsed.metadata?.account || "";
    if (profile.id && !detectedParserId) detectedParserId = profile.id;
    if (sheetBank && !detectedBank) detectedBank = sheetBank;
    if (sheetAgency && !detectedAgency) detectedAgency = sheetAgency;
    if (sheetAccount && !detectedAccount) detectedAccount = sheetAccount;

    if (parsed.metadata?.openingBalance !== undefined && openingBalance === undefined) {
      openingBalance = money(parsed.metadata.openingBalance);
    }
    if (parsed.metadata?.closingBalance !== undefined) {
      closingBalance = money(parsed.metadata.closingBalance);
    }

    for (const tx of parsed.transactions) {
      const record = statementRecord(file, tx.evidence.rowNumber, {
        date: tx.date,
        document: tx.document || "",
        history: tx.description,
        value: money(tx.direction === "DEBIT" ? -tx.amount : tx.amount),
        ...(tx.balance !== undefined ? { runningBalance: money(tx.balance) } : {}),
        sourceId: "",
        bank: sheetBank,
        agency: sheetAgency,
        account: sheetAccount,
        extractionMethod: "TABULAR",
        parser: profile.id,
      });
      records.push(record);
      if (
        !profile.rules.balanceExclusionPatterns?.some((pattern) =>
          new RegExp(pattern).test(normalizeForPattern(record.history)),
        )
      ) {
        balanceMovements.push(record);
      }
    }
  }

  if (records.length === 0) {
    issues.push(
      issue("WARNING", "TABULAR_SEM_MOVIMENTOS", "Nenhum movimento conciliável encontrado no arquivo tabular.", file.id),
    );
  }

  const metadata = statementMetadata(
    file,
    records,
    "TABULAR",
    records[0]?.evidence?.parser || detectedParserId || "GENERIC_TABULAR",
    [],
    {
      ...(openingBalance !== undefined ? { openingBalance } : {}),
      ...(closingBalance !== undefined ? { closingBalance } : {}),
      balanceMovements,
    },
    {
      bank: detectedBank,
      agency: detectedAgency,
      account: detectedAccount,
      reconciliationEligible: records.length > 0,
    },
  );
  return { records, metadata, issues, investments: [] };
}

function normalizeForPattern(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
