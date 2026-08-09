import { parseDate } from "../../normalization.js";
import { positiveDecimalString, type DecimalString } from "./Decimal.js";

export interface NormalizedLedgerEntry {
  id: string;
  companyId: string;
  ledgerAccountId: string;
  importBatchId: string;
  transactionDate: string;
  amount: DecimalString;
  nature: "DEBIT" | "CREDIT";
  description: string;
  documentNumber?: string;
  source: {
    fileId: string;
    sheet?: string;
    row?: number;
    line?: number;
    extractionMethod?: string;
    rawValues: Record<string, unknown>;
  };
}

export function createNormalizedLedgerEntry(
  input: Omit<NormalizedLedgerEntry, "amount" | "transactionDate"> & {
    amount: string | number;
    transactionDate: string | Date;
  },
): NormalizedLedgerEntry {
  if (!input.companyId || !input.ledgerAccountId || !input.importBatchId) {
    throw new Error("Empresa, conta contábil e lote de importação são obrigatórios.");
  }
  if (!input.source.fileId || !Object.prototype.hasOwnProperty.call(input.source, "rawValues")) {
    throw new Error("A evidência de origem completa é obrigatória.");
  }
  return {
    ...input,
    transactionDate: parseDate(input.transactionDate),
    amount: positiveDecimalString(input.amount),
  };
}
