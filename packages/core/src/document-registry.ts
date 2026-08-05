import type { DocumentKind } from "./types.js";

export type ExtractedDocument = {
  fileId: string;
  originalName: string;
  text: string;
};

export type DetectionEvidence = {
  score: number;
  positiveSignatures: string[];
  negativeSignatures: string[];
  bankCode?: string;
  kind: DocumentKind;
};

export type BalanceEvidenceStrategy = "RUNNING_BALANCE_WHEN_AVAILABLE" | "FINAL_POSITION_ONLY" | "NOT_APPLICABLE";

export type FinancialDocumentAdapterContract = {
  readonly layoutFamily: string;
  readonly positiveSignatures: readonly string[];
  readonly negativeSignatures: readonly string[];
  readonly balanceEvidenceStrategy: BalanceEvidenceStrategy;
};

export type FinancialDocumentAdapter = {
  readonly id: string;
  readonly version: string;
  readonly kind: DocumentKind;
  readonly contract: FinancialDocumentAdapterContract;
  detect(input: ExtractedDocument): DetectionEvidence;
};

export type AdapterSelection =
  | { status: "SELECTED"; adapter: FinancialDocumentAdapter; evidence: DetectionEvidence; diagnostics: AdapterDiagnostic[] }
  | { status: "UNSUPPORTED"; diagnostics: AdapterDiagnostic[] }
  | { status: "AMBIGUOUS"; diagnostics: AdapterDiagnostic[] };

export type AdapterDiagnostic = {
  adapterId: string;
  version: string;
  evidence: DetectionEvidence;
};

export class FinancialDocumentAdapterRegistry {
  constructor(
    private readonly adapters: readonly FinancialDocumentAdapter[],
    private readonly minimumScore = 70,
    private readonly minimumMargin = 20,
  ) {}

  select(input: ExtractedDocument): AdapterSelection {
    const diagnostics = this.adapters
      .map((adapter) => ({ adapter, evidence: adapter.detect(input) }))
      .sort((left, right) => right.evidence.score - left.evidence.score || left.adapter.id.localeCompare(right.adapter.id));
    const diagnosticsView = diagnostics.map(({ adapter, evidence }) => ({ adapterId: adapter.id, version: adapter.version, evidence }));
    const first = diagnostics[0];
    if (!first || first.evidence.score < this.minimumScore || first.evidence.negativeSignatures.length > 0) {
      return { status: "UNSUPPORTED", diagnostics: diagnosticsView };
    }
    const second = diagnostics[1];
    if (second && first.evidence.score - second.evidence.score < this.minimumMargin) {
      return { status: "AMBIGUOUS", diagnostics: diagnosticsView };
    }
    return { status: "SELECTED", adapter: first.adapter, evidence: first.evidence, diagnostics: diagnosticsView };
  }
}

export function scoredEvidence(kind: DocumentKind, score: number, positiveSignatures: string[], negativeSignatures: string[] = [], bankCode?: string): DetectionEvidence {
  return { kind, score, positiveSignatures, negativeSignatures, ...(bankCode ? { bankCode } : {}) };
}

export function validateAdapterContract(adapter: FinancialDocumentAdapter): string[] {
  const violations: string[] = [];
  if (!adapter.id.trim()) violations.push("ADAPTER_ID_REQUIRED");
  if (!adapter.version.trim()) violations.push("ADAPTER_VERSION_REQUIRED");
  if (!adapter.contract.layoutFamily.trim()) violations.push("LAYOUT_FAMILY_REQUIRED");
  if (!adapter.contract.positiveSignatures.length) violations.push("POSITIVE_SIGNATURE_REQUIRED");
  const positives = new Set(adapter.contract.positiveSignatures.map((signature) => signature.trim().toUpperCase()));
  if (adapter.contract.negativeSignatures.some((signature) => positives.has(signature.trim().toUpperCase()))) violations.push("CONTRADICTORY_SIGNATURE");
  if (adapter.kind === "CURRENT_ACCOUNT" && adapter.contract.balanceEvidenceStrategy === "NOT_APPLICABLE") violations.push("CURRENT_ACCOUNT_BALANCE_STRATEGY_REQUIRED");
  return violations;
}
