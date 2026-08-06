/**
 * Santander Conta-Corrente — PDF Adapter V2
 * Family: SANTANDER_IBE_CC
 */

import { createPdfAdapterFromProfile } from "./pdf-generic-parser.js";
import type { PdfLayoutProfile } from "./pdf-profile.js";

const profile: PdfLayoutProfile = {
  adapterId: "SANTANDER_IBE_CC",
  adapterVersion: "2",
  institutionCode: "033",
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "SANTANDER_IBE_CC",

  detection: {
    positiveSignatures: ["INTERNET BANKING EMPRESARIAL", "CONTA CORRENTE"],
    negativeSignatures: [],
  },

  identity: {
    regex: /AGENCIA\s*:\s*([0-9]+)\s+CONTA\s*:\s*([0-9-]+)/i,
    agencyGroup: 1,
    accountGroup: 2,
  },

  transactions: {
    ignoredRegex: /\bSALDO\b/i,

    // Pattern: 01/01/2024 HISTORY VALUE [BALANCE]
    // /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.]+,\d{2})(?:\s+-?[\d.]+,\d{2})?$/
    pattern: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.]+,\d{2})(?:\s+-?[\d.]+,\d{2})?$/,

    dateGroup: 1,
    historyGroup: 2,
    valueGroup: 3,

    extractDocumentFromHistory: true,
    valueIncludesSign: true,

    lineSanitizer: (line: string) => {
      return line
        .replace(/(?<=\d)\s+([.,])\s*(?=\d)/g, "$1")
        .replace(/(?<=\d[.,])\s+(?=\d)/g, "");
    }
  }
};

export const santanderCurrentAccountAdapter = createPdfAdapterFromProfile(profile);
