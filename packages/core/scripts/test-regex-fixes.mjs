import { readFile } from 'node:fs/promises';
import { parseSpreadsheet } from '../dist/src/tabular/spreadsheet-reader.js';
import { parseStatement as parseStatementGeneric } from '../dist/src/statements/generic-statement-parser.js';
import { detectLayoutResult } from '../dist/src/statements/layout-detector.js';
import { SANTANDER_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/santander-checking-xlsx-v1.js';
import { ITAU_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/itau-checking-xlsx-v1.js';
import { GENERIC_STATEMENT_V1 } from '../dist/src/statements/profiles/generic-statement-v1.js';

// Test ledger regex
const ledgerDetails = "CONTA - 1.1.1.0.2012 - BANCO SANTANDER AG. 3377 C/C. 130002439";
const bankMatch = /\bBANCO\s+([A-ZÀ-Ú0-9]+).*?\bAG\.?\s*([0-9]+).*?\bC\/?C\.?\s*([0-9-]+)/i.exec(ledgerDetails);
console.log('Ledger bankMatch:', bankMatch ? {
  bank: bankMatch[1],
  agency: bankMatch[2],
  account: bankMatch[3],
} : 'NO MATCH');

// Test account regex on header rows
const textRow0 = "Extrato Santander - Conta Corrente";
const textRow1 = "Empresa SPREAD SISTEMAS E AUTOMACAO LTDA Agência 3377 Conta 130002439";
const accountRegex = /(?:conta(?:\s*corrente)?|c\/?c)\s*[:#.]?\s*([0-9][0-9A-Z.-]*)/i;
console.log('Row 0 account match:', accountRegex.exec(textRow0));
console.log('Row 1 account match:', accountRegex.exec(textRow1));
