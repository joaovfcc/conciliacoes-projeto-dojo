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
    institutionPatterns: ["itaú", "itau"],
    requiredHeaderGroups: [
      ["data", "data de lançamento"],
      ["lançamento", "histórico", "descrição", "razão social"],
      ["valor (r$)", "valor"]
    ],
    negativeSheetNames: ["lançamentos futuros"],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "data de lançamento"],
    description: ["lançamento", "histórico", "descrição"],
    descriptionComplement: ["razão social"],
    document: ["documento", "cpf/cnpj", "ag/origem"],
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
    openingBalancePatterns: ["saldo anterior"],
    closingBalancePatterns: ["saldo total", "saldo final"],
    balanceExclusionPatterns: ["^(APL|RES) APLIC AUT"],
  },
};
