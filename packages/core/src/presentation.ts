import type {
  BalanceCheck,
  DecisionLevel,
  DocumentKind,
  ExtractionMethod,
  ImportIssue,
  InvestmentEntryKind,
  ResultStatus,
} from "./types.js";
import type { MatchRule, MatchStatus } from "./reconciliation/domain/ReconciliationEngine.js";
import type {
  ExceptionStatus,
  ExceptionType,
  MatchGroup,
  ReconciliationRunStatus,
} from "./reconciliation/domain/ReconciliationRun.js";

const resultStatusLabels: Record<ResultStatus, string> = {
  AUTO_MATCH_EXACT: "Conciliação exata",
  AUTO_MATCH_UNIQUE_VALUE: "Conciliação por valor único",
  AUTO_MATCH_DATE_TOLERANCE: "Conciliação com tolerância de data",
  AUTO_MATCH_VALUE_DATE: "Conciliação por valor e data",
  AUTO_MATCH_GROUP: "Conciliação em grupo",
  AUTO_MATCH_DAILY_TOTAL: "Conciliação por total diário",
  BANK_NET_ZERO: "Compensado no extrato",
  AUTO_APPLICATION_EXCLUDED: "Excluído - aplicação automática",
  GROUP_SUGGESTION: "Sugestão de agrupamento",
  VALUE_ONLY_SUGGESTION: "Sugestão por valor",
  VALUE_DIVERGENCE: "Divergência de valor",
  DATE_DIVERGENCE: "Divergência de data",
  LEDGER_WITHOUT_STATEMENT: "Lançamento do razão sem correspondente no extrato",
  STATEMENT_WITHOUT_LEDGER: "Lançamento do extrato sem correspondente no razão",
  AMBIGUOUS_MATCH: "Conciliação ambígua",
  POSSIBLE_DUPLICATE: "Possível duplicidade",
};

const additionalMatchStatusLabels: Record<Exclude<MatchStatus, ResultStatus>, string> = {
  AUTO_MATCH_DESCRIPTION: "Conciliação por descrição",
};

const reconciliationRuleLabels: Record<MatchRule, string> & Record<string, string> = {
  RULE_1_EXACT: "Regra 1 — documento, data e valor exatos",
  RULE_2_DATE_TOLERANCE: "Regra 2 — documento e valor exatos com tolerância de data",
  RULE_3_MISSING_DOCUMENT: "Regra 3 — valor e data exatos sem documento completo",
  RULE_3_DESCRIPTION: "Regra 3 — valor, data e descrição compatíveis",
  RULE_4_GROUPING: "Regra 4 — sugestão de agrupamento",
  RULE_4_VALUE_DIVERGENCE: "Regra 4 — divergência de valor",
  RULE_5_DATE_DIVERGENCE: "Regra 5 — divergência de data",
  RULE_6_VALUE_ONLY: "Regra 6 — possível correspondência somente por valor",
  RULE_7_LEDGER_WITHOUT_STATEMENT: "Regra 7 — lançamento do razão sem correspondente no extrato",
  RULE_8_STATEMENT_WITHOUT_LEDGER: "Regra 8 — lançamento do extrato sem correspondente no razão",
  RULE_9_AMBIGUITY: "Regra 9 — mais de um candidato possível",
  RULE_7_DAILY_TOTAL: "Regra 7 — mesmo dia pelo total diário do lote",
  RULE_8_BANK_NET_ZERO: "Regra 8 — movimentos opostos no mesmo dia, sem efeito líquido",
  RULE_1_AUTO_APPLICATION: "Regra 1 — segregação de aplicação automática",
  "RF-01": "RF-01 — segregação de aplicação automática",
  "RF-02": "RF-02 — valor único no escopo confirmado",
  "RF-03": "RF-03 — proximidade de até três dias",
  "RF-04": "RF-04 — um movimento bancário para múltiplos lançamentos contábeis",
  "RF-05": "RF-05 — múltiplos movimentos bancários para um lançamento contábil",
  "RF-07": "RF-07 — total diário exato dos resíduos",
  "RF-08": "RF-08 — compensação bancária líquida zero",
  "RF-09": "RF-09 — pendência após todas as regras",
  RULE_7_UNMAPPED_LEDGER: "Regra 7 — lançamento do razão fora do relacionamento confirmado",
  RULE_8_UNMAPPED_STATEMENT: "Regra 8 — lançamento do extrato fora do relacionamento confirmado",
};

