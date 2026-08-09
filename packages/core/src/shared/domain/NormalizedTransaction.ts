import { parseDate } from "../../normalization.js";
import { positiveDecimalString, type DecimalString } from "./Decimal.js";

export interface NormalizedTransaction {
  id: string;
  companyId: string;
  accountId: string;
  importBatchId: string;
  transactionDate: string;
  postingDate?: string;
  amount: DecimalString;
  nature: "DEBIT" | "CREDIT";
  description: string;
  documentNumber?: string;
  counterpartyDocument?: string;
  balanceAfter?: DecimalString;
  source: {
    fileId: string;
    sheet?: string;
    row?: number;
    rawValues: Record<string, unknown>;
  };
  parsing: {
    layoutId: string;
    layoutVersion: number;
    confidence: number;
    warnings: string[];
  };
}

export function createNormalizedTransaction(
  input: Omit<NormalizedTransaction, "amount" | "transactionDate"> & {
    amount: string | number;
    transactionDate: string | Date;
  },
): NormalizedTransaction {
  if (!input.companyId || !input.accountId || !input.importBatchId) {
    throw new Error("Empresa, conta e lote de importação são obrigatórios.");
  }
  if (!input.source.fileId || !Object.prototype.hasOwnProperty.call(input.source, "rawValues")) {
    throw new Error("A evidência de origem completa é obrigatória.");
  }
  if (input.parsing.confidence < 0 || input.parsing.confidence > 1) {
    throw new Error("A confiança deve estar entre 0 e 1.");
  }
  return {
    ...input,
    transactionDate: parseDate(input.transactionDate),
    amount: positiveDecimalString(input.amount),
  };
}
