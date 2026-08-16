import { StatementLayoutProfile } from "../statement-types.js";

export const SANTANDER_CHECKING_XLSX_V1: StatementLayoutProfile = {
  id: "santander-checking-xlsx-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "033",
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM"],

  detection: {
    sheetNameAliases: ["santander"],
    requiredHeaderGroups: [
      ["data", "data lançamento", "dt. lançamento", "dt balancete", "data balancete"],
      ["histórico", "descrição", "lançamento"],
      ["valor", "débito", "crédito"],
    ],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "data lançamento", "dt. lançamento", "dt balancete", "data balancete"],
    description: ["histórico", "descrição", "lançamento"],
    descriptionComplement: ["razão social", "complemento"],
    document: ["documento", "doc.", "nº doc.", "cpf/cnpj"],
    amount: ["valor", "valor (r$)"],
    debit: ["débito", "debito"],
    credit: ["crédito", "credito"],
    balance: ["saldo", "saldo (r$)"],
  },

  rules: {
    headerScanRows: 50,
    negativeAmountMeansDebit: true,
    inheritDateFromPreviousRow: false,
    repeatedHeaderPolicy: "IGNORE",
    ignoreRowPatterns: ["saldo anterior", "saldo atual", "saldo final", "resumo", "subtotal", "total"],
    stopPatterns: ["não há lançamentos", "fim do extrato"],
  },
};
