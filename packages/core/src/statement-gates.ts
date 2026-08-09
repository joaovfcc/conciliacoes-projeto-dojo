import Decimal from "decimal.js";

import {
  createSourceProvenance,
  isReconciliationEligibleDocumentType,
  type CanonicalBankTransaction,
  type CanonicalStatementDocument,
  type SourceExtractionMethod,
  type StatementSourceFormat,
  type StatementSourceValidation,
} from "./statement-sources.js";
import type { ParsedFinancialDocument } from "./types.js";

export type StatementGateCode =
  | "SOURCE_SUPPORTED"
  | "DOCUMENT_TYPE_ELIGIBLE"
  | "IDENTITY"
  | "PERIOD"
  | "STRUCTURAL_COMPLETENESS"
  | "SIGNS"
  | "DUPLICATES"
  | "BALANCE"
  | "MAPPING"
  | "CROSSCHECK";

export type StatementGateStatus = "PASSED" | "REVIEW_REQUIRED" | "FAILED" | "NOT_APPLICABLE";

export type StatementGateResult = {
  code: StatementGateCode;
  status: StatementGateStatus;
  issueCodes: readonly string[];
};

export type StatementQualityDecision = "AUTOMATIC" | "REVIEW_REQUIRED" | "BLOCKED" | "INFORMATIONAL";

export type StatementQualityResult = {
  decision: StatementQualityDecision;
  reconciliationEligible: boolean;
  gates: readonly StatementGateResult[];
};

export type StatementQualityGateInput = {
  document?: CanonicalStatementDocument;
  sourceSupported: boolean;
  adapterValidation?: StatementSourceValidation;
  mappingStatus: "CONFIRMED" | "PENDING" | "NOT_REQUIRED";
  crosscheckStatus: "PASSED" | "FAILED" | "NOT_PROVIDED";
  expectedIdentity?: {
    bankCode?: string;
    agency?: string;
    account?: string;
  };
};

export function runStatementQualityGates(input: StatementQualityGateInput): StatementQualityResult {
  const document = input.document;
  const gates: StatementGateResult[] = [
    gate("SOURCE_SUPPORTED", input.sourceSupported && Boolean(document) ? "PASSED" : "FAILED", input.sourceSupported && document ? [] : ["SOURCE_UNSUPPORTED"]),
  ];
  if (!document) {
    gates.push(...notApplicableGates([
      "DOCUMENT_TYPE_ELIGIBLE",
      "IDENTITY",
      "PERIOD",
      "STRUCTURAL_COMPLETENESS",
      "SIGNS",
      "DUPLICATES",
      "BALANCE",
      "MAPPING",
      "CROSSCHECK",
    ]));
    return { decision: "BLOCKED", reconciliationEligible: false, gates };
  }

  const eligibleType = isReconciliationEligibleDocumentType(document.documentType);
  gates.push(gate("DOCUMENT_TYPE_ELIGIBLE", eligibleType ? "PASSED" : "NOT_APPLICABLE", eligibleType ? [] : ["DOCUMENT_INFORMATIONAL_ONLY"]));
  gates.push(identityGate(document, input.expectedIdentity));
  gates.push(periodGate(document));
  gates.push(structuralGate(document, input.adapterValidation));
  gates.push(signGate(document.transactions));
  gates.push(duplicateGate(document.transactions));
  gates.push(balanceGate(document, eligibleType));
  gates.push(mappingGate(input.mappingStatus, eligibleType));
  gates.push(crosscheckGate(input.crosscheckStatus));

  const hasFailure = gates.some((item) => item.status === "FAILED");
  const needsReview = gates.some((item) => item.status === "REVIEW_REQUIRED");
  const decision: StatementQualityDecision = hasFailure
    ? "BLOCKED"
    : !eligibleType
      ? "INFORMATIONAL"
      : needsReview
        ? "REVIEW_REQUIRED"
        : "AUTOMATIC";
  return { decision, reconciliationEligible: eligibleType && !hasFailure, gates };
}

