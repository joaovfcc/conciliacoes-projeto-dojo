import { readFile } from 'node:fs/promises';
import { preflightFiles } from '../dist/src/preflight.js';
import { reconcile } from '../dist/src/reconciliation.js';

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

const bundle = await preflightFiles(ledgerFile, [statementFile]);
const pf = bundle.preflight;

const confirmation = {
  period: "202512",
  company: pf.companies[0] || "",
  branch: pf.branches[0] || "02",
  mappings: [
    {
      ledgerAccount: pf.ledgerAccounts[0].account,
      statementFileIds: [pf.statements[0].fileId],
      signProfile: "BANK_ASSET",
    },
  ],
  valueTolerance: "0.01",
  dateToleranceDays: 2,
  idempotencyKey: "test-reconciliation-key-1",
};

const result = reconcile(bundle.ledgers, bundle.statements, confirmation, pf);
console.log('=== RECONCILIATION RESULT ===');
console.log('Summaries:', JSON.stringify(result.summaries, null, 2));
console.log('\nControls coverage:', JSON.stringify(result.controls?.coverage, null, 2));
console.log('Counts by status:', JSON.stringify(result.controls?.countsByStatus, null, 2));
console.log('\nResults count:', result.results.length);
for (const r of result.results) {
  console.log(`- Status: ${r.status} | Rule: ${r.rule} | Reason: ${r.reason}`);
  if (r.ledger) console.log(`  Ledger: ${r.ledger.date} | ${r.ledger.history} | ${r.ledger.value}`);
  if (r.statement) console.log(`  Stmt:   ${r.statement.date} | ${r.statement.history} | ${r.statement.value}`);
}
