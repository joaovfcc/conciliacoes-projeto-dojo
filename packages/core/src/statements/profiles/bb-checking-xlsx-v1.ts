import { StatementLayoutProfile } from "../statement-types.js";

export const BB_CHECKING_XLSX_V1: StatementLayoutProfile = {
  id: "bb-checking-xlsx-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "001",
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM"],

  detection: {
    sheetNameAliases: ["banco do brasil"],
    institutionPatterns: ["banco do brasil"],
    requiredHeaderGroups: [
      ["data", "data mov.", "data movimento", "dt balancete", "data balancete"],
      ["histórico", "descrição", "lançamento"],
      ["valor", "débito (r$)", "crédito (r$)", "débito", "crédito"],
    ],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "data mov.", "data movimento", "dt balancete", "data balancete"],
    description: ["histórico", "descrição", "lançamento"],
    descriptionComplement: ["razão social", "complemento"],
    document: ["documento", "doc.", "nº doc.", "número documento", "cpf/cnpj"],
    amount: ["valor", "valor (r$)"],
    debit: ["débito", "debito", "débito (r$)"],
    credit: ["crédito", "credito", "crédito (r$)"],
    balance: ["saldo", "saldo (r$)"],
  },

  rules: {
    headerScanRows: 50,
    negativeAmountMeansDebit: true,
    inheritDateFromPreviousRow: false,
    repeatedHeaderPolicy: "IGNORE",
    ignoreRowPatterns: ["saldo anterior", "saldo atual", "saldo final", "resumo", "subtotal", "total", "s.a.l.d.o"],
    stopPatterns: ["não há lançamentos", "fim do extrato"],
  },
};