export function canonicalFromParsedFinancialDocument(
  parsed: ParsedFinancialDocument,
  options: {
    format: StatementSourceFormat;
    institutionCode: string;
    sourceSha256: string;
    declaresNoMovements?: boolean;
  },
): CanonicalStatementDocument {
  const transactions = parsed.movements.map<CanonicalBankTransaction>((movement) => {
    const amount = new Decimal(movement.amount);
    return {
      transactionId: movement.id,
      postingDate: movement.postingDate,
      amount: amount.toFixed(2),
      direction: amount.isNegative() ? "DEBIT" : "CREDIT",
      description: movement.history,
      ...(movement.document ? { documentNumber: movement.document } : {}),
      ...(movement.runningBalance ? { runningBalance: movement.runningBalance } : {}),
      provenance: createSourceProvenance({
        sourceId: movement.sourceId ?? parsed.fileId,
        format: options.format,
        adapterId: parsed.parserId,
        adapterVersion: parsed.parserVersion,
        rawHash: options.sourceSha256,
        extractionMethod: canonicalExtractionMethod(options.format, movement.evidence.extractionMethod),
        ...(movement.evidence.page ? { page: movement.evidence.page } : {}),
        ...(movement.evidence.line ? { row: movement.evidence.line } : {}),
      }),
    };
  });
  return {
    sourceId: parsed.fileId,
    format: options.format,
    institutionCode: options.institutionCode,
    documentType: parsed.kind,
    layoutFamily: parsed.parserId,
    adapterId: parsed.parserId,
    adapterVersion: parsed.parserVersion,
    identity: parsed.identity,
    ...(parsed.period ? { period: parsed.period } : {}),
    transactions,
    ...(options.declaresNoMovements !== undefined ? { declaresNoMovements: options.declaresNoMovements } : {}),
    ...(parsed.openingBalance ? { openingBalance: parsed.openingBalance } : {}),
    ...(parsed.closingBalance ? { closingBalance: parsed.closingBalance } : {}),
    issues: parsed.issues,
  };
}

function identityGate(
  document: CanonicalStatementDocument,
  expected: StatementQualityGateInput["expectedIdentity"],
): StatementGateResult {
  if (!document.identity.bankName.trim()) return gate("IDENTITY", "FAILED", ["BANK_IDENTITY_MISSING"]);
  if (isReconciliationEligibleDocumentType(document.documentType)
    && (!document.identity.agency?.normalized || !document.identity.account?.normalized)) {
    return gate("IDENTITY", "REVIEW_REQUIRED", ["BANK_ACCOUNT_CONFIRMATION_REQUIRED"]);
  }
  if (expected) {
    const mismatches = [
      identityMismatch(expected.account, document.identity.account?.normalized),
      identityMismatch(expected.agency, document.identity.agency?.normalized),
      identityMismatch(expected.bankCode, document.institutionCode),
    ];
    if (mismatches.some(Boolean)) return gate("IDENTITY", "FAILED", ["BANK_ACCOUNT_IDENTITY_MISMATCH"]);
  }
  return gate("IDENTITY", "PASSED");
}

function identityMismatch(expected: string | undefined, actual: string | undefined): boolean {
  if (!expected || !actual || actual === "UNCONFIRMED") return false;
  const normalize = (value: string) => {
    const compact = value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return /^\d+$/.test(compact) ? compact.replace(/^0+(?=\d)/, "") : compact;
  };
  return normalize(expected) !== normalize(actual);
}

function periodGate(document: CanonicalStatementDocument): StatementGateResult {
  if (!document.period) return gate("PERIOD", "REVIEW_REQUIRED", ["STATEMENT_PERIOD_CONFIRMATION_REQUIRED"]);
  if (!isIsoDate(document.period.start) || !isIsoDate(document.period.end) || document.period.start > document.period.end) {
    return gate("PERIOD", "FAILED", ["STATEMENT_PERIOD_INVALID"]);
  }
  if (document.transactions.some((transaction) => transaction.postingDate < document.period!.start || transaction.postingDate > document.period!.end)) {
    return gate("PERIOD", "FAILED", ["TRANSACTION_OUTSIDE_STATEMENT_PERIOD"]);
  }
  return gate("PERIOD", "PASSED");
}

function structuralGate(
  document: CanonicalStatementDocument,
  adapterValidation: StatementSourceValidation | undefined,
): StatementGateResult {
  const errorCodes = [
    ...document.issues.filter((issue) => issue.severity === "ERROR").map((issue) => issue.code),
    ...(adapterValidation?.accepted === false
      ? adapterValidation.issues.filter((issue) => issue.severity === "ERROR").map((issue) => issue.code)
      : []),
  ];
  if (errorCodes.length) return gate("STRUCTURAL_COMPLETENESS", "FAILED", errorCodes);
  if (isReconciliationEligibleDocumentType(document.documentType)
    && document.transactions.length === 0
    && !document.declaresNoMovements) {
    return gate("STRUCTURAL_COMPLETENESS", "FAILED", ["STATEMENT_MOVEMENTS_NOT_EXTRACTED"]);
  }
  return gate("STRUCTURAL_COMPLETENESS", "PASSED");
}

