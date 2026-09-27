import { readFile } from 'node:fs/promises';
import { parseSpreadsheet } from '../dist/src/tabular/spreadsheet-reader.js';
import { detectLayoutResult } from '../dist/src/statements/layout-detector.js';
import { ITAU_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/itau-checking-xlsx-v1.js';
import { BRADESCO_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/bradesco-checking-xlsx-v1.js';
import { BB_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/bb-checking-xlsx-v1.js';
import { SANTANDER_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/santander-checking-xlsx-v1.js';
import { CAIXA_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/caixa-checking-xlsx-v1.js';
import { GENERIC_STATEMENT_V1 } from '../dist/src/statements/profiles/generic-statement-v1.js';

const profiles = [
  ITAU_CHECKING_XLSX_V1,
  BRADESCO_CHECKING_XLSX_V1,
  BB_CHECKING_XLSX_V1,
  SANTANDER_CHECKING_XLSX_V1,
  CAIXA_CHECKING_XLSX_V1,
  GENERIC_STATEMENT_V1,
];

const santanderBuf = await readFile('docs/mocks/santander_130002439.xlsx');
const doc = parseSpreadsheet({ buffer: santanderBuf, sourceFormat: 'XLSX', fileName: 'santander_130002439.xlsx' });
for (const sheet of doc.sheets) {
  const result = detectLayoutResult(sheet, profiles, 'XLSX');
  console.log(`=== Sheet: ${sheet.name} ===`);
  console.log('Result:', JSON.stringify(result, null, 2));
}
