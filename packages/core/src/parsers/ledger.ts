import { parseDate, parseMoney, normalizeCode, normalizeDocument, money } from "../normalization.js";
import { calculateBalanceCheck } from "../balance.js";
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
      const runningBalance = row.values.BALANCE === undefined || row.values.BALANCE === ""
        ? undefined
        : money(parseMoney(row.values.BALANCE));
      records.push({
        id: stableId("LEDGER", file.id, row.position),
        company,
        branch,
        ledgerAccount: account,
        date,
        document: normalizeDocument(row.values.DOCUMENT),
        history: String(row.values.HISTORY ?? "").trim(),
        value: money(value),
        ...(runningBalance !== undefined ? { runningBalance } : {}),
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
  const balanceCheck = calculateBalanceCheck(
    records.map((record) => ({ amount: record.value, ...(record.runningBalance !== undefined ? { runningBalance: record.runningBalance } : {}) })),
    "0.01",
    { movementEffect: "SUBTRACTS_FROM_BALANCE" },
  );
  rows.metadata.balanceMovementEffect = "SUBTRACTS_FROM_BALANCE";
  rows.metadata.balanceCheck = balanceCheck;
  if (balanceCheck.openingBalance !== undefined) rows.metadata.openingBalance = balanceCheck.openingBalance;
  if (balanceCheck.extractedClosingBalance !== undefined) rows.metadata.closingBalance = balanceCheck.extractedClosingBalance;
  return { records, issues, metadata: rows.metadata };
}
