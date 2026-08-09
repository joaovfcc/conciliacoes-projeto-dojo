import { parseDate, parseMoney, normalizeCode, normalizeDocument, money } from "../normalization.js";
import { stableId, issue, publicError } from "./utils.js";
import { tabularRows, isLedgerStructureRow } from "./tabular-utils.js";
import type { SourceFileInput, LedgerFileMetadata } from "./types.js";
import type { LedgerRecord, ImportIssue } from "../types.js";

export async function parseLedger(file: SourceFileInput): Promise<{ records: LedgerRecord[]; issues: ImportIssue[]; metadata: LedgerFileMetadata }> {
  const rows = await tabularRows(file);
  const issues: ImportIssue[] = [];
  const records: LedgerRecord[] = [];
  const reportAccount = rows.metadata.ledgerAccount;
  for (const row of rows.rows) {
    if (isLedgerStructureRow(row.values)) continue;
    try {
      const date = parseDate(row.values.DATE);
      const account = normalizeCode(row.values.ACCOUNT) || reportAccount;
      if (!account) throw new Error("Conta contábil ausente.");
      const company = normalizeCode(row.values.COMPANY);
      const branch = normalizeCode(row.values.BRANCH);
      let value;
      if (row.values.VALUE !== undefined && row.values.VALUE !== "") value = parseMoney(row.values.VALUE);
      else value = parseMoney(row.values.DEBIT || 0).minus(parseMoney(row.values.CREDIT || 0));
      records.push({
        id: stableId("LEDGER", file.id, row.position),
        company,
        branch,
        ledgerAccount: account,
        date,
        document: normalizeDocument(row.values.DOCUMENT),
        history: String(row.values.HISTORY ?? "").trim(),
        value: money(value),
        sourceId: normalizeCode(row.values.SOURCE_ID) || stableId("SOURCE", file.id, row.position),
        evidence: {
          fileId: file.id,
          originalName: file.originalName,
          line: row.position,
          extractionMethod: "TABULAR",
        },
      });
    } catch (error) {
      issues.push(issue("ERROR", "LINHA_RAZAO_INVALIDA", publicError(error), file.id, String(row.position)));
    }
  }
  if (records.length === 0) issues.push(issue("ERROR", "RAZAO_SEM_REGISTROS", "Nenhum lançamento válido foi encontrado no razão.", file.id));
  return { records, issues, metadata: rows.metadata };
}
