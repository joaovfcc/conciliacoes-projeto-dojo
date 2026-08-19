import { readFile } from 'node:fs/promises';
import { parseTabularStatement } from '../dist/src/parsers/tabular.js';
import { ITAU_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/itau-checking-xlsx-v1.js';
import { GENERIC_STATEMENT_V1 } from '../dist/src/statements/profiles/generic-statement-v1.js';
import { SANTANDER_CHECKING_XLSX_V1 } from '../dist/src/statements/profiles/santander-checking-xlsx-v1.js';

const santanderBuf = await readFile('docs/mocks/santander_130002439.xlsx');
const file = {
  id: 'santander-file',
  originalName: 'santander_130002439.xlsx',
  buffer: santanderBuf,
};

const result = await parseTabularStatement(file, [
  ITAU_CHECKING_XLSX_V1,
  SANTANDER_CHECKING_XLSX_V1,
  GENERIC_STATEMENT_V1,
]);

console.log('Metadata:', JSON.stringify(result.metadata, null, 2));
console.log('Records (first 3):', JSON.stringify(result.records.slice(0, 3), null, 2));
