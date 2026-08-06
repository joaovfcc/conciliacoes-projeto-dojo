/**
 * Itaú Conta-Corrente — PDF Adapter V2
 * Family: ITAU_EMPRESAS_CC
 */

import { createPdfAdapterFromProfile } from "./pdf-generic-parser.js";
import type { PdfLayoutProfile } from "./pdf-profile.js";

const profile: PdfLayoutProfile = {
  adapterId: "ITAU_EMPRESAS_CC",
  adapterVersion: "2",
  institutionCode: "341",
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "ITAU_EMPRESAS_CC",

  detection: {
    positiveSignatures: ["EXTRATO DE CONTA CORRENTE", "SALDO RESUMIDO"],
    negativeSignatures: ["BANCO SAFRA"],
  },

  identity: {
    regex: /AG[EE]NCIA\s*:?\s*([0-9]+).*?CONTA\s*:?\s*([0-9-]+)/is,
    agencyGroup: 1,
    accountGroup: 2,
  },

  transactions: {
    ignoredRegex: /(?:SALDO\s+(?:ANTERIOR|DO\s+DIA|FINAL|DISPONIVEL)|SDO\s+CTA\/APL)/i,

    // Pattern: 01/01/2024 HISTORY VALUE [-]
    // /^(\d{2}\/\d{2}(?:\/\d{4})?)\s+(.+?)\s+(-?[\d.]+,\d{2})\s*(-)?$/
    pattern: /^(\d{2}\/\d{2}(?:\/\d{4})?)\s+(.+?)\s+(-?[\d.]+,\d{2})\s*(-)?$/,

    dateGroup: 1,
    historyGroup: 2,
    valueGroup: 3,
    negativeSignGroup: 4,

    extractDocumentFromHistory: true,

    inferYear: (allText: string) => {
      const yearMatch = /(?:20)\d{2}/.exec(allText);
      return yearMatch?.[0] ?? String(new Date().getUTCFullYear());
    },

    lineSanitizer: (line: string) => {
      return line
        .replace(/(?<=\d)\s+([.,])\s*(?=\d)/g, "$1")
        .replace(/(?<=\d[.,])\s+(?=\d)/g, "");
    }
  }
};

export const itauCurrentAccountAdapter = createPdfAdapterFromProfile(profile);
