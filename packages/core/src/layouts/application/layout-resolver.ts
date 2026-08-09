import type { LayoutCatalogEntry, LayoutFingerprint } from "../domain/LayoutModels.js";

export interface ResolveLayoutInput {
  fingerprint: LayoutFingerprint;
  entries: LayoutCatalogEntry[];
  companyId: string;
  bankAccountId?: string;
  bankCode?: string;
}

export interface ResolvedLayout {
  entry?: LayoutCatalogEntry;
  requiresMapping: boolean;
  reason?: "NOT_FOUND" | "AMBIGUOUS";
}

const scopeWeight: Record<LayoutCatalogEntry["scope"], number> = { ACCOUNT: 400, COMPANY: 300, BANK: 200, GLOBAL: 100 };

export function resolveLayout(input: ResolveLayoutInput): ResolvedLayout {
  const candidates = input.entries
    .filter((entry) => entry.profile.status !== "DEPRECATED" && entry.profile.formats.includes(input.fingerprint.format))
    .filter((entry) => !entry.bankAccountId || entry.bankAccountId === input.bankAccountId)
    .filter((entry) => !entry.companyId || entry.companyId === input.companyId)
    .filter((entry) => !entry.bankCode || entry.bankCode === input.bankCode)
    .map((entry) => ({ entry, score: scopeWeight[entry.scope] + (entry.fingerprintHash === input.fingerprint.fingerprintHash ? 50 : 0) - entry.priority }))
    .sort((left, right) => right.score - left.score || left.entry.profile.id.localeCompare(right.entry.profile.id));
  if (!candidates[0]) return { requiresMapping: true, reason: "NOT_FOUND" };
  if (candidates[1]?.score === candidates[0].score) return { requiresMapping: true, reason: "AMBIGUOUS" };
  return { entry: candidates[0].entry, requiresMapping: false };
}
