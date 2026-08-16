import { StatementLayoutProfile } from "../statement-types.js";

export const CAIXA_CHECKING_XLSX_V1: StatementLayoutProfile = {
  id: "caixa-checking-xlsx-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "104",
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM"],

  detection: {
    sheetNameAliases: ["caixa"],
    requiredHeaderGroups: [
      ["data", "data mov.", "data movimento", "dt movto", "dt balancete", "data balancete"],
      ["histórico", "descrição", "lançamento", "discriminação"],
      ["valor", "débito", "crédito"],
    ],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "data mov.", "data movimento", "dt movto", "dt balancete", "data balancete"],
    description: ["histórico", "descrição", "lançamento", "discriminação"],
    descriptionComplement: ["complemento", "razão social"],
    document: ["documento", "número documento", "doc.", "nº", "cpf/cnpj"],
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