function signGate(transactions: readonly CanonicalBankTransaction[]): StatementGateResult {
  try {
    const invalid = transactions.some((transaction) => {
      const amount = new Decimal(transaction.amount);
      return amount.isZero()
        || (transaction.direction === "DEBIT" && !amount.isNegative())
        || (transaction.direction === "CREDIT" && !amount.isPositive());
    });
    return invalid ? gate("SIGNS", "FAILED", ["TRANSACTION_SIGN_INCONSISTENT"]) : gate("SIGNS", "PASSED");
  } catch {
    return gate("SIGNS", "FAILED", ["TRANSACTION_AMOUNT_INVALID"]);
  }
}

function duplicateGate(transactions: readonly CanonicalBankTransaction[]): StatementGateResult {
  const ids = transactions.map((transaction) => transaction.transactionId);
  if (new Set(ids).size !== ids.length) return gate("DUPLICATES", "FAILED", ["TRANSACTION_ID_DUPLICATE"]);
  let signatures: string[];
  try {
    signatures = transactions.map(transactionSignature);
  } catch {
    return gate("DUPLICATES", "FAILED", ["TRANSACTION_AMOUNT_INVALID"]);
  }
  if (new Set(signatures).size !== signatures.length) {
    return gate("DUPLICATES", "REVIEW_REQUIRED", ["POSSIBLE_DUPLICATE_SOURCE_TRANSACTION"]);
  }
  return gate("DUPLICATES", "PASSED");
}

function balanceGate(document: CanonicalStatementDocument, eligibleType: boolean): StatementGateResult {
  if (!eligibleType) return gate("BALANCE", "NOT_APPLICABLE");
  if (document.transactions.length === 0 && document.declaresNoMovements) return gate("BALANCE", "PASSED");
  if (document.openingBalance === undefined || document.closingBalance === undefined) {
    return gate("BALANCE", "REVIEW_REQUIRED", ["BALANCE_CONTROL_NOT_AVAILABLE"]);
  }
  try {
    const expected = document.transactions.reduce(
      (current, transaction) => current.plus(new Decimal(transaction.amount)),
      new Decimal(document.openingBalance),
    );
    return expected.equals(new Decimal(document.closingBalance))
      ? gate("BALANCE", "PASSED")
      : gate("BALANCE", "FAILED", ["BALANCE_INTEGRITY_FAILED"]);
  } catch {
    return gate("BALANCE", "FAILED", ["BALANCE_VALUE_INVALID"]);
  }
}

function mappingGate(status: StatementQualityGateInput["mappingStatus"], eligibleType: boolean): StatementGateResult {
  if (!eligibleType) return gate("MAPPING", "NOT_APPLICABLE");
  if (status === "CONFIRMED") return gate("MAPPING", "PASSED");
  if (status === "PENDING") return gate("MAPPING", "REVIEW_REQUIRED", ["LEDGER_ACCOUNT_MAPPING_MISSING"]);
  return gate("MAPPING", "FAILED", ["CURRENT_ACCOUNT_MAPPING_REQUIRED"]);
}

function crosscheckGate(status: StatementQualityGateInput["crosscheckStatus"]): StatementGateResult {
  if (status === "NOT_PROVIDED") return gate("CROSSCHECK", "NOT_APPLICABLE");
  return status === "PASSED"
    ? gate("CROSSCHECK", "PASSED")
    : gate("CROSSCHECK", "FAILED", ["SOURCE_CROSSCHECK_FAILED"]);
}

function transactionSignature(transaction: CanonicalBankTransaction): string {
  return [
    transaction.postingDate,
    new Decimal(transaction.amount).toFixed(2),
    transaction.documentNumber?.trim() ?? "",
    transaction.description.trim().toUpperCase(),
  ].join("|");
}

function canonicalExtractionMethod(format: StatementSourceFormat, current: string): SourceExtractionMethod {
  if (format === "CSV") return "CSV";
  if (format === "OFX") return "OFX";
  if (["XLSX", "XLS", "XLSM"].includes(format)) return "TABULAR";
  if (current === "OCR" || current === "MIXED") return current;
  return "TEXT";
}

function gate(code: StatementGateCode, status: StatementGateStatus, issueCodes: readonly string[] = []): StatementGateResult {
  return { code, status, issueCodes: [...new Set(issueCodes)].sort() };
}

function notApplicableGates(codes: readonly StatementGateCode[]): StatementGateResult[] {
  return codes.map((code) => gate(code, "NOT_APPLICABLE"));
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
