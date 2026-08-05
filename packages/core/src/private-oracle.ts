import type { BalanceCheck, StatementClassification } from "./types.js";

export type PrivateStatementOracle = {
  fileSha256: string;
  adapterId: string;
  adapterVersion: string;
  classification: StatementClassification;
  bank: string;
  agency?: string;
  account?: string;
  periods: string[];
  recordCount: number;
  finalBalance?: string;
  balanceCheck?: BalanceCheck["status"];
  approvalReference: string;
};

export function validatePrivateStatementOracles(oracles: readonly PrivateStatementOracle[]): string[] {
  const errors: string[] = [];
  const seenHashes = new Set<string>();
  for (const oracle of oracles) {
    if (!/^[a-f0-9]{64}$/i.test(oracle.fileSha256)) errors.push("ORACLE_SHA256_INVALID");
    else if (seenHashes.has(oracle.fileSha256.toLowerCase())) errors.push("ORACLE_SHA256_DUPLICATE");
    else seenHashes.add(oracle.fileSha256.toLowerCase());
    if (!oracle.adapterId.trim() || !oracle.adapterVersion.trim()) errors.push("ORACLE_ADAPTER_REQUIRED");
    if (!oracle.bank.trim() || !oracle.classification) errors.push("ORACLE_IDENTITY_REQUIRED");
    if (!oracle.periods.every((period) => /^\d{6}$/.test(period))) errors.push("ORACLE_PERIOD_INVALID");
    if (!Number.isInteger(oracle.recordCount) || oracle.recordCount < 0) errors.push("ORACLE_RECORD_COUNT_INVALID");
    if (!oracle.approvalReference.trim()) errors.push("ORACLE_APPROVAL_REQUIRED");
  }
  return [...new Set(errors)].sort();
}
