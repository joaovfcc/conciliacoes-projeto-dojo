import { normalizeHeaderKey } from "./text-normalization.js";

/**
 * Standardized column roles supported by the generic discovery engine
 */
export type StandardColumnRole =
  | "date"
  | "description"
  | "descriptionComplement"
  | "document"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "dcIndicator";

/**
 * Global dictionary of normalized header aliases for each column role.
 * All entries are stored normalized via normalizeHeaderKey.
 */
export const HEADER_ALIASES: Record<StandardColumnRole, string[]> = {
  date: [
    "data",
    "dt",
    "data movimento",
    "data lancamento",
    "dt lancamento",
    "data transacao",
    "dt transacao",
    "data contabil",
    "dt contabil",
    "data balancete",
    "dt balancete",
    "data de lancamento",
    "data da transacao",
    "data da operacao",
    "data do lancamento",
    "data compensacao",
  ],
  description: [
    "historico",
    "descricao",
    "lancamento",
    "transacao",
    "movimento",
    "detalhe",
    "descricao do lancamento",
    "historico lancamento",
    "historico do lancamento",
    "discriminacao",
    "detalhes",
    "tipo de lancamento",
    "especificacao",
    "natureza",
    "evento",
  ],
  descriptionComplement: [
    "complemento",
    "razao social",
    "nome do favorecido",
    "beneficiario",
    "favorecido",
    "detalhes adicionais",
    "observacao",
    "obs",
    "info adicional",
    "informacoes adicionais",
  ],
  document: [
    "documento",
    "doc",
    "numero documento",
    "n documento",
    "num documento",
    "n doc",
    "num doc",
    "comprovante",
    "identificador",
    "numero do documento",
    "nr documento",
    "autenticacao",
    "lote sub doc linha",
    "lote doc",
    "cpf cnpj",
    "ag origem",
  ],
  amount: [
    "valor",
    "valor r",
    "valor rs",
    "montante",
    "valor lancamento",
    "valor da transacao",
    "valor da operacao",
    "valor total",
    "valor r$",
    "vlr lancamento",
    "vlr operacao",
    "vlr transacao",
  ],
  debit: [
    "debito",
    "debitos",
    "saida",
    "saidas",
    "valor debito",
    "pagamentos",
    "valor do debito",
    "vlr debito",
    "debito r",
    "debitos r",
  ],
  credit: [
    "credito",
    "creditos",
    "entrada",
    "entradas",
    "valor credito",
    "recebimentos",
    "deposito",
    "depositos",
    "valor do credito",
    "vlr credito",
    "credito r",
    "creditos r",
  ],
  balance: [
    "saldo",
    "saldo r",
    "saldo rs",
    "saldo atual",
    "saldo final",
    "saldo do dia",
    "saldo r$",
    "saldo contabil",
    "saldo acumulado",
    "saldo disponivel",
  ],
  dcIndicator: [
    "d c",
    "dc",
    "tipo",
    "indicador d c",
    "debito credito",
    "natureza d c",
    "indicador",
    "sinal",
  ],
};

/**
 * Checks whether a cell value matches any alias of a given column role
 */
export function matchesColumnRole(cellValue: unknown, role: StandardColumnRole): { matched: boolean; exact: boolean; matchedAlias?: string } {
  const normalizedCell = normalizeHeaderKey(cellValue);
  if (!normalizedCell) return { matched: false, exact: false };

  const aliases = HEADER_ALIASES[role];
  if (!aliases) return { matched: false, exact: false };

  // First check exact match
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeaderKey(alias);
    if (normalizedCell === normalizedAlias) {
      return { matched: true, exact: true, matchedAlias: alias };
    }
  }

  // Next check token containment
  const cellTokens = new Set(normalizedCell.split(" ").filter(Boolean));
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeaderKey(alias);
    const aliasTokens = normalizedAlias.split(" ").filter(Boolean);
    if (aliasTokens.length > 0 && aliasTokens.every((token) => cellTokens.has(token))) {
      return { matched: true, exact: false, matchedAlias: alias };
    }
  }

  return { matched: false, exact: false };
}
