import { readFile } from 'node:fs/promises';
import { preflightFiles } from '../dist/src/preflight.js';

const ledgerBuf = await readFile('docs/mocks/1225_11102012_1808_1847.xlsx');
const santanderBuf = await readFile('docs/mocks/santander_130002439.xlsx');

const ledgerFile = {
  id: 'ledger-1',
  originalName: '1225_11102012_1808_1847.xlsx',
  buffer: ledgerBuf,
};

const statementFile = {
  id: 'statement-1',
  originalName: 'santander_130002439.xlsx',
  buffer: santanderBuf,
};

const result = await preflightFiles(ledgerFile, [statementFile]);
console.log('=== PREFLIGHT RESULT ===');
console.log(JSON.stringify(result.preflight, null, 2));
