export const resultStatuses = [
  "AUTO_MATCH_EXACT",
  "AUTO_MATCH_UNIQUE_VALUE",
  "AUTO_MATCH_DATE_TOLERANCE",
  "AUTO_MATCH_VALUE_DATE",
  "AUTO_MATCH_GROUP",
  "AUTO_MATCH_DAILY_TOTAL",
  "BANK_NET_ZERO",
  "AUTO_APPLICATION_EXCLUDED",
  "GROUP_SUGGESTION",
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
export type StatementClassification = Exclude<DocumentKind, "PASSWORD_PROTECTED" | "UNKNOWN">;
export type InvestmentEntryKind = "APPLICATION" | "REDEMPTION" | "EARNING" | "POSITION";
export type DecisionLevel = "AUTOMATIC" | "REVIEW_REQUIRED" | "BLOCKED";
export type BalanceMovementEffect = "ADDS_TO_BALANCE" | "SUBTRACTS_FROM_BALANCE";
export type SignProfile = "BANK_ASSET" | "BANK_LIABILITY" | "INVESTMENT_ASSET";

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
  runningBalance?: string;
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
  openingBalance?: string;
  closingBalance?: string;
  balanceCheck?: BalanceCheck;
  balanceMovementEffect?: BalanceMovementEffect;
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
  openingBalance?: string;
  closingBalance?: string;
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
  /**
   * Vínculos ativos do cadastro da empresa, anexados pelo adaptador da
   * aplicação após a leitura dos arquivos. Eles somente sugerem uma conta;
   * qualquer conflito continua exigindo escolha humana.
   */
  registeredAccountMappings?: RegisteredAccountMapping[];
  investments: InvestmentEntry[];
  issues: ImportIssue[];
  requiresUserInput: boolean;
};

export type RegisteredAccountMapping = {
  bank?: string;
  agency?: string;
  account?: string;
  ledgerAccount: string;
};

export type ConfirmProcessingRequest = {
  company: string;
  branch?: string;
  period: string;
  valueTolerance: string;
  dateToleranceDays: number;
  mappings: AccountMapping[];
  idempotencyKey: string;
  evaluatedAt?: string;
};

export type AccountMapping = {
  ledgerAccount: string;
  statementFileIds: string[];
  signProfile: SignProfile;
  /**
   * Contas físicas confirmadas explicitamente como parte do mesmo escopo
   * lógico nesta execução. Cada declaração é conferida novamente contra a
   * identidade extraída do extrato; ela nunca ignora uma divergência.
   */
  linkedPhysicalAccounts?: LinkedPhysicalAccount[];
};

export type LinkedPhysicalAccount = {
  statementFileId: string;
  bank: string;
  agency: string;
  account: string;
  role: "PRIMARY" | "LINKED";
};

export type ControlStatus = "PASSED" | "FAILED" | "NOT_AVAILABLE";

export type LineCoverageMetric = {
  covered: string;
  total: string;
  pending?: string;
  percentage: string;
  formula?: string;
  label?: string;
};

export type ValueCoverageMetric = {
  covered: string;
  total: string;
  pending?: string;
  percentage: string;
  formula?: string;
  label?: string;
};

export type CoverageBreakdown = {
  lines: LineCoverageMetric;
  absoluteValue: ValueCoverageMetric;
};

export type CoverageDimensions = {
  ledger: CoverageBreakdown;
  statementOperational: CoverageBreakdown;
  statementTotal: CoverageBreakdown;
  overallOperational: CoverageBreakdown;
};

export type ProcessingControls = {
  tolerance: string;
  signProfiles: SignProfile[];
  movements: {
    bankConciliable: string;
    ledger: string;
    difference: string;
    status: ControlStatus;
  };
  balances: {
    bankOpening?: string;
    ledgerOpening?: string;
    openingDifference?: string;
    openingStatus: ControlStatus;
    bankClosing?: string;
    ledgerClosing?: string;
    closingDifference?: string;
    closingStatus: ControlStatus;
  };
  coverage: {
    lines: LineCoverageMetric;
    absoluteValue: ValueCoverageMetric;
    ledger?: CoverageBreakdown;
    statementOperational?: CoverageBreakdown;
    statementTotal?: CoverageBreakdown;
    overallOperational?: CoverageBreakdown;
    statement?: CoverageBreakdown;
    operational?: CoverageBreakdown;
    overall?: CoverageBreakdown;
    /** Linhas reservadas por sugestões pendentes de aprovação humana. */
    suggested?: CoverageDimensions;
    /** Cobertura confirmada somada às sugestões, sem promovê-las a conciliadas. */
    potential?: CoverageDimensions;
  };
  countsByStatus: Array<{ status: ResultStatus; count: string }>;
  pendingByDate: Array<{
    date: string;
    bankCount: string;
    ledgerCount: string;
    bankValue: string;
    ledgerValue: string;
    difference: string;
  }>;
};

export type ReconciliationResult = {
  id: string;
  status: ResultStatus;
  rule: string;
  decisionLevel: DecisionLevel;
  reason: string;
  ledger?: LedgerRecord;
  statement?: StatementRecord;
  ledgers?: LedgerRecord[];
  statements?: StatementRecord[];
  candidates?: StatementRecord[];
  valueDifference?: string;
  dateDifference?: number;
  valueTolerance: string;
  ruleVersion?: string;
  score?: number;
  /** Grupo revisável criado quando o mesmo valor possui mais de um candidato. */
  ambiguityGroup?: AmbiguityGroup;
  matchGroup?: import("./reconciliation/domain/ReconciliationEngine.js").ReconciliationMatchGroup;
  audit?: import("./reconciliation/domain/ReconciliationEngine.js").ReconciliationAuditEntry;
};

export type AmbiguityGroup = {
  id: string;
  ledgerAccount: string;
  amount: string;
  ledgerCandidateIds: string[];
  statementCandidateIds: string[];
  reason: string;
  evaluatedAt: string;
};

export type AccountSummary = {
  ledgerAccount: string;
  statementAccounts: string[];
  ledgerBalance: string;
  statementBalance: string;
  balanceDifference: string;
  reconciledCount: number;
  reconciledValue: string;
  suggestedGroupCount?: number;
  suggestedLedgerCount?: number;
  suggestedStatementCount?: number;
  divergenceCount: number;
  ledgerWithoutStatementCount: number;
  statementWithoutLedgerCount: number;
  ambiguityCount: number;
  duplicateCount: number;
  status: "CONCILIADA" | "COM_DIVERGENCIAS";
};

export type ProcessingResult = {
  resultSchemaVersion?: "2.0";
  company: string;
  branch: string;
  period: string;
  executedAt: string;
  summaries: AccountSummary[];
  results: ReconciliationResult[];
  issues: ImportIssue[];
  files: DetectedStatement[];
  investments: InvestmentEntry[];
  controls: ProcessingControls;
  reconciliation?: {
    ruleVersion: string;
    evaluatedAt: string;
    transactions: import("./reconciliation/domain/ReconciliationEngine.js").SerializedReconciliationTransaction[];
    matchGroups: import("./reconciliation/domain/ReconciliationEngine.js").ReconciliationMatchGroup[];
    audit: import("./reconciliation/domain/ReconciliationEngine.js").ReconciliationAuditEntry[];
    metrics: import("./reconciliation/domain/ReconciliationEngine.js").ReconciliationMetrics;
  };
};
