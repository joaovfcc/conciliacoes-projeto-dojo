import { StatementLayoutProfile } from "../statement-types.js";

export const GENERIC_STATEMENT_V1: StatementLayoutProfile = {
  id: "generic-statement-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "", // We do not assume a fixed bank
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM", "CSV"],

  detection: {
    requiredHeaderGroups: [
      ["data"],
      ["histórico", "descrição", "lançamento", "detalhe", "razão social", "movimento"],
      ["valor", "crédito", "débito", "lançamento (r$)", "importância"]
    ],
    minimumScore: 70,
  },

  columns: {
    date: ["data", "dt."],
    description: ["histórico", "descrição", "lançamento", "detalhe", "razão social", "movimento"],
    document: ["documento", "ag/origem", "cpf/cnpj", "num. doc.", "nº", "nr."],
    amount: ["valor"],
    debit: ["débito"],
    credit: ["crédito"],
    balance: ["saldo"],
  },

  rules: {
    headerScanRows: 100,
    negativeAmountMeansDebit: true,
    inheritDateFromPreviousRow: true,
    repeatedHeaderPolicy: "IGNORE",
    ignoreRowPatterns: ["saldo anterior", "saldo atual", "posição consolidada", "saldo final", "resumo", "subtotal", "total"],
    stopPatterns: ["não há lançamentos", "fim do extrato"],
  },
};
