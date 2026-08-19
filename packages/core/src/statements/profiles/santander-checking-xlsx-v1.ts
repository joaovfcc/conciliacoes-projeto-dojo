import { StatementLayoutProfile } from "../statement-types.js";

export const SANTANDER_CHECKING_XLSX_V1: StatementLayoutProfile = {
  id: "santander-checking-xlsx-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "033",
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM"],

  detection: {
    sheetNameAliases: ["santander", "extrato", "conta corrente", "movimentacao", "movimentação"],
    requiredHeaderGroups: [
      ["data", "data lançamento", "dt. lançamento", "dt balancete", "data balancete", "data de lançamento"],
      ["histórico", "descrição", "lançamento", "historico", "descricao"],
      ["valor (r$)", "valor r$", "valor", "débito", "crédito", "debito", "credito"],
    ],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "data lançamento", "dt. lançamento", "dt balancete", "data balancete", "data de lançamento"],
    description: ["histórico", "descrição", "lançamento", "historico", "descricao"],
    descriptionComplement: ["razão social", "razao social", "complemento"],
    document: ["documento", "doc.", "nº doc.", "cpf/cnpj", "num doc"],
    amount: ["valor (r$)", "valor r$", "valor"],
    debit: ["débito", "debito"],
    credit: ["crédito", "credito"],
    balance: ["saldo (r$)", "saldo r$", "saldo"],
  },

  rules: {
    headerScanRows: 50,
    negativeAmountMeansDebit: true,
    inheritDateFromPreviousRow: false,
    repeatedHeaderPolicy: "IGNORE",
    ignoreRowPatterns: [
      "saldo anterior",
      "saldo atual",
      "saldo final",
      "saldo disponível",
      "saldo disponivel",
      "saldo em investimentos",
      "saldo bloqueado",
      "posição consolidada",
      "posicao consolidada",
      "resumo",
      "subtotal",
      "total",
    ],
    stopPatterns: ["não há lançamentos", "nao ha lancamentos", "fim do extrato"],
    openingBalancePatterns: ["saldo anterior"],
    closingBalancePatterns: ["saldo final", "saldo disponível", "saldo disponivel", "saldo atual"],
  },
};

