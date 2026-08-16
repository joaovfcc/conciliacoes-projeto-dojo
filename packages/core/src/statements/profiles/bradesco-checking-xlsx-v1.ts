import { StatementLayoutProfile } from "../statement-types.js";

export const BRADESCO_CHECKING_XLSX_V1: StatementLayoutProfile = {
  id: "bradesco-checking-xlsx-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "237",
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM"],

  detection: {
    sheetNameAliases: ["bradesco"],
    requiredHeaderGroups: [
      ["data", "dt. lançamento", "data lançamento", "dt balancete", "data balancete"],
      ["histórico", "descrição", "lançamento"],
      ["débito", "crédito", "valor"],
    ],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "dt. lançamento", "data lançamento", "dt balancete", "data balancete"],
    description: ["histórico", "descrição", "lançamento"],
    descriptionComplement: ["complemento", "razão social"],
    document: ["docto.", "docto", "documento", "doc.", "nº doc.", "cpf/cnpj"],
    amount: ["valor", "valor (r$)"],
    debit: ["débito", "debito"],
    credit: ["crédito", "credito"],
    balance: ["saldo", "saldo (r$)", "saldo disponível"],
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
