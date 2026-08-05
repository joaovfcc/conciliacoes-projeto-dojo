export const resultStatuses = [
  "AUTO_MATCH_EXACT",
  "AUTO_MATCH_DATE_TOLERANCE",
  "AUTO_MATCH_VALUE_DATE",
  "VALUE_ONLY_SUGGESTION",
  "VALUE_DIVERGENCE",
  "DATE_DIVERGENCE",
  "LEDGER_WITHOUT_STATEMENT",
  "STATEMENT_WITHOUT_LEDGER",
  "AMBIGUOUS_MATCH",
  "POSSIBLE_DUPLICATE",
] as const;

export type ResultStatus = (typeof resultStatuses)[number];
export type SourceKind = "LEDGER" | "STATEMENT";
export type ExtractionMethod = "TEXT" | "OCR" | "MIXED" | "TABULAR" | "OFX";
export type DocumentKind =
  | "CURRENT_ACCOUNT"
  | "INVESTMENT_ACTIVITY"
  | "INVESTMENT_POSITION"
  | "FUND_STATEMENT"
  | "STRUCTURED_PRODUCT_POSITION"
  | "BROKERAGE_NOTE"
  | "PASSWORD_PROTECTED"
  | "UNKNOWN";
export type StatementClassification = Extract<DocumentKind, "CURRENT_ACCOUNT" | "INVESTMENT_ACTIVITY" | "INVESTMENT_POSITION">;
export type InvestmentEntryKind = "APPLICATION" | "REDEMPTION" | "EARNING" | "POSITION";
export type DecisionLevel = "AUTOMATIC" | "REVIEW_REQUIRED" | "BLOCKED";

export type NormalizedIdentifier = {
  raw: string;
  normalized: string;
};

export type BankIdentity = {
  bankCode?: string;
  bankName: string;
  agency?: NormalizedIdentifier;
  account?: NormalizedIdentifier;
  accountDigit?: string;
};

export type BalanceCheck = {
  status: "PASSED" | "FAILED" | "NOT_AVAILABLE";
  openingBalance?: string;
  creditTotal: string;
  debitTotal: string;
  movementTotal: string;
  expectedClosingBalance?: string;
  extractedClosingBalance?: string;
  difference?: string;
  tolerance: string;
};

export type ImportIssue = {
  severity: "WARNING" | "ERROR";
  code: string;
  message: string;
  fileId?: string;
  sourcePosition?: string;
  guidance?: string;
};

export type SourceEvidence = {
  fileId: string;
  originalName: string;
  line?: number;
  page?: number;
  sourceText?: string;
  extractionMethod: ExtractionMethod;
  parser?: string;
  parserVersion?: string;
  confidence?: string;
};

export type LedgerRecord = {
  id: string;
  company: string;
  branch: string;
  ledgerAccount: string;
  date: string;
  document: string;
  history: string;
  value: string;
  sourceId: string;
  evidence: SourceEvidence;
};

export type StatementRecord = {
  id: string;
  bank: string;
  agency: string;
  bankAccount: string;
  date: string;
  document: string;
  history: string;
  value: string;
  runningBalance?: string;
  sourceId: string;
  evidence: SourceEvidence;
};

export type BankMovement = {
  id: string;
  bankIdentity: BankIdentity;
  postingDate: string;
  document?: string;
  history: string;
  amount: string;
  runningBalance?: string;
  sourceId?: string;
  evidence: SourceEvidence;
};

export type ParsedFinancialDocument = {
  fileId: string;
  kind: DocumentKind;
  identity: BankIdentity;
  period?: { start: string; end: string };
  movements: BankMovement[];
  openingBalance?: string;
  closingBalance?: string;
  balanceCheck: BalanceCheck;
  suspectedTransactionRows: number;
  parsedTransactionRows: number;
  issues: ImportIssue[];
  parserId: string;
  parserVersion: string;
};

export type DetectedLedgerAccount = {
  account: string;
  company: string;
  branch: string;
  bank: string;
  agency: string;
  bankAccount: string;
  recordCount: number;
};

export type DetectedStatement = {
  fileId: string;
  originalName: string;
  bank: string;
  agency: string;
  account: string;
  periods: string[];
  recordCount: number;
  extractionMethod: ExtractionMethod;
  parser: string;
  classification: StatementClassification;
  reconciliationEligible: boolean;
  finalBalance?: string;
  balanceCheck?: BalanceCheck;
  confidence?: string;
};

export type InvestmentEntry = {
  id: string;
  fileId: string;
  originalName: string;
  bank: string;
  agency: string;
  account: string;
  date?: string;
  kind: InvestmentEntryKind;
  amount: string;
  description: string;
  evidence: SourceEvidence;
};

export type PreflightResult = {
  companies: string[];
  branches: string[];
  detectedPeriods: Array<{ period: string; recordCount: number }>;
  ledgerAccounts: DetectedLedgerAccount[];
  statements: DetectedStatement[];
  investments: InvestmentEntry[];
  issues: ImportIssue[];
  requiresUserInput: boolean;
};

export type ConfirmProcessingRequest = {
  company: string;
  branch?: string;
  period: string;
  valueTolerance: string;
  dateToleranceDays: number;
  mappings: AccountMapping[];
  idempotencyKey: string;
};

export type AccountMapping = {
  ledgerAccount: string;
  statementFileIds: string[];
  signProfile: "BANK_ASSET" | "BANK_LIABILITY" | "INVESTMENT_ASSET";
};

export type ReconciliationResult = {
  id: string;
  status: ResultStatus;
  rule: string;
  decisionLevel: DecisionLevel;
  reason: string;
  ledger?: LedgerRecord;
  statement?: StatementRecord;
  candidates?: StatementRecord[];
  valueDifference?: string;
  dateDifference?: number;
  valueTolerance: string;
};

export type AccountSummary = {
  ledgerAccount: string;
  statementAccounts: string[];
  ledgerBalance: string;
  statementBalance: string;
  balanceDifference: string;
  reconciledCount: number;
  reconciledValue: string;
  divergenceCount: number;
  ledgerWithoutStatementCount: number;
  statementWithoutLedgerCount: number;
  ambiguityCount: number;
  duplicateCount: number;
  status: "CONCILIADA" | "COM_DIVERGENCIAS";
};

export type ProcessingResult = {
  company: string;
  branch: string;
  period: string;
  executedAt: string;
  summaries: AccountSummary[];
  results: ReconciliationResult[];
  issues: ImportIssue[];
  files: DetectedStatement[];
  investments: InvestmentEntry[];
};
