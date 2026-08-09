import { parseDate, parseMoney, normalizeDocument, money } from "../normalization.js";
import { tag, issue, publicError, statementRecord, statementMetadata, decodeText } from "./utils.js";
import type { SourceFileInput } from "./types.js";
import type { StatementRecord, DetectedStatement, ImportIssue, InvestmentEntry } from "../types.js";

export function parseOfx(file: SourceFileInput): { records: StatementRecord[]; metadata: DetectedStatement; issues: ImportIssue[]; investments: InvestmentEntry[] } {
  const text = decodeText(file.buffer);
  const blocks = [...text.matchAll(/<STMTTRN>(.*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gis)];
  const bank = tag(text, "BANKID");
  const agency = tag(text, "BRANCHID");
  const account = tag(text, "ACCTID");
  const records: StatementRecord[] = [];
  const issues: ImportIssue[] = [];
  for (const [index, match] of blocks.entries()) {
    try {
      const block = match[1] ?? "";
      const dateRaw = tag(block, "DTPOSTED").slice(0, 8);
      records.push(statementRecord(file, index + 1, {
        date: parseDate(dateRaw),
        document: normalizeDocument(tag(block, "CHECKNUM") || tag(block, "REFNUM")),
        history: tag(block, "MEMO") || tag(block, "NAME"),
        value: money(parseMoney(tag(block, "TRNAMT"))),
        sourceId: tag(block, "FITID"),
        bank,
        agency,
        account,
        extractionMethod: "OFX",
        parser: "OFX_STMTTRN_V1",
      }));
    } catch (error) {
      issues.push(issue("ERROR", "MOVIMENTO_OFX_INVALIDO", publicError(error), file.id, String(index + 1)));
    }
  }
  if (blocks.length === 0) issues.push(issue("ERROR", "OFX_SEM_MOVIMENTOS", "O OFX não possui blocos STMTTRN.", file.id));
  return { records, metadata: statementMetadata(file, records, "OFX", "OFX_STMTTRN_V1"), issues, investments: [] };
}
