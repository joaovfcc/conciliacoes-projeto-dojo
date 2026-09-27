import { readFile } from 'node:fs/promises';
import { parseSpreadsheet } from '../dist/src/tabular/spreadsheet-reader.js';

const santanderBuf = await readFile('docs/mocks/santander_130002439.xlsx');
const doc = parseSpreadsheet({ buffer: santanderBuf, sourceFormat: 'XLSX', fileName: 'santander_130002439.xlsx' });
for (const sheet of doc.sheets) {
  console.log(`=== Sheet: ${sheet.name} (rows: ${sheet.rows.length}) ===`);
  for (let i = 0; i < Math.min(sheet.rows.length, 15); i++) {
    console.log(`Row ${i}:`, JSON.stringify(sheet.rows[i].cells.map(c => c.displayValue)));
  }
}
