import type { DocumentKind } from "./types.js";

export type PdfExtractionRequirement = "TEXT" | "OCR" | "TEXT_OR_OCR" | "PASSWORD_PROTECTED";

export type CorpusSupportStatus =
  | "PARTIAL_ADAPTER"
  | "AWAITING_ORACLE"
  | "PARSER_DEFECT"
  | "AWAITING_OCR"
  | "INFORMATIONAL_ONLY"
  | "UNSUPPORTED"
  | "CLASSIFICATION_BLOCKED"
  | "PASSWORD_PROTECTED";

export type PdfCorpusSupportEntry = {
  lot: 1 | 2 | 3 | 4 | 5 | 6;
  format: "PDF";
  institutionId: string;
  institutionName: string;
  documentLabel: string;
  documentType: DocumentKind;
  layoutFamily: string;
  quantity: number;
  extractionRequirement: PdfExtractionRequirement;
  currentStatus: CorpusSupportStatus;
  reconciliationEligible: boolean;
};

export type PdfSupportMatrixSummary = {
  totalDocuments: number;
  totalInstitutions: number;
  byLot: Record<number, number>;
};

export type FormatAvailabilityStatus = "PROVIDED" | "NOT_PROVIDED";

export type InitialFormatAvailabilityEntry = {
  institutionId: string;
  institutionName: string;
  documentType: DocumentKind;
  layoutFamily: string;
  accountReferenceStatus: "AWAITING_PRIVATE_ACCOUNT_MANIFEST";
  pdfQuantity: number;
  formats: {
    PDF: "PROVIDED";
    OFX: "NOT_PROVIDED";
    CSV: "NOT_PROVIDED";
    BANK_XLSX: "NOT_PROVIDED";
  };
  preferredTransactionalFormat: "PDF_TEXT" | "PDF_OCR" | "PDF_TEXT_THEN_OCR" | "BLOCKED_PROTECTED_PDF";
  pdfRequired: true;
  fallback: "CSV_AFTER_HOMOLOGATION" | "CREDENTIAL_REQUIRED";
};

