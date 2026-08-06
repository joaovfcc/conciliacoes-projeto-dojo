/**
 * Bradesco Conta-Corrente — PDF Adapter V2
 * Family: BRADESCO_NET_EMPRESA_CC
 */

import { createPdfAdapterFromProfile } from "./pdf-generic-parser.js";
import type { PdfLayoutProfile } from "./pdf-profile.js";

const profile: PdfLayoutProfile = {
  adapterId: "BRADESCO_NET_EMPRESA_CC",
  adapterVersion: "2",
  institutionCode: "237",
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "BRADESCO_NET_EMPRESA_CC",

  detection: {
    positiveSignatures: ["EXTRATO MENSAL / POR PERIODO", "EXTRATO DE:"],
    negativeSignatures: [],
  },

  identity: {
    regex: /EXTRATO\s+DE:\s*AG\.?\s*:?\s*([0-9]+)\s*\|\s*CC\s*:?\s*([0-9\s-]+)/i,
    agencyGroup: 1,
    accountGroup: 2,
  },

  transactions: {
    headerBoundaryRegex: /DATA\s+LANCAMENTO.*CREDITO.*DEBITO.*SALDO/i,
    ignoredRegex: /SALDO ANTERIOR|DADOS ACIMA|EXTRATO DE:/i,
    stopRegex: /^(TOTAL\b|ULTIMOS LANCAMENTOS|SALDOS INVEST)/i,
    
    // Pattern: 01/01/2024 HISTORY DOC VALUE BALANCE
    // (?:(\d{2}\/\d{2}\/\d{4})\s+)?(?:(.*?)\s+)?(\d{5,8})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})
    pattern: /^(?:(\d{2}\/\d{2}\/\d{4})\s+)?(?:(.*?)\s+)?(\d{5,8})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})$/,
    
    dateGroup: 1,
    historyGroup: 2,
    documentGroup: 3,
    valueGroup: 4,
    runningBalanceGroup: 5,
    
    valueIncludesSign: true,
    multiLineHistory: true,
  }
};

export const bradescoCurrentAccountAdapter = createPdfAdapterFromProfile(profile);
