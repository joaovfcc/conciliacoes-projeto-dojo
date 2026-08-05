import { createHash } from "node:crypto";

import type { DocumentKind } from "./types.js";

export type PrivateCorpusState =
  | "PARSED_AWAITING_ORACLE"
  | "PARSED_WITH_INTEGRITY_ERROR"
  | "AWAITING_OCR"
  | "UNSUPPORTED_LAYOUT"
  | "AMBIGUOUS_CLASSIFICATION"
  | "PASSWORD_PROTECTED"
  | "INVALID_FILE";

export type PrivateCorpusOutcome = {
  state: PrivateCorpusState;
  sourceInstitution?: string;
  bank?: string;
  classification?: DocumentKind;
  adapterId?: string;
  adapterVersion?: string;
  recordCount: number;
  issueCodes: string[];
};

export type PrivateCorpusRecord = PrivateCorpusOutcome & {
  documentId: string;
  sha256: string;
  extension: string;
};

export type PrivateCorpusSummary = {
  totalDocuments: number;
  byState: Record<string, number>;
  bySourceInstitution: Record<string, number>;
  byBank: Record<string, number>;
  byClassification: Record<string, number>;
  byAdapter: Record<string, number>;
};

export function createPrivateCorpusRecord(input: { originalName: string; buffer: Buffer; outcome: PrivateCorpusOutcome }): PrivateCorpusRecord {
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  return {
    documentId: `document-${sha256.slice(0, 16)}`,
    sha256,
    extension: extensionOf(input.originalName),
    state: input.outcome.state,
    ...(input.outcome.sourceInstitution ? { sourceInstitution: input.outcome.sourceInstitution } : {}),
    ...(input.outcome.bank ? { bank: input.outcome.bank } : {}),
    ...(input.outcome.classification ? { classification: input.outcome.classification } : {}),
    ...(input.outcome.adapterId ? { adapterId: input.outcome.adapterId } : {}),
    ...(input.outcome.adapterVersion ? { adapterVersion: input.outcome.adapterVersion } : {}),
    recordCount: input.outcome.recordCount,
    issueCodes: [...new Set(input.outcome.issueCodes)].sort(),
  };
}

export function summarizePrivateCorpus(records: readonly PrivateCorpusRecord[]): PrivateCorpusSummary {
  return {
    totalDocuments: records.length,
    byState: countBy(records, (record) => record.state),
    bySourceInstitution: countBy(records, (record) => record.sourceInstitution || "UNKNOWN"),
    byBank: countBy(records, (record) => record.bank || "UNKNOWN"),
    byClassification: countBy(records, (record) => record.classification || "UNKNOWN"),
    byAdapter: countBy(records, (record) => record.adapterId || "UNKNOWN"),
  };
}

export function institutionHintFromOriginalName(name: string): string | undefined {
  const normalized = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  const hints: Array<[RegExp, string]> = [
    [/\bABC\b/, "ABC_BRASIL"],
    [/\b(?:BANCO\s+DO\s+BRASIL|BB)\b/, "BANCO_DO_BRASIL"],
    [/\bBMG\b/, "BMG"],
    [/\bBMP\b/, "BMP"],
    [/\bBOCOM\b/, "BOCOM"],
    [/\bBRADESCO\b/, "BRADESCO"],
    [/\bBRB\b/, "BRB"],
    [/\b(?:CEF|CAIXA)\b/, "CAIXA"],
    [/\bDAYCOVAL\b/, "DAYCOVAL"],
    [/\bGUANABARA\b/, "GUANABARA"],
    [/\bITAU\b/, "ITAU"],
    [/\bPAULISTA\b/, "PAULISTA"],
    [/\bPINE\b/, "PINE"],
    [/\bPLANNER\b/, "PLANNER"],
    [/\bSAFRA\b/, "SAFRA"],
    [/\bSANTANDER\b/, "SANTANDER"],
    [/\bSOFISA\b/, "SOFISA"],
    [/\b(?:VORTX|ACREDITAR)\b/, "VORTX"],
  ];
  return hints.find(([pattern]) => pattern.test(normalized))?.[1];
}

function countBy(records: readonly PrivateCorpusRecord[], key: (record: PrivateCorpusRecord) => string): Record<string, number> {
  const counts = records.reduce((current, record) => {
    const value = key(record);
    current.set(value, (current.get(value) ?? 0) + 1);
    return current;
  }, new Map<string, number>());
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function extensionOf(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return extension || "unknown";
}
