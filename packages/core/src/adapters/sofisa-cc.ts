/**
 * Sofisa Conta-Corrente — PDF Adapter V2
 * Family: SOFISA_NET_CC
 */

import { createPdfAdapterFromProfile } from "./pdf-generic-parser.js";
import type { PdfLayoutProfile } from "./pdf-profile.js";

const profile: PdfLayoutProfile = {
  adapterId: "SOFISA_NET_CC",
  adapterVersion: "2",
  institutionCode: "633", // Banco Sofisa
  documentType: "CURRENT_ACCOUNT",
  layoutFamily: "SOFISA_NET_CC",

  detection: {
    positiveSignatures: ["EXTRATO 45 DIAS", "ENTRADAS/SAIDAS"],
    negativeSignatures: [],
  },

  identity: {
    regex: /AGENCIA\s*:\s*([0-9]+)\s+CONTA\s*:\s*([0-9-]+)/i,
    agencyGroup: 1,
    accountGroup: 2,
  },

  transactions: {
    ignoredRegex: /^SALDO\s+DISPONIVEL/i,

    // Pattern: 10/12/25 <unknown_digits> HISTORY DOCUMENT [-] VALUE
    // /^(\d{2}\/\d{2}\/\d{2})\s+\d+\s+(.+?)\s+(\d{5,8})\s+(-\s*)?([\d.]+,\d{2})$/
    pattern: /^(\d{2}\/\d{2}\/\d{2})\s+\d+\s+(.+?)\s+(\d{5,8})\s+(-\s*)?([\d.]+,\d{2})$/,

    dateGroup: 1,
    historyGroup: 2,
    documentGroup: 3,
    negativeSignGroup: 4,
    valueGroup: 5,

    lineSanitizer: (line: string) => {
      return line
        .replace(/(?<=\d)\s+([.,])\s*(?=\d)/g, "$1")
        .replace(/(?<=\d[.,])\s+(?=\d)/g, "");
    },

    dateTransform: (date: string) => {
      // 10/12/25 -> 10/12/2025
      if (date.length === 8) {
        return `${date.slice(0, 6)}20${date.slice(6)}`;
      }
      return date;
    }
  }
};

export const sofisaCurrentAccountAdapter = createPdfAdapterFromProfile(profile);