export const PDF_CORPUS_SUPPORT_MATRIX: readonly PdfCorpusSupportEntry[] = [
  pdf(1, "BRADESCO", "Bradesco", "Conta-corrente", "CURRENT_ACCOUNT", "BRADESCO_NET_EMPRESA_CC", 7, "TEXT_OR_OCR", "PARTIAL_ADAPTER"),
  pdf(1, "BRADESCO", "Bradesco", "Investimento", "INVESTMENT_ACTIVITY", "BRADESCO_NET_EMPRESA_INVEST", 2, "TEXT", "AWAITING_ORACLE"),
  pdf(1, "BRB", "BRB", "Conta-corrente", "CURRENT_ACCOUNT", "BRB_CC_DETALHADO", 1, "TEXT", "PARSER_DEFECT"),
  pdf(1, "ITAU", "Itaú", "Conta-corrente", "CURRENT_ACCOUNT", "ITAU_EMPRESAS_CC", 1, "OCR", "AWAITING_OCR"),
  pdf(1, "ITAU", "Itaú", "Aplicação", "INVESTMENT_ACTIVITY", "ITAU_APLIC_AUT_MAIS", 1, "OCR", "INFORMATIONAL_ONLY"),
  pdf(1, "SANTANDER", "Santander", "Conta-corrente", "CURRENT_ACCOUNT", "SANTANDER_IBE_CC", 1, "TEXT", "PARTIAL_ADAPTER"),
  pdf(1, "SANTANDER", "Santander", "Aplicação", "INVESTMENT_ACTIVITY", "SANTANDER_IBE_INVEST", 1, "OCR", "INFORMATIONAL_ONLY"),
  pdf(1, "SOFISA", "Sofisa", "Conta-corrente", "CURRENT_ACCOUNT", "SOFISA_NET_CC", 5, "TEXT", "PARTIAL_ADAPTER"),
  pdf(1, "SOFISA", "Sofisa", "Posição", "INVESTMENT_POSITION", "SOFISA_RENDA_FIXA_POSICAO", 1, "TEXT", "INFORMATIONAL_ONLY"),

  pdf(2, "ABC_BRASIL", "ABC Brasil", "Conta-corrente", "CURRENT_ACCOUNT", "ABC_CC_EXTRATO_DETALHADO", 4, "TEXT", "UNSUPPORTED"),
  pdf(2, "BANCO_DO_BRASIL", "Banco do Brasil", "Conta-corrente", "CURRENT_ACCOUNT", "BB_CC_CONSULTAS", 1, "TEXT", "UNSUPPORTED"),
  pdf(2, "BANCO_DO_BRASIL", "Banco do Brasil", "Rende Fácil", "INVESTMENT_ACTIVITY", "BB_RENDE_FACIL_RESUMO", 1, "TEXT", "UNSUPPORTED"),
  pdf(2, "BMG", "BMG", "Conta-corrente", "CURRENT_ACCOUNT", "BMG_CC_WEB", 4, "TEXT", "UNSUPPORTED"),
  pdf(2, "BMG", "BMG", "Investimento", "INVESTMENT_POSITION", "BMG_POSICAO_RENDIMENTO", 1, "TEXT", "UNSUPPORTED"),
  pdf(2, "BMP", "BMP", "Conta-corrente", "CURRENT_ACCOUNT", "BMP_CC_EXTRATO", 1, "TEXT", "UNSUPPORTED"),

  pdf(3, "BOCOM", "Bocom", "Conta-corrente sem movimentos", "CURRENT_ACCOUNT", "BOCOM_CC_EMPTY", 1, "OCR", "AWAITING_OCR"),
  pdf(3, "BOCOM", "Bocom", "Conta-corrente analítica", "CURRENT_ACCOUNT", "BOCOM_CC_ANALITICO", 1, "TEXT", "UNSUPPORTED"),
  pdf(3, "CAIXA", "Caixa", "Conta-corrente", "CURRENT_ACCOUNT", "CAIXA_CC_EXTRATO_PERIODO", 2, "TEXT", "UNSUPPORTED"),
  pdf(3, "CAIXA", "Caixa", "Fundo", "FUND_STATEMENT", "CAIXA_FUNDO_EXTRATO", 1, "TEXT", "UNSUPPORTED"),
  pdf(3, "DAYCOVAL", "Daycoval", "Conta-corrente", "CURRENT_ACCOUNT", "DAYCOVAL_CC_EXTRATO_DETALHADO", 3, "TEXT", "UNSUPPORTED"),
  pdf(3, "GUANABARA", "Guanabara", "Conta-corrente", "CURRENT_ACCOUNT", "GUANABARA_CC", 1, "TEXT", "UNSUPPORTED"),
  pdf(3, "GUANABARA", "Guanabara", "Conta vinculada", "CURRENT_ACCOUNT", "GUANABARA_CONTA_VINCULADA", 1, "TEXT", "UNSUPPORTED"),

  pdf(4, "PAULISTA", "Paulista", "Conta-corrente", "CURRENT_ACCOUNT", "PAULISTA_CC_DEMONSTRATIVO", 1, "TEXT", "UNSUPPORTED"),
  pdf(4, "PAULISTA", "Paulista", "Conta vinculada", "CURRENT_ACCOUNT", "PAULISTA_CONTA_VINCULADA", 1, "TEXT", "UNSUPPORTED"),
  pdf(4, "PINE", "Pine", "Conta-corrente", "CURRENT_ACCOUNT", "PINE_CC", 1, "TEXT", "UNSUPPORTED"),
  pdf(4, "PINE", "Pine", "Conta vinculada", "CURRENT_ACCOUNT", "PINE_CONTA_VINCULADA", 2, "TEXT", "UNSUPPORTED"),
  pdf(4, "VORTX", "Vórtx", "Conta-corrente", "CURRENT_ACCOUNT", "VORTX_CC", 1, "TEXT", "UNSUPPORTED"),
  pdf(4, "VORTX", "Vórtx", "Carteira de debêntures", "INVESTMENT_POSITION", "VORTX_DEBENTURE_PORTFOLIO", 1, "TEXT", "INFORMATIONAL_ONLY"),

  pdf(5, "SAFRA", "Safra", "Conta-corrente", "CURRENT_ACCOUNT", "SAFRA_CC_MOVIMENTACAO", 1, "TEXT", "CLASSIFICATION_BLOCKED"),
  pdf(5, "SAFRA", "Safra", "Fundo", "FUND_STATEMENT", "SAFRA_FUNDO_POSICAO", 1, "TEXT", "UNSUPPORTED"),
  pdf(5, "SAFRA", "Safra", "COE", "STRUCTURED_PRODUCT_POSITION", "SAFRA_COE_POSICAO", 1, "TEXT", "UNSUPPORTED"),
  pdf(5, "SAFRA", "Safra", "Produto automático", "INVESTMENT_ACTIVITY", "SAFRA_PRODUTOS_AUTOMATICOS", 1, "TEXT", "UNSUPPORTED"),
  pdf(5, "SAFRA", "Safra", "Nota de negociação", "BROKERAGE_NOTE", "SAFRA_NOTA_NEGOCIACAO", 13, "OCR", "UNSUPPORTED"),

  pdf(6, "PLANNER", "Planner", "Documento protegido A", "PASSWORD_PROTECTED", "PLANNER_PROTECTED_A", 1, "PASSWORD_PROTECTED", "PASSWORD_PROTECTED"),
  pdf(6, "PLANNER", "Planner", "Documento protegido B", "PASSWORD_PROTECTED", "PLANNER_PROTECTED_B", 1, "PASSWORD_PROTECTED", "PASSWORD_PROTECTED"),
];