const decisionLevelLabels: Record<DecisionLevel, string> = {
  AUTOMATIC: "Automática",
  REVIEW_REQUIRED: "Revisão necessária",
  BLOCKED: "Bloqueada",
};

const extractionMethodLabels: Record<ExtractionMethod, string> = {
  TEXT: "Texto do documento",
  OCR: "Reconhecimento óptico de caracteres (OCR)",
  MIXED: "Texto e reconhecimento óptico de caracteres",
  TABULAR: "Planilha",
  OFX: "Arquivo OFX",
};

const documentKindLabels: Record<DocumentKind, string> = {
  CURRENT_ACCOUNT: "Conta-corrente",
  INVESTMENT_ACTIVITY: "Movimentação de investimento",
  INVESTMENT_POSITION: "Posição de investimento",
  FUND_STATEMENT: "Extrato de fundo",
  STRUCTURED_PRODUCT_POSITION: "Posição de produto estruturado",
  BROKERAGE_NOTE: "Nota de negociação",
  PASSWORD_PROTECTED: "Documento protegido por senha",
  UNKNOWN: "Documento não identificado",
};

const investmentKindLabels: Record<InvestmentEntryKind, string> = {
  APPLICATION: "Aplicação",
  REDEMPTION: "Resgate",
  EARNING: "Rendimento",
  POSITION: "Posição final",
};

const balanceStatusLabels: Record<BalanceCheck["status"], string> = {
  PASSED: "Aprovado",
  FAILED: "Reprovado",
  NOT_AVAILABLE: "Não disponível",
};

const severityLabels: Record<ImportIssue["severity"], string> = {
  WARNING: "Alerta",
  ERROR: "Erro",
};

const runStatusLabels: Record<ReconciliationRunStatus, string> = {
  PREPARING: "Em preparação",
  READY_FOR_REVIEW: "Pronta para revisão",
  UNDER_REVIEW: "Em revisão",
  REJECTED: "Rejeitada",
  APPROVED: "Aprovada",
  CLOSED: "Encerrada",
};

const matchGroupStatusLabels: Record<MatchGroup["status"], string> = {
  AUTO_CONFIRMED: "Confirmada automaticamente",
  SUGGESTED: "Sugerida para revisão",
  MANUALLY_CONFIRMED: "Confirmada manualmente",
  REJECTED: "Rejeitada",
};

const cardinalityLabels: Record<MatchGroup["cardinality"], string> = {
  ONE_TO_ONE: "Um para um",
  ONE_TO_MANY: "Um para muitos",
  MANY_TO_ONE: "Muitos para um",
  MANY_TO_MANY: "Muitos para muitos",
};

const exceptionTypeLabels: Record<ExceptionType, string> = {
  BANK_ONLY: "Somente no extrato",
  LEDGER_ONLY: "Somente no razão",
  AMOUNT_DIFFERENCE: "Diferença de valor",
  DATE_DIFFERENCE: "Diferença de data",
  POSSIBLE_MATCH: "Possível conciliação",
  DUPLICATE: "Possível duplicidade",
  BALANCE_DIFFERENCE: "Diferença de saldo",
  SOURCE_ERROR: "Erro no arquivo de origem",
  AMBIGUOUS_MATCH: "Conciliação ambígua",
};

const exceptionStatusLabels: Record<ExceptionStatus, string> = {
  OPEN: "Aberta",
  ASSIGNED: "Atribuída",
  UNDER_REVIEW: "Em revisão",
  RESOLVED: "Resolvida",
  ACCEPTED_TIMING_DIFFERENCE: "Diferença de data aceita",
  REJECTED: "Rejeitada",
};

