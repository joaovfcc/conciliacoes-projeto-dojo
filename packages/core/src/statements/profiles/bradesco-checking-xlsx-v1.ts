import { StatementLayoutProfile } from "../statement-types.js";

export const BRADESCO_CHECKING_XLSX_V1: StatementLayoutProfile = {
  id: "bradesco-checking-xlsx-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "237",
  productType: "CHECKING",
  formats: ["XLSX", "XLS", "XLSM"],

  detection: {
    sheetNameAliases: ["lançamentos", "lancamentos", "extrato", "bradesco"],
    negativeSheetNames: [
      "lançamentos futuros",
      "lancamentos futuros",
      "posição consolidada",
      "posicao consolidada",
    ],
    institutionPatterns: ["bradesco", "facilcred", "net empresa", "invest facilcred"],
    requiredHeaderGroups: [
      ["data", "dt. lançamento", "data lançamento", "dt balancete", "data balancete"],
      ["histórico", "descrição", "lançamento", "historico", "descricao", "lancamento"],
      ["débito", "crédito", "valor", "debito", "credito", "valor (r$)"],
    ],
    distinctiveHeaderGroups: [["ag/origem"], ["razão social", "razao social"], ["cpf/cnpj"]],
    minimumScore: 60,
  },

  columns: {
    date: ["data", "dt. lançamento", "data lançamento", "dt balancete", "data balancete"],
    description: ["histórico", "descrição", "lançamento", "historico", "descricao", "lancamento"],
    descriptionComplement: ["complemento", "razão social", "razao social"],
    document: ["docto.", "docto", "documento", "doc.", "nº doc.", "cpf/cnpj"],
    amount: ["valor", "valor (r$)"],
    debit: ["débito", "debito"],
    credit: ["crédito", "credito"],
    balance: ["saldo", "saldo (r$)", "saldo disponível", "saldo disponivel"],
  },

  rules: {
    headerScanRows: 50,
    negativeAmountMeansDebit: true,
    inheritDateFromPreviousRow: true,
    repeatedHeaderPolicy: "IGNORE",
    ignoreRowPatterns: ["saldo anterior", "saldo atual", "saldo final", "resumo", "subtotal", "total", "extrato mensal", "conta-corrente", "total r$", "total disponível", "total disponivel"],
    stopPatterns: ["não há lançamentos", "nao ha lancamentos", "fim do extrato"],
    openingBalancePatterns: ["saldo anterior"],
    closingBalancePatterns: ["saldo atual", "saldo final", "saldo disponível", "saldo disponivel", "saldo total"],
    balanceExclusionPatterns: ["RENTAB.*INVEST.*FACILCRED", "INVEST.*FACILCRED"],
  },
};