export function summarizePdfSupportMatrix(entries: readonly PdfCorpusSupportEntry[]): PdfSupportMatrixSummary {
  const byLot = entries.reduce<Record<number, number>>((counts, entry) => {
    counts[entry.lot] = (counts[entry.lot] ?? 0) + entry.quantity;
    return counts;
  }, {});
  return {
    totalDocuments: entries.reduce((total, entry) => total + entry.quantity, 0),
    totalInstitutions: new Set(entries.map((entry) => entry.institutionId)).size,
    byLot,
  };
}

export function buildInitialFormatAvailabilityMatrix(
  entries: readonly PdfCorpusSupportEntry[],
): InitialFormatAvailabilityEntry[] {
  return entries.map((entry) => ({
    institutionId: entry.institutionId,
    institutionName: entry.institutionName,
    documentType: entry.documentType,
    layoutFamily: entry.layoutFamily,
    accountReferenceStatus: "AWAITING_PRIVATE_ACCOUNT_MANIFEST",
    pdfQuantity: entry.quantity,
    formats: {
      PDF: "PROVIDED",
      OFX: "NOT_PROVIDED",
      CSV: "NOT_PROVIDED",
      BANK_XLSX: "NOT_PROVIDED",
    },
    preferredTransactionalFormat: preferredPdfFormat(entry.extractionRequirement),
    pdfRequired: true,
    fallback: entry.extractionRequirement === "PASSWORD_PROTECTED" ? "CREDENTIAL_REQUIRED" : "CSV_AFTER_HOMOLOGATION",
  }));
}

function pdf(
  lot: PdfCorpusSupportEntry["lot"],
  institutionId: string,
  institutionName: string,
  documentLabel: string,
  documentType: DocumentKind,
  layoutFamily: string,
  quantity: number,
  extractionRequirement: PdfExtractionRequirement,
  currentStatus: CorpusSupportStatus,
): PdfCorpusSupportEntry {
  return {
    lot,
    format: "PDF",
    institutionId,
    institutionName,
    documentLabel,
    documentType,
    layoutFamily,
    quantity,
    extractionRequirement,
    currentStatus,
    reconciliationEligible: documentType === "CURRENT_ACCOUNT",
  };
}

function preferredPdfFormat(
  extractionRequirement: PdfExtractionRequirement,
): InitialFormatAvailabilityEntry["preferredTransactionalFormat"] {
  switch (extractionRequirement) {
    case "TEXT":
      return "PDF_TEXT";
    case "OCR":
      return "PDF_OCR";
    case "TEXT_OR_OCR":
      return "PDF_TEXT_THEN_OCR";
    case "PASSWORD_PROTECTED":
      return "BLOCKED_PROTECTED_PDF";
  }
}
