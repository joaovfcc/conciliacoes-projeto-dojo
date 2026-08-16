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
      [
        "data", "dt.", "dt. lançamento", "dt lançamento", "dt movto", "dt. movto",
        "dt. mov.", "data lançamento", "data movto", "data movimento", "data mov.",
        "data do lançamento", "dt balancete", "data balancete",
      ],
      [
        "histórico", "descrição", "lançamento", "detalhe", "razão social", "movimento",
        "movimentação", "natureza", "complemento", "discriminação", "operação",
        "observação", "memo", "tipo", "detalhamento",
      ],
      [
        "valor", "crédito", "débito", "lançamento (r$)", "importância",
        "entrada", "saída", "vlr.", "vlr", "montante", "valor (r$)",
        "débito (r$)", "crédito (r$)", "valor débito", "valor crédito",
      ],
    ],
    minimumScore: 70,
  },

  columns: {
    date: [
      "data", "dt.", "dt. lançamento", "dt lançamento", "dt movto", "dt. movto",
      "dt. mov.", "data lançamento", "data movto", "data movimento", "data mov.",
      "data do lançamento", "dt balancete", "data balancete",
    ],
    description: [
      "histórico", "descrição", "lançamento", "detalhe", "razão social", "movimento",
      "movimentação", "natureza", "complemento", "discriminação", "operação",
      "observação", "memo", "detalhamento",
    ],
    document: [
      "documento", "ag/origem", "cpf/cnpj", "num. doc.", "nº", "nr.",
      "docto.", "docto", "doc.", "doc", "número documento", "nro. doc.",
    ],
    amount: ["valor", "vlr.", "vlr", "montante", "importância", "valor (r$)"],
    debit: ["débito", "debito", "saída", "valor débito", "débito (r$)", "pagamento"],
    credit: ["crédito", "credito", "entrada", "valor crédito", "crédito (r$)", "recebimento"],
    balance: ["saldo", "saldo (r$)", "saldo final", "saldo disponível"],
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