const issueCategoryLabels: Record<string, string> = {
  LAYOUT_NOT_DETECTED: "Leiaute não identificado",
  PDF_LAYOUT_UNSUPPORTED: "Leiaute de PDF não suportado",
  PDF_OCR_UNAVAILABLE: "Leitura de imagem indisponível",
  PDF_INVALID: "PDF inválido",
  INVALID_FILE: "Arquivo inválido",
  INVALID_SPREADSHEET: "Planilha inválida",
  CORRUPTED_SPREADSHEET: "Planilha corrompida",
  MACRO_DETECTED: "Macro detectada",
  MACRO_REJEITADA: "Arquivo com macro não permitido",
  MIME_EXTENSION_MISMATCH: "Extensão incompatível com o conteúdo",
  MIME_SIGNATURE_MISMATCH: "Tipo do arquivo incompatível com o conteúdo",
  BALANCE_INTEGRITY_FAILED: "Controle de saldo reprovado",
  BALANCE_CONTROL_NOT_AVAILABLE: "Controle de saldo indisponível",
  ACCOUNT_IDENTITY_MISMATCH: "Conta divergente",
  ACCOUNT_IDENTITY_MISSING: "Identificação da conta ausente",
  BANK_ACCOUNT_IDENTITY_MISMATCH: "Conta bancária divergente",
  BANK_ACCOUNT_CONFIRMATION_REQUIRED: "Confirmação da conta bancária necessária",
  MULTIPLAS_EMPRESAS: "Mais de uma empresa identificada",
  RAZAO_FORA_COMPETENCIA: "Lançamentos do razão fora da competência",
  EXTRATO_FORA_COMPETENCIA: "Lançamentos do extrato fora da competência",
  RAZAO_SEM_REGISTROS: "Razão sem lançamentos",
  EXTRATO_SEM_MOVIMENTOS: "Extrato sem movimentos",
  TABULAR_SEM_MOVIMENTOS: "Planilha bancária sem movimentos",
  OFX_SEM_MOVIMENTOS: "Arquivo OFX sem movimentos",
  STATEMENT_MOVEMENTS_NOT_EXTRACTED: "Movimentos do extrato não extraídos",
  STRUCTURED_SOURCE_EVIDENCE_MISMATCH: "Divergência entre a fonte estruturada e a evidência",
  SOURCE_CROSSCHECK_FAILED: "Validação cruzada das fontes reprovada",
  TRANSACTION_ID_DUPLICATE: "Lançamento duplicado",
  POSSIBLE_DUPLICATE_SOURCE_TRANSACTION: "Possível lançamento duplicado na origem",
  WORKSHEET_RANGE_REPAIRED: "Faixa da planilha corrigida durante a leitura",
};

const bankLabels: Record<string, string> = {
  ITAU: "Itaú",
  BRADESCO: "Bradesco",
  BRB: "BRB",
  SANTANDER: "Santander",
  SOFISA: "Sofisa",
  BANCO_DO_BRASIL: "Banco do Brasil",
  ABC_BRASIL: "Banco ABC Brasil",
  CAIXA: "Caixa",
  BMG: "BMG",
  BMP: "BMP",
  BOCOM: "Bocom",
  DAYCOVAL: "Daycoval",
  GUANABARA: "Guanabara",
  PAULISTA: "Paulista",
  PINE: "Pine",
  SAFRA: "Safra",
  VORTX: "Vórtx",
};

export function resultStatusLabel(status: ResultStatus | MatchStatus): string {
  return resultStatusLabels[status as ResultStatus] ?? additionalMatchStatusLabels[status as keyof typeof additionalMatchStatusLabels] ?? "Situação de conciliação não catalogada";
}

export function reconciliationRuleLabel(rule: string): string {
  return reconciliationRuleLabels[rule] ?? "Regra de conciliação não catalogada";
}

export function decisionLevelLabel(level: DecisionLevel): string {
  return decisionLevelLabels[level];
}

export function extractionMethodLabel(method: ExtractionMethod): string {
  return extractionMethodLabels[method];
}

export function documentKindLabel(kind: DocumentKind): string {
  return documentKindLabels[kind];
}

export function investmentKindLabel(kind: InvestmentEntryKind): string {
  return investmentKindLabels[kind];
}

export function balanceStatusLabel(status: BalanceCheck["status"]): string {
  return balanceStatusLabels[status];
}

export function issueSeverityLabel(severity: ImportIssue["severity"]): string {
  return severityLabels[severity];
}

export function issueCategoryLabel(code: string, severity: ImportIssue["severity"]): string {
  return issueCategoryLabels[code] ?? (severity === "ERROR" ? "Erro de processamento" : "Alerta de processamento");
}

