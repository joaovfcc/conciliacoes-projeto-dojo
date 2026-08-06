import { StatementLayoutProfile } from "../statement-types.js";

export const ITAU_CHECKING_XLSX_V1: StatementLayoutProfile = {
  id: "itau-checking-xlsx-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "341",
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM"],

  detection: {
    sheetNameAliases: ["lançamentos"],
    requiredHeaderGroups: [
      ["data", "data de lançamento"],
      ["lançamento", "histórico", "descrição"],
      ["valor (r$)", "valor"]
    ],
    negativeSheetNames: ["lançamentos futuros"],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "data de lançamento"],
    description: ["lançamento", "histórico", "descrição"],
    document: ["documento", "ag/origem", "cpf/cnpj"],
    amount: ["valor (r$)", "valor"],
    balance: ["saldo (r$)", "saldo"],
  },

  rules: {
    headerScanRows: 50,
    negativeAmountMeansDebit: true,
    inheritDateFromPreviousRow: false,
    repeatedHeaderPolicy: "IGNORE",
    ignoreRowPatterns: ["saldo anterior", "saldo atual", "posição consolidada", "saldo final", "resumo"],
    stopPatterns: ["não há lançamentos", "fim do extrato"],
  },
};