export function accountSummaryStatusLabel(status: "CONCILIADA" | "COM_DIVERGENCIAS"): string {
  return status === "CONCILIADA" ? "Conciliada" : "Com divergências";
}

export function bankLabel(bank: string): string {
  return bankLabels[bank.toLocaleUpperCase("pt-BR")] ?? bank;
}

export function parserLabel(parser: string | undefined): string {
  if (!parser) return "Leitor não identificado";
  const normalized = parser.toLocaleUpperCase("pt-BR");
  if (normalized.includes("ITAU")) return normalized.includes("XLSX") ? "Leitor de planilha do Itaú" : "Leitor de extrato do Itaú";
  if (normalized.includes("BRADESCO")) return "Leitor de extrato do Bradesco";
  if (normalized.includes("SANTANDER")) return "Leitor de extrato do Santander";
  if (normalized.includes("SOFISA")) return "Leitor de extrato do Sofisa";
  if (normalized.includes("BRB")) return "Leitor de extrato do BRB";
  if (normalized.includes("OFX")) return "Leitor de arquivo OFX";
  if (normalized.includes("CSV")) return "Leitor de arquivo CSV";
  if (normalized.includes("LEDGER") || normalized.includes("PROTHEUS")) return "Leitor do razão Protheus";
  return "Leitor específico do formato";
}

export function reconciliationRunStatusLabel(status: ReconciliationRunStatus): string {
  return runStatusLabels[status];
}

export function matchGroupStatusLabel(status: MatchGroup["status"]): string {
  return matchGroupStatusLabels[status];
}

export function cardinalityLabel(cardinality: MatchGroup["cardinality"]): string {
  return cardinalityLabels[cardinality];
}

export function exceptionTypeLabel(type: ExceptionType): string {
  return exceptionTypeLabels[type];
}

export function exceptionStatusLabel(status: ExceptionStatus): string {
  return exceptionStatusLabels[status];
}

export function resolutionCodeLabel(code: string | undefined): string {
  if (!code) return "";
  const labels: Record<string, string> = {
    ACCEPT_TIMING_DIFFERENCE: "Aceitar diferença de data",
    ACCEPTED_TIMING_DIFFERENCE: "Diferença de data aceita",
    REJECT: "Rejeitar",
    RESOLVE: "Resolver",
  };
  return labels[code] ?? "Resolução registrada";
}

export function evidenceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    MATCH_DECISION: "Decisão de conciliação",
    TRANSACTION_SOURCE: "Origem do lançamento bancário",
    LEDGER_SOURCE: "Origem do lançamento contábil",
    FILE_UPLOAD: "Envio de arquivo",
  };
  return labels[type] ?? "Evidência técnica";
}

export function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    RECONCILIATION_EXECUTED: "Conciliação executada",
    IMPORT_VALIDATED: "Importação validada",
    IMPORT_REJECTED: "Importação rejeitada",
    START_REVIEW: "Revisão iniciada",
    ACCEPT_TIMING_DIFFERENCE: "Diferença de data aceita",
  };
  return labels[action] ?? "Ação registrada";
}

export function knownCategoricalValueLabel(value: string): string {
  const labels: Record<string, string> = {
    ...resultStatusLabels,
    ...additionalMatchStatusLabels,
    ...reconciliationRuleLabels,
    ...decisionLevelLabels,
    ...extractionMethodLabels,
    ...documentKindLabels,
    ...investmentKindLabels,
    ...balanceStatusLabels,
    ...severityLabels,
    ...runStatusLabels,
    ...matchGroupStatusLabels,
    ...cardinalityLabels,
    ...exceptionTypeLabels,
    ...exceptionStatusLabels,
    ...issueCategoryLabels,
    DEBIT: "Débito",
    CREDIT: "Crédito",
    BANK_ASSET: "Ativo bancário",
    BANK_LIABILITY: "Passivo bancário",
    INVESTMENT_ASSET: "Ativo de investimento",
  };
  return labels[value] ?? value;
}

export function formatDateForDisplay(value: string | Date | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(`${value.length === 10 ? value : value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

export function formatPeriodForDisplay(period: string): string {
  return /^\d{6}$/.test(period) ? `${period.slice(4, 6)}/${period.slice(0, 4)}` : period;
}
