import { createHash } from "node:crypto";
import { normalizeDocumentId } from "../../normalization.js";

export const RECONCILIATION_RULE_VERSION = "1.0" as const;

export const DEFAULT_GENERIC_WORDS = [
  "A", "AS", "DE", "DA", "DO", "DAS", "DOS", "E", "EM", "PARA", "POR", "COM", "LTDA", "SA", "S",
  "PAGAMENTO", "PAGAMENTOS", "FORNECEDOR", "FORNECEDORES", "BAIXA", "TIT", "MOV", "BANCARIO", "PGTO",
  "ITAU", "SISPAG", "PIX", "TED", "DOC", "CREDITO", "DEBITO", "TRANSF", "TRANSFERENCIA", "25", "341",
] as const;

export interface ReconciliationConfigurationV1 {
  version: typeof RECONCILIATION_RULE_VERSION;
  genericWords: readonly string[];
  dateWindowDays: 3;
  rf03: { minimumScore: 0.34; minimumMargin: 0.15 };
  rf06: {
    minimumScore: 0.3;
    minimumMargin: 0.12;
    sharedNumericTokenBonus: 0.75;
    allLinesNumericTokenBonus: 1.5;
  };
  maxCombinationsPerAnchor: 100;
  automaticApplicationPattern: string;
}

export const RECONCILIATION_CONFIGURATION_V1: ReconciliationConfigurationV1 = Object.freeze({
  version: RECONCILIATION_RULE_VERSION,
  genericWords: Object.freeze([...DEFAULT_GENERIC_WORDS]),
  dateWindowDays: 3,
  rf03: Object.freeze({ minimumScore: 0.34, minimumMargin: 0.15 }),
  rf06: Object.freeze({
    minimumScore: 0.3,
    minimumMargin: 0.12,
    sharedNumericTokenBonus: 0.75,
    allLinesNumericTokenBonus: 1.5,
  }),
  maxCombinationsPerAnchor: 100,
  automaticApplicationPattern: "^(APL|RES)\\s+APLIC\\s+AUT|.*CONTAMAX.*|^(?:APLICACAO|APLIC|RESGATE|RESG)\\s+(?:AUT|AUTOMATICA|AUTOMATICO)\\b",
});

export type ReconciliationSource = "BANK" | "LEDGER";
export type ReconciliationStatus =
  | "RECONCILED_EXACT"
  | "RECONCILED_DATE_WINDOW"
  | "RECONCILED_GROUP"
  | "RECONCILED_DAILY_TOTAL"
  | "BANK_NET_ZERO"
  | "EXCLUDED_AUTO_APPLICATION"
  | "BANK_ONLY"
  | "LEDGER_ONLY";

export interface ReconciliationEvidence {
  fileId: string;
  originalName?: string;
  line?: number;
  page?: number;
  sourceText?: string;
  [key: string]: unknown;
}

export interface ReconciliationTransaction {
  id: string;
  importBatchId: string;
  source: ReconciliationSource;
  accountId: string;
  currency: "BRL";
  sourceRow: number;
  postingDate: string;
  amountCents: bigint;
  description: string;
  normalizedDescription?: string;
  tokens?: readonly string[];
  documentId?: string;
  originCode?: string;
  counterparty?: string;
  counterpart?: string;
  taxId?: string;
  ledgerCounterpartAccount?: string;
  evidence: ReconciliationEvidence;
  metadata?: Record<string, unknown>;
}

export type MatchRuleId = "RF-01" | "RF-02" | "RF-03" | "RF-04" | "RF-05" | "RF-07" | "RF-08" | "RF-09";
export type MatchGroupType = "exact" | "date-window" | "one-to-many" | "many-to-one" | "daily-total" | "bank-net-zero";

export interface SerializedReconciliationTransaction extends Omit<ReconciliationTransaction, "amountCents" | "tokens"> {
  amountCents: string;
  normalizedDescription: string;
  tokens: string[];
  status: ReconciliationStatus;
  matchGroupId?: string;
}

export interface ReconciliationMatchGroup {
  id: string;
  ruleId: MatchRuleId;
  ruleVersion: typeof RECONCILIATION_RULE_VERSION;
  type: MatchGroupType;
  bankTransactionIds: string[];
  ledgerTransactionIds: string[];
  bankTotalCents: string;
  ledgerTotalCents: string;
  differenceCents: string;
  score?: number;
  status: "automatic" | "suggested" | "approved" | "rejected";
  reviewedAt?: string;
  reviewedBy?: string;
  evaluatedAt: string;
}

export interface ReconciliationAuditEntry {
  id: string;
  ruleId: MatchRuleId;
  ruleVersion: typeof RECONCILIATION_RULE_VERSION;
  transactionIds: string[];
  bankTransactionIds: string[];
  ledgerTransactionIds: string[];
  bankTotalCents: string;
  ledgerTotalCents: string;
  differenceCents: string;
  score?: number;
  outcome: ReconciliationStatus;
  evaluatedAt: string;
}

export interface ReconciliationMetrics {
  combinationsEvaluated: number;
  combinationsEvaluatedByAnchor: Record<string, number>;
  rf03SignatureGroupsEvaluated?: number;
}

export interface ReconciliationEngineOutput {
  ruleVersion: typeof RECONCILIATION_RULE_VERSION;
  evaluatedAt: string;
  transactions: SerializedReconciliationTransaction[];
  matchGroups: ReconciliationMatchGroup[];
  audit: ReconciliationAuditEntry[];
  metrics: ReconciliationMetrics;
}

export interface ReconciliationEngineOptions {
  evaluatedAt?: string;
  configuration?: ReconciliationConfigurationV1;
  descriptionSimilarityThreshold?: number;
  allowOneToMany?: boolean;
  allowManyToOne?: boolean;
  allowManyToMany?: boolean;
  maxGroupSize?: number;
  collectPerformanceMetrics?: boolean;
}

type PreparedTransaction = ReconciliationTransaction & {
  normalizedDescription: string;
  tokens: string[];
  comparisonTokens: string[];
};

type GroupCandidate = {
  members: [PreparedTransaction, PreparedTransaction];
  score: number;
};

const EPOCH = "1970-01-01T00:00:00.000Z";
const DAY_MS = 86_400_000;

export const SEMANTIC_CATEGORY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  {
    category: "PAYMENT_TITLE",
    pattern: /\b(?:PGTO|PAGTO|PAGAMENTO|PAGAMENTOS|BAIXA\s+TIT|BAIXA\s+TITULO|BAIXA\s+DE\s+TITULO|LIQ\s+TIT|LIQUIDACAO\s+TITULO|LIQ\s+TITULOS|LIQUIDACAO\s+TITULOS|SISPAG)\b/i,
  },
  {
    category: "BANK_FEE",
    pattern: /\b(?:TAR\s+BANC|TARIFA\s+BANCARIA|TAR\s+BANCARIA|DESP\s+BANC|DESPESA\s+BANCARIA|TARIFA\s+MENSALIDADE|MANUTENCAO\s+CONV|MANUT\s+CTA)\b/i,
  },
  {
    category: "TRANSFER",
    pattern: /\b(?:TRANSF|TRANSFERENCIA|TED|DOC|PIX\s+TRANSF|PIX\s+TRANSF\s+ENVIADA|PIX\s+ENVIADO)\b/i,
  },
  {
    category: "INCOMING_TRANSFER",
    pattern: /\b(?:PIX\s+RECEBIDO|REC\s+PIX|TRANSF\s+RECEBIDA|TED\s+RECEBIDA|DOC\s+RECEBIDO)\b/i,
  },
];

export const BANK_HINT_PATTERNS: Array<{ bank: string; pattern: RegExp }> = [
  { bank: "ITAU", pattern: /\b(?:ITAU|UNIBANCO|ITAUUNIBANCO|341)\b/i },
  { bank: "SANTANDER", pattern: /\b(?:SANTANDER|BANCO\s+SANTANDER|033)\b/i },
  { bank: "BRADESCO", pattern: /\b(?:BRADESCO|BRADESCO\s+BANK|237)\b/i },
  { bank: "BANCO_DO_BRASIL", pattern: /\b(?:BANCO\s+DO\s+BRASIL|BCO\s+BRASIL|BBRASIL|001)\b/i },
  { bank: "CAIXA", pattern: /\b(?:CAIXA|CEF|CAIXA\s+ECONOMICA|104)\b/i },
  { bank: "SAFRA", pattern: /\b(?:SAFRA|BANCO\s+SAFRA|422)\b/i },
  { bank: "DAYCOVAL", pattern: /\b(?:DAYCOVAL|BANCO\s+DAYCOVAL|707)\b/i },
  { bank: "BTG", pattern: /\b(?:BTG|BTG\s+PACTUAL|208)\b/i },
  { bank: "SICOOB", pattern: /\b(?:SICOOB|BANCOOB|756)\b/i },
  { bank: "SICREDI", pattern: /\b(?:SICREDI|748)\b/i },
  { bank: "INTER", pattern: /\b(?:BANCO\s+INTER|077)\b/i },
  { bank: "C6", pattern: /\b(?:C6|C6\s+BANK|336)\b/i },
  { bank: "NUBANK", pattern: /\b(?:NUBANK|NU\s+PAGAMENTOS|260)\b/i },
  { bank: "BRB", pattern: /\b(?:BRB|BANCO\s+DE\s+BRASILIA|070)\b/i },
];

export function extractBankHint(text: string): string | undefined {
  const normalized = normalizeCharacters(text);
  for (const { bank, pattern } of BANK_HINT_PATTERNS) {
    if (pattern.test(normalized)) return bank;
  }
  return undefined;
}

export type FinancialHint = {
  bankHint?: string;
  semanticCategory?: string;
  documentId?: string;
  comparisonTokens: string[];
};

export function extractFinancialHint(
  text: string,
  documentId?: string,
  genericWords: readonly string[] = DEFAULT_GENERIC_WORDS,
): FinancialHint {
  const bankHint = extractBankHint(text);
  const semanticCategories = extractSemanticCategories(text);
  const semanticCategory = semanticCategories[0];
  const wordTokens = normalizeReconciliationText(text, genericWords);
  const docTokens = documentId ? [documentId] : [];
  const bankTokens = bankHint ? [bankHint] : [];
  const comparisonTokens = [
    ...new Set([...semanticCategories, ...bankTokens, ...docTokens, ...wordTokens]),
  ];
  return {
    ...(bankHint ? { bankHint } : {}),
    ...(semanticCategory ? { semanticCategory } : {}),
    ...(documentId ? { documentId } : {}),
    comparisonTokens,
  };
}

export interface CandidateScoreBreakdown {
  dateExact: number;
  dateTolerance: number;
  amountExact: number;
  signedAmountCompatible: number;
  documentExact: number;
  documentNormalized: number;
  semanticCategory: number;
  bankHint: number;
  descriptionSimilarity: number;
  ambiguityPenalty: number;
  total: number;
  decision: "MATCH" | "AMBIGUOUS" | "REJECT";
  evidence: string[];
}

export interface CandidateScoringInput {
  statementDate: string;
  ledgerDate: string;
  statementAmountCents: bigint;
  ledgerAmountCents: bigint;
  statementDescription: string;
  ledgerHistory: string;
  statementDocument?: string;
  ledgerDocument?: string;
  dateToleranceDays?: number;
  hasAmbiguity?: boolean;
}

export function calculateCandidateScore(input: CandidateScoringInput): CandidateScoreBreakdown {
  const dateTolerance = input.dateToleranceDays ?? 2;
  const evidence: string[] = [];

  // 1. Date
  let dateExact = 0;
  let dateTolScore = 0;
  const stmtDateEpoch = Date.parse(`${input.statementDate}T00:00:00Z`);
  const ldgDateEpoch = Date.parse(`${input.ledgerDate}T00:00:00Z`);
  const dateDiffDays = Math.round(Math.abs(stmtDateEpoch - ldgDateEpoch) / DAY_MS);

  if (input.statementDate === input.ledgerDate) {
    dateExact = 25;
    evidence.push("Data exata (+25)");
  } else if (dateDiffDays <= dateTolerance) {
    dateTolScore = 15;
    evidence.push(`Data na janela de tolerância de ${dateDiffDays} dias (+15)`);
  } else {
    evidence.push(`Data fora da tolerância: ${dateDiffDays} dias (0)`);
  }

  // 2. Amount & Sign
  let amountExact = 0;
  let signedAmountCompatible = 0;
  const sameAmount = input.statementAmountCents === input.ledgerAmountCents;
  const absStmt = input.statementAmountCents < 0n ? -input.statementAmountCents : input.statementAmountCents;
  const absLdg = input.ledgerAmountCents < 0n ? -input.ledgerAmountCents : input.ledgerAmountCents;
  const sameAbsAmount = absStmt === absLdg;

  if (sameAmount) {
    amountExact = 30;
    signedAmountCompatible = 10;
    evidence.push("Valor e sinal compatíveis (+40)");
  } else if (sameAbsAmount) {
    amountExact = 30;
    signedAmountCompatible = -30;
    evidence.push("Sinal invertido após convenção (-30)");
  } else {
    evidence.push("Valor em centavos divergente");
  }

  // 3. Document
  let documentExact = 0;
  let documentNormalized = 0;
  const rawStmtDoc = (input.statementDocument ?? "").trim();
  const rawLdgDoc = (input.ledgerDocument ?? "").trim();
  const normStmtDoc = normalizeDocumentId(rawStmtDoc);
  const normLdgDoc = normalizeDocumentId(rawLdgDoc);

  if (normStmtDoc && normLdgDoc && normStmtDoc === normLdgDoc) {
    if (rawStmtDoc === rawLdgDoc) {
      documentExact = 40;
      evidence.push(`Documento literal exato [${rawStmtDoc}] (+40)`);
    } else {
      documentNormalized = 40;
      evidence.push(`Documento normalizado compatível [${normStmtDoc}] (+40)`);
    }
  } else if (normStmtDoc && normLdgDoc && normStmtDoc !== normLdgDoc) {
    documentNormalized = -30;
    evidence.push(`Documento divergente [${normStmtDoc} vs ${normLdgDoc}] (-30)`);
  } else if (normStmtDoc || normLdgDoc) {
    evidence.push("Documento presente em apenas um dos lados (0)");
  }

  // 4. Semantic Category
  let semanticCategory = 0;
  const stmtCats = extractSemanticCategories(input.statementDescription);
  const ldgCats = extractSemanticCategories(input.ledgerHistory);
  if (stmtCats.some((cat) => ldgCats.includes(cat))) {
    semanticCategory = 20;
    evidence.push(`Categoria semântica compatível [${stmtCats.filter((c) => ldgCats.includes(c)).join(", ")}] (+20)`);
  } else if (stmtCats.length > 0 && ldgCats.length > 0) {
    semanticCategory = -25;
    evidence.push(`Categorias semânticas divergentes [${stmtCats.join(",")} vs ${ldgCats.join(",")}] (-25)`);
  }

  // 5. Bank Hint
  let bankHint = 0;
  const stmtBank = extractBankHint(input.statementDescription);
  const ldgBank = extractBankHint(input.ledgerHistory);
  if (stmtBank && ldgBank && stmtBank === ldgBank) {
    bankHint = 10;
    evidence.push(`Banco compatível no histórico [${stmtBank}] (+10)`);
  } else if (stmtBank && ldgBank && stmtBank !== ldgBank) {
    bankHint = -20;
    evidence.push(`Bancos divergentes no histórico [${stmtBank} vs ${ldgBank}] (-20)`);
  }

  // 6. Text Similarity
  let descriptionSimilarity = 0;
  const stmtHint = extractFinancialHint(input.statementDescription, normStmtDoc);
  const ldgHint = extractFinancialHint(input.ledgerHistory, normLdgDoc);
  const similarity = reconciliationTextSimilarity(stmtHint.comparisonTokens, ldgHint.comparisonTokens);
  if (similarity >= 0.3) {
    descriptionSimilarity = Math.round(similarity * 15);
    evidence.push(`Similaridade textual relevante [${Math.round(similarity * 100)}%] (+${descriptionSimilarity})`);
  }

  // 7. Ambiguity Penalty
  let ambiguityPenalty = 0;
  if (input.hasAmbiguity) {
    ambiguityPenalty = -50;
    evidence.push("Penalidade por concorrência de candidatos ambíguos (-50)");
  }

  const total =
    dateExact +
    dateTolScore +
    amountExact +
    signedAmountCompatible +
    documentExact +
    documentNormalized +
    semanticCategory +
    bankHint +
    descriptionSimilarity +
    ambiguityPenalty;

  let decision: "MATCH" | "AMBIGUOUS" | "REJECT";
  if (documentNormalized === -30 || signedAmountCompatible < 0 || dateDiffDays > dateTolerance || (!sameAmount && !sameAbsAmount)) {
    decision = "REJECT";
  } else if (input.hasAmbiguity || ambiguityPenalty < 0) {
    decision = "AMBIGUOUS";
  } else if (total >= 70 && sameAmount && (dateExact > 0 || dateTolScore > 0)) {
    decision = "MATCH";
  } else if (total >= 50 && sameAmount && (documentExact > 0 || documentNormalized > 0)) {
    decision = "MATCH";
  } else {
    decision = "REJECT";
  }

  return {
    dateExact,
    dateTolerance: dateTolScore,
    amountExact,
    signedAmountCompatible,
    documentExact,
    documentNormalized,
    semanticCategory,
    bankHint,
    descriptionSimilarity,
    ambiguityPenalty,
    total,
    decision,
    evidence,
  };
}


export function extractSemanticCategories(text: string): string[] {
  const normalized = normalizeCharacters(text);
  const categories: string[] = [];
  for (const { category, pattern } of SEMANTIC_CATEGORY_PATTERNS) {
    if (pattern.test(normalized)) {
      categories.push(category);
    }
  }
  return categories;
}

export function normalizeReconciliationText(value: string, genericWords: readonly string[] = DEFAULT_GENERIC_WORDS): string[] {
  const generic = new Set(genericWords.map((word) => normalizeCharacters(word)));
  return normalizeCharacters(value)
    .split(" ")
    .filter((token) => token.length >= 3)
    .map((token) => (/^\d+$/.test(token) ? token.replace(/^0+(?=\d)/, "") : token))
    .filter((token) => !generic.has(token));
}

export function reconciliationTextSimilarity(left: readonly string[], right: readonly string[]): number {
  const leftTokens = new Set(left);
  const rightTokens = new Set(right);
  const denominator = Math.max(leftTokens.size, rightTokens.size);
  if (denominator === 0) return 0;
  let common = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) common += 1;
  return common / denominator;
}

export class ReconciliationEngine {
  private readonly options: ReconciliationEngineOptions;
  private readonly dateToleranceDays: number;

  constructor(_valueTolerance: unknown = 0, dateToleranceDays = 3, options: ReconciliationEngineOptions = {}) {
    if (!Number.isInteger(dateToleranceDays) || dateToleranceDays < 0 || dateToleranceDays > 3) {
      throw new Error("A tolerância de data deve ser um número inteiro entre 0 e 3 dias.");
    }
    this.options = options;
    this.dateToleranceDays = dateToleranceDays;
  }

  public run(transactions: readonly ReconciliationTransaction[]): ReconciliationEngineOutput {
    const configuration = this.options.configuration ?? RECONCILIATION_CONFIGURATION_V1;
    const evaluatedAt = this.options.evaluatedAt ?? EPOCH;
    let automaticApplication: RegExp;
    try {
      automaticApplication = new RegExp(configuration.automaticApplicationPattern);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new Error(`Configuração automaticApplicationPattern inválida.${detail}`);
    }
    const prepared = transactions.map((transaction) => prepare(transaction, configuration)).sort(compareTransactions);
    assertValidTransactions(prepared);

    const available = new Set(prepared.map((transaction) => transaction.id));
    const statuses = new Map<string, ReconciliationStatus>();
    const groupByTransaction = new Map<string, string>();
    const matchGroups: ReconciliationMatchGroup[] = [];
    const audit: ReconciliationAuditEntry[] = [];
    const combinationsEvaluatedByAnchor: Record<string, number> = {};
    let rf03SignatureGroupsEvaluated = 0;

    const accept = (
      ruleId: MatchRuleId,
      type: MatchGroupType,
      bank: PreparedTransaction[],
      ledger: PreparedTransaction[],
      status: ReconciliationStatus,
      score?: number,
    ): void => {
      const stableBank = [...bank].sort(compareTransactions);
      const stableLedger = [...ledger].sort(compareTransactions);
      const bankTotal = total(stableBank);
      const ledgerTotal = total(stableLedger);
      const semantic = {
        ruleId,
        ruleVersion: configuration.version,
        type,
        bankTransactionIds: stableBank.map((item) => item.id),
        ledgerTransactionIds: stableLedger.map((item) => item.id),
        bankTotalCents: bankTotal.toString(),
        ledgerTotalCents: ledgerTotal.toString(),
        score: score ?? null,
      };
      const id = deterministicId("MATCH", semantic);
      const group: ReconciliationMatchGroup = {
        id,
        ruleId,
        ruleVersion: configuration.version,
        type,
        bankTransactionIds: semantic.bankTransactionIds,
        ledgerTransactionIds: semantic.ledgerTransactionIds,
        bankTotalCents: semantic.bankTotalCents,
        ledgerTotalCents: semantic.ledgerTotalCents,
        differenceCents: (bankTotal - ledgerTotal).toString(),
        ...(score !== undefined ? { score } : {}),
        status: "automatic",
        evaluatedAt,
      };
      matchGroups.push(group);
      for (const transaction of [...stableBank, ...stableLedger]) {
        available.delete(transaction.id);
        statuses.set(transaction.id, status);
        groupByTransaction.set(transaction.id, id);
      }
      audit.push(auditFor(group, status, evaluatedAt));
    };

    for (const bank of prepared.filter((item) => item.source === "BANK")) {
      if (!available.has(bank.id)) continue;
      if (automaticApplication.test(normalizeCharacters(bank.description))) {
        available.delete(bank.id);
        statuses.set(bank.id, "EXCLUDED_AUTO_APPLICATION");
        audit.push(decisionAudit("RF-01", [bank], [], "EXCLUDED_AUTO_APPLICATION", evaluatedAt, configuration.version));
      }
    }

    const exactLedgers = indexExactCandidates(open(prepared, available, "LEDGER"));
    for (const bank of open(prepared, available, "BANK")) {
      const candidate = exactLedgers.get(exactKey(bank))?.takeBest(bank);
      if (candidate) accept("RF-02", "exact", [bank], [candidate.ledger], "RECONCILED_EXACT", candidate.score);
    }

    const windowLedgers = indexWindowCandidates(open(prepared, available, "LEDGER"));
    for (const bank of open(prepared, available, "BANK")) {
      const candidate = windowLedgers.get(financialKey(bank))?.takeBest(bank, this.dateToleranceDays, configuration);
      if (!candidate) continue;
      rf03SignatureGroupsEvaluated += candidate.signatureGroupsEvaluated;
      if (candidate.selected) {
        accept("RF-03", "date-window", [bank], [candidate.selected.ledger], "RECONCILED_DATE_WINDOW", candidate.selected.score);
      }
    }

    if (this.options.allowOneToMany !== false) {
      const groupedLedgers = indexGroupTransactions(open(prepared, available, "LEDGER"));
      for (const bank of open(prepared, available, "BANK")) {
        const group = groupedLedgers.get(groupKey(bank));
        const candidates = group && hasPairForAmount(group, bank.amountCents)
          ? groupCandidates(bank, group.transactions.filter((item) => available.has(item.id)), configuration, combinationsEvaluatedByAnchor)
          : noGroupCandidates(bank, combinationsEvaluatedByAnchor);
        const selected = selectGroupCandidate(candidates, configuration);
        if (selected) accept("RF-04", "one-to-many", [bank], selected.members, "RECONCILED_GROUP", selected.score);
      }
    }

    if (this.options.allowManyToOne !== false) {
      const groupedBanks = indexGroupTransactions(open(prepared, available, "BANK"));
      for (const ledger of open(prepared, available, "LEDGER")) {
        const group = groupedBanks.get(groupKey(ledger));
        const candidates = group && hasPairForAmount(group, ledger.amountCents)
          ? groupCandidates(ledger, group.transactions.filter((item) => available.has(item.id)), configuration, combinationsEvaluatedByAnchor)
          : noGroupCandidates(ledger, combinationsEvaluatedByAnchor);
        const selected = selectGroupCandidate(candidates, configuration);
        if (selected) accept("RF-05", "many-to-one", selected.members, [ledger], "RECONCILED_GROUP", selected.score);
      }
    }

    const daily = indexTransactions(open(prepared, available), dailyKey);
    for (const key of [...daily.keys()].sort()) {
      const residue = daily.get(key)!.filter((item) => available.has(item.id));
      const bank = residue.filter((item) => item.source === "BANK");
      const ledger = residue.filter((item) => item.source === "LEDGER");
      if (bank.length > 0 && ledger.length > 0 && total(bank) === total(ledger)) {
        if (bank.length === 1 && ledger.length === 1 && hasDivergentDocument(bank[0]!, ledger[0]!)) {
          continue;
        }
        accept("RF-07", "daily-total", bank, ledger, "RECONCILED_DAILY_TOTAL");
      }
    }

    for (const key of [...daily.keys()].sort()) {
      const residue = daily.get(key)!.filter((item) => available.has(item.id));
      const bank = residue.filter((item) => item.source === "BANK");
      const ledger = residue.filter((item) => item.source === "LEDGER");
      if (bank.length >= 2 && ledger.length === 0 && total(bank) === 0n) {
        accept("RF-08", "bank-net-zero", bank, [], "BANK_NET_ZERO");
      }
    }

    for (const transaction of open(prepared, available)) {
      const status = transaction.source === "BANK" ? "BANK_ONLY" : "LEDGER_ONLY";
      statuses.set(transaction.id, status);
      audit.push(decisionAudit("RF-09", transaction.source === "BANK" ? [transaction] : [], transaction.source === "LEDGER" ? [transaction] : [], status, evaluatedAt, configuration.version));
    }

    return {
      ruleVersion: configuration.version,
      evaluatedAt,
      transactions: prepared.map((transaction) => serializeTransaction(transaction, statuses.get(transaction.id)!, groupByTransaction.get(transaction.id))),
      matchGroups: matchGroups.sort((left, right) => left.id.localeCompare(right.id)),
      audit: audit.sort((left, right) => left.id.localeCompare(right.id)),
      metrics: {
        combinationsEvaluated: Object.values(combinationsEvaluatedByAnchor).reduce((sum, count) => sum + count, 0),
        combinationsEvaluatedByAnchor: Object.fromEntries(Object.entries(combinationsEvaluatedByAnchor).sort(([left], [right]) => left.localeCompare(right))),
        ...(this.options.collectPerformanceMetrics ? { rf03SignatureGroupsEvaluated } : {}),
      },
    };
  }

  public reconcile(ledgers: MatchableEntry[], statements: MatchableEntry[]): MatchResult[] {
    const ledgerTransactions = ledgers.map((entry, index) => legacyTransaction(entry, "LEDGER", index));
    const bankTransactions = statements.map((entry, index) => legacyTransaction(entry, "BANK", index));
    const output = this.run([...ledgerTransactions, ...bankTransactions]);
    const ledgerById = new Map(ledgers.map((entry) => [entry.id, entry]));
    const statementById = new Map(statements.map((entry) => [entry.id, entry]));
    const results: MatchResult[] = output.matchGroups.map((group) => legacyGroupResult(group, ledgerById, statementById));
    for (const transaction of output.transactions.filter((item) =>
      item.status === "BANK_ONLY" || item.status === "LEDGER_ONLY" || item.status === "EXCLUDED_AUTO_APPLICATION")) {
      results.push(legacySingleResult(transaction, ledgerById, statementById, output.evaluatedAt));
    }
    return results.sort((left, right) => left.id.localeCompare(right.id));
  }
}

export interface MatchableEntry {
  id: string;
  date: string;
  amount: string | number;
  documentNumber?: string;
  nature: "DEBIT" | "CREDIT";
  description?: string;
  accountId?: string;
  sourceRow?: number;
}

export type MatchRule =
  | "RULE_1_EXACT" | "RULE_2_DATE_TOLERANCE" | "RULE_3_MISSING_DOCUMENT" | "RULE_3_DESCRIPTION"
  | "RULE_4_GROUPING" | "RULE_4_VALUE_DIVERGENCE" | "RULE_5_DATE_DIVERGENCE" | "RULE_6_VALUE_ONLY"
  | "RULE_7_LEDGER_WITHOUT_STATEMENT" | "RULE_8_STATEMENT_WITHOUT_LEDGER" | "RULE_9_AMBIGUITY"
  | "RULE_7_DAILY_TOTAL" | "RULE_8_BANK_NET_ZERO" | "RULE_1_AUTO_APPLICATION";

export type MatchStatus =
  | "AUTO_MATCH_EXACT" | "AUTO_MATCH_DATE_TOLERANCE" | "AUTO_MATCH_VALUE_DATE" | "AUTO_MATCH_DESCRIPTION"
  | "AUTO_MATCH_GROUP" | "AUTO_MATCH_DAILY_TOTAL" | "BANK_NET_ZERO" | "AUTO_APPLICATION_EXCLUDED"
  | "GROUP_SUGGESTION" | "VALUE_ONLY_SUGGESTION" | "VALUE_DIVERGENCE" | "DATE_DIVERGENCE"
  | "AMBIGUOUS_MATCH" | "LEDGER_WITHOUT_STATEMENT" | "STATEMENT_WITHOUT_LEDGER";

export interface MatchEvidence {
  ruleId: MatchRule;
  cardinality: "ONE_TO_ONE" | "ONE_TO_MANY" | "MANY_TO_ONE" | "MANY_TO_MANY";
  ledgerIds: string[];
  statementIds: string[];
  dateDifferenceDays?: number;
  amountDifference: string;
  descriptionSimilarity?: number;
  confidence: number;
  status: MatchStatus;
  evaluatedAt: string;
  ruleVersion?: string;
}

export interface MatchResult {
  id: string;
  status: MatchStatus;
  rule: MatchRule;
  ledger?: MatchableEntry;
  statement?: MatchableEntry;
  candidates?: MatchableEntry[];
  ledgers?: MatchableEntry[];
  statements?: MatchableEntry[];
  evidence: MatchEvidence;
}

function prepare(transaction: ReconciliationTransaction, configuration: ReconciliationConfigurationV1): PreparedTransaction {
  const comparisonText = [
    transaction.description,
    transaction.documentId,
    transaction.counterparty,
    transaction.counterpart,
    transaction.ledgerCounterpartAccount,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const tokens = normalizeReconciliationText(transaction.description, configuration.genericWords);
  const normDoc = transaction.documentId ? normalizeDocumentId(transaction.documentId) : undefined;
  const financialHint = extractFinancialHint(comparisonText, normDoc, configuration.genericWords);
  return {
    ...transaction,
    normalizedDescription: tokens.join(" "),
    tokens,
    comparisonTokens: financialHint.comparisonTokens,
    metadata: {
      ...(transaction.metadata ?? {}),
      ...(financialHint.bankHint ? { bankHint: financialHint.bankHint } : {}),
      ...(financialHint.semanticCategory ? { semanticCategory: financialHint.semanticCategory } : {}),
    },
  };
}

function normalizeCharacters(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function transactionSimilarity(left: PreparedTransaction, right: PreparedTransaction): number {
  return reconciliationTextSimilarity(left.comparisonTokens, right.comparisonTokens);
}

function groupCandidates(
  anchor: PreparedTransaction,
  entries: PreparedTransaction[],
  configuration: ReconciliationConfigurationV1,
  evaluatedByAnchor: Record<string, number>,
): GroupCandidate[] {
  const eligible = entries.filter((entry) =>
    entry.accountId === anchor.accountId && entry.currency === anchor.currency && entry.postingDate === anchor.postingDate && sameSign(entry.amountCents, anchor.amountCents));
  const byAmount = indexTransactions(eligible, (entry) => entry.amountCents.toString());
  const candidates: GroupCandidate[] = [];
  for (let left = 0; left < eligible.length && candidates.length < configuration.maxCombinationsPerAnchor; left += 1) {
    const first = eligible[left]!;
    const complement = anchor.amountCents - first.amountCents;
    for (const second of byAmount.get(complement.toString()) ?? []) {
      if (compareTransactions(first, second) >= 0) continue;
      const members: [PreparedTransaction, PreparedTransaction] = [first, second];
      candidates.push({ members, score: groupScore(anchor, members, configuration) });
      if (candidates.length >= configuration.maxCombinationsPerAnchor) break;
    }
  }
  evaluatedByAnchor[anchor.id] = candidates.length;
  return candidates.sort((left, right) => right.score - left.score || compareTransactionArrays(left.members, right.members));
}

function groupScore(anchor: PreparedTransaction, members: [PreparedTransaction, PreparedTransaction], configuration: ReconciliationConfigurationV1): number {
  const combined = [...new Set(members.flatMap((member) => member.comparisonTokens))];
  let score = reconciliationTextSimilarity(anchor.comparisonTokens, combined);
  const numericTokens = [...new Set(anchor.comparisonTokens.filter((token) => /^\d{4,}$/.test(token)))];
  const shared = numericTokens.filter((token) => members.some((member) => member.comparisonTokens.includes(token)));
  if (shared.length > 0) score += configuration.rf06.sharedNumericTokenBonus;
  if (shared.some((token) => members.every((member) => member.comparisonTokens.includes(token)))) {
    score += configuration.rf06.allLinesNumericTokenBonus;
  }
  return score;
}

function selectGroupCandidate(candidates: GroupCandidate[], configuration: ReconciliationConfigurationV1): GroupCandidate | undefined {
  if (candidates.length === 1) return candidates[0];
  const best = candidates[0];
  if (!best || best.score < configuration.rf06.minimumScore || best.score - candidates[1]!.score < configuration.rf06.minimumMargin) return undefined;
  return best;
}

function sameFinancialKey(left: PreparedTransaction, right: PreparedTransaction): boolean {
  return left.accountId === right.accountId && left.currency === right.currency && left.amountCents === right.amountCents;
}

function financialKey(transaction: PreparedTransaction): string {
  return `${transaction.accountId}\u0000${transaction.currency}\u0000${transaction.amountCents}`;
}

function exactKey(transaction: PreparedTransaction): string {
  return `${financialKey(transaction)}\u0000${transaction.postingDate}`;
}

function groupKey(transaction: PreparedTransaction): string {
  return `${transaction.accountId}\u0000${transaction.currency}\u0000${transaction.postingDate}\u0000${transaction.amountCents > 0n ? "+" : "-"}`;
}

function dailyKey(transaction: PreparedTransaction): string {
  return `${transaction.accountId}\u0000${transaction.currency}\u0000${transaction.postingDate}`;
}

function indexTransactions(
  transactions: PreparedTransaction[],
  keyOf: (transaction: PreparedTransaction) => string,
): Map<string, PreparedTransaction[]> {
  const index = new Map<string, PreparedTransaction[]>();
  for (const transaction of transactions) {
    const key = keyOf(transaction);
    const bucket = index.get(key);
    if (bucket) bucket.push(transaction);
    else index.set(key, [transaction]);
  }
  return index;
}

type GroupTransactionIndex = {
  transactions: PreparedTransaction[];
  amountCounts: Map<bigint, number>;
  pairTargets: Map<bigint, boolean>;
};

function indexGroupTransactions(transactions: PreparedTransaction[]): Map<string, GroupTransactionIndex> {
  const groups = indexTransactions(transactions, groupKey);
  return new Map([...groups].map(([key, entries]) => [key, {
    transactions: entries,
    amountCounts: entries.reduce((counts, entry) =>
      counts.set(entry.amountCents, (counts.get(entry.amountCents) ?? 0) + 1), new Map<bigint, number>()),
    pairTargets: new Map<bigint, boolean>(),
  }]));
}

function hasPairForAmount(group: GroupTransactionIndex, target: bigint): boolean {
  const cached = group.pairTargets.get(target);
  if (cached !== undefined) return cached;
  for (const [amount, count] of group.amountCounts) {
    const complement = target - amount;
    if (complement !== amount ? group.amountCounts.has(complement) : count >= 2) {
      group.pairTargets.set(target, true);
      return true;
    }
  }
  group.pairTargets.set(target, false);
  return false;
}

function noGroupCandidates(
  anchor: PreparedTransaction,
  evaluatedByAnchor: Record<string, number>,
): GroupCandidate[] {
  evaluatedByAnchor[anchor.id] = 0;
  return [];
}

type ExactLedgerGroup = {
  transactions: PreparedTransaction[];
  tokens: string[];
  cursor: number;
};

export function isDocumentIdentifier(value: string | undefined): boolean {
  if (!value) return false;
  const norm = normalizeDocumentId(value);
  return /^\d+$/.test(norm) || /^[A-Z]{2,10}[-_\s/]?\d+$/i.test(norm) || /^\d+-[A-Z0-9]+$/i.test(norm);
}

export function hasDivergentDocument(left: PreparedTransaction, right: PreparedTransaction): boolean {
  const leftDoc = left.documentId ? normalizeDocumentId(left.documentId) : "";
  const rightDoc = right.documentId ? normalizeDocumentId(right.documentId) : "";
  if (leftDoc && rightDoc && isDocumentIdentifier(leftDoc) && isDocumentIdentifier(rightDoc) && leftDoc !== rightDoc) {
    return true;
  }
  return false;
}

class ExactLedgerCandidates {
  private readonly groups: ExactLedgerGroup[];
  private readonly groupIndexBySignature = new Map<string, number>();
  private readonly groupIndexByTransactionId = new Map<string, number>();
  private readonly groupIndexesByToken = new Map<string, number[]>();
  private readonly consumed = new Set<string>();
  private earliestCursor = 0;

  public constructor(private readonly transactions: PreparedTransaction[]) {
    const bySignature = new Map<string, ExactLedgerGroup>();
    for (const transaction of transactions) {
      const tokens = [...new Set(transaction.comparisonTokens)].sort();
      const signature = tokens.join("\u0000");
      const group = bySignature.get(signature);
      if (group) group.transactions.push(transaction);
      else bySignature.set(signature, { transactions: [transaction], tokens, cursor: 0 });
    }
    this.groups = [...bySignature.values()];
    this.groups.forEach((group, groupIndex) => {
      this.groupIndexBySignature.set(group.tokens.join("\u0000"), groupIndex);
      for (const transaction of group.transactions) this.groupIndexByTransactionId.set(transaction.id, groupIndex);
      for (const token of group.tokens) {
        const indexes = this.groupIndexesByToken.get(token);
        if (indexes) indexes.push(groupIndex);
        else this.groupIndexesByToken.set(token, [groupIndex]);
      }
    });
  }

  public takeBest(bank: PreparedTransaction): { ledger: PreparedTransaction; score: number } | undefined {
    const bankTokens = [...new Set(bank.comparisonTokens)].sort();
    if (bankTokens.length > 0) {
      const exactGroupIndex = this.groupIndexBySignature.get(bankTokens.join("\u0000"));
      if (exactGroupIndex !== undefined) {
        const exactGroup = this.groups[exactGroupIndex]!;
        const ledger = exactGroup.transactions[exactGroup.cursor];
        if (ledger && !hasDivergentDocument(bank, ledger)) {
          exactGroup.cursor += 1;
          this.consumed.add(ledger.id);
          return { ledger, score: 1 };
        }
      }
    }

    const candidateGroupIndexes = new Set<number>();
    for (const token of bankTokens) {
      for (const groupIndex of this.groupIndexesByToken.get(token) ?? []) candidateGroupIndexes.add(groupIndex);
    }

    let best: { groupIndex: number; ledger: PreparedTransaction; score: number } | undefined;
    for (const groupIndex of candidateGroupIndexes) {
      const group = this.groups[groupIndex]!;
      const ledger = group.transactions[group.cursor];
      if (!ledger) continue;
      if (hasDivergentDocument(bank, ledger)) continue;
      const score = reconciliationTextSimilarity(bank.comparisonTokens, group.tokens);
      if (!best || score > best.score || (score === best.score && compareTransactions(ledger, best.ledger) < 0)) {
        best = { groupIndex, ledger, score };
      }
    }

    if (!best) {
      while (this.consumed.has(this.transactions[this.earliestCursor]?.id ?? "")) this.earliestCursor += 1;
      const ledger = this.transactions[this.earliestCursor];
      if (!ledger) return undefined;
      if (hasDivergentDocument(bank, ledger)) return undefined;
      const groupIndex = this.groupIndexByTransactionId.get(ledger.id)!;
      best = { groupIndex, ledger, score: 0 };
    }

    const group = this.groups[best.groupIndex]!;
    group.cursor += 1;
    this.consumed.add(best.ledger.id);
    return { ledger: best.ledger, score: best.score };
  }
}

function indexExactCandidates(transactions: PreparedTransaction[]): Map<string, ExactLedgerCandidates> {
  const buckets = indexTransactions(transactions, exactKey);
  return new Map([...buckets].map(([key, entries]) => [key, new ExactLedgerCandidates(entries)]));
}

type WindowLedgerGroup = {
  transactions: PreparedTransaction[];
  tokens: string[];
  cursor: number;
};

class WindowDateCandidates {
  public readonly groupsByToken = new Map<string, WindowLedgerGroup[]>();
  public readonly groupBySignature = new Map<string, WindowLedgerGroup>();
  private readonly groupByTransactionId = new Map<string, WindowLedgerGroup>();
  private readonly consumed = new Set<string>();
  private earliestCursor = 0;
  private available = 0;

  public constructor(private readonly transactions: PreparedTransaction[]) {
    const groupsBySignature = new Map<string, WindowLedgerGroup>();
    for (const transaction of transactions) {
      const tokens = [...new Set(transaction.comparisonTokens)].sort();
      const signature = tokens.join("\u0000");
      const group = groupsBySignature.get(signature);
      if (group) group.transactions.push(transaction);
      else groupsBySignature.set(signature, { transactions: [transaction], tokens, cursor: 0 });
      this.available += 1;
    }
    for (const group of groupsBySignature.values()) {
      this.groupBySignature.set(group.tokens.join("\u0000"), group);
      for (const transaction of group.transactions) this.groupByTransactionId.set(transaction.id, group);
      for (const token of group.tokens) {
        const groups = this.groupsByToken.get(token);
        if (groups) groups.push(group);
        else this.groupsByToken.set(token, [group]);
      }
    }
  }

  public get availableCount(): number {
    return this.available;
  }

  public firstAvailable(): PreparedTransaction | undefined {
    while (this.consumed.has(this.transactions[this.earliestCursor]?.id ?? "")) this.earliestCursor += 1;
    return this.transactions[this.earliestCursor];
  }

  public consume(group: WindowLedgerGroup): PreparedTransaction {
    const transaction = group.transactions[group.cursor]!;
    group.cursor += 1;
    this.available -= 1;
    this.consumed.add(transaction.id);
    return transaction;
  }

  public groupFor(transaction: PreparedTransaction): WindowLedgerGroup {
    return this.groupByTransactionId.get(transaction.id)!;
  }
}

class WindowLedgerCandidates {
  private readonly dates = new Map<string, WindowDateCandidates>();

  public constructor(transactions: PreparedTransaction[]) {
    const byDate = indexTransactions(transactions, (transaction) => transaction.postingDate);
    for (const [date, entries] of byDate) this.dates.set(date, new WindowDateCandidates(entries));
  }

  public takeBest(
    bank: PreparedTransaction,
    toleranceDays: number,
    configuration: ReconciliationConfigurationV1,
  ): {
    selected?: { ledger: PreparedTransaction; score: number };
    signatureGroupsEvaluated: number;
  } | undefined {
    const dateCandidates: Array<{ candidates: WindowDateCandidates; distance: number }> = [];
    let candidateCount = 0;
    for (let offset = -toleranceDays; offset <= toleranceDays; offset += 1) {
      const candidates = this.dates.get(offsetDate(bank.postingDate, offset));
      if (!candidates?.availableCount) continue;
      dateCandidates.push({ candidates, distance: Math.abs(offset) });
      candidateCount += candidates.availableCount;
    }
    if (candidateCount === 0) return undefined;
    if (candidateCount === 1) {
      const entry = dateCandidates.find(({ candidates }) => candidates.availableCount === 1)!;
      const ledger = entry.candidates.firstAvailable()!;
      if (hasDivergentDocument(bank, ledger)) {
        return undefined;
      }
      const group = entry.candidates.groupFor(ledger);
      entry.candidates.consume(group);
      return {
        selected: { ledger, score: transactionSimilarity(bank, ledger) },
        signatureGroupsEvaluated: 1,
      };
    }

    const bankTokens = [...new Set(bank.comparisonTokens)].sort();
    const exactSignature = bankTokens.join("\u0000");
    const exactGroups = dateCandidates
      .map((entry) => ({ ...entry, group: entry.candidates.groupBySignature.get(exactSignature) }))
      .filter((entry): entry is typeof entry & { group: WindowLedgerGroup } =>
        Boolean(entry.group && entry.group.cursor < entry.group.transactions.length && !hasDivergentDocument(bank, entry.group.transactions[entry.group.cursor]!)));
    const exactCandidateCount = exactGroups.reduce(
      (count, entry) => count + entry.group.transactions.length - entry.group.cursor,
      0,
    );
    if (exactCandidateCount > 1) return { signatureGroupsEvaluated: exactGroups.length };
    const maximumDifferentSignatureScore = bankTokens.length / (bankTokens.length + 1);
    if (bankTokens.length > 0 && exactCandidateCount === 1 &&
      1 - maximumDifferentSignatureScore >= configuration.rf03.minimumMargin) {
      const exact = exactGroups[0]!;
      const ledger = exact.candidates.consume(exact.group);
      return { selected: { ledger, score: 1 }, signatureGroupsEvaluated: 1 };
    }

    const groups = new Map<WindowLedgerGroup, { candidates: WindowDateCandidates; distance: number }>();
    for (const entry of dateCandidates) {
      for (const token of bankTokens) {
        for (const group of entry.candidates.groupsByToken.get(token) ?? []) {
          if (group.cursor < group.transactions.length) groups.set(group, entry);
        }
      }
    }

    let best: { group: WindowLedgerGroup; candidates: WindowDateCandidates; ledger: PreparedTransaction; score: number; distance: number } | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    let secondScore = Number.NEGATIVE_INFINITY;
    let evaluatedCandidateCount = 0;
    for (const [group, entry] of groups) {
      const ledger = group.transactions[group.cursor]!;
      if (hasDivergentDocument(bank, ledger)) continue;
      const availableCount = group.transactions.length - group.cursor;
      const score = reconciliationTextSimilarity(bank.comparisonTokens, group.tokens);
      evaluatedCandidateCount += availableCount;
      if (!best || score > best.score ||
        (score === best.score && (entry.distance < best.distance ||
          (entry.distance === best.distance && compareTransactions(ledger, best.ledger) < 0)))) {
        best = { group, candidates: entry.candidates, ledger, score, distance: entry.distance };
      }
      if (score > bestScore) {
        secondScore = availableCount > 1 ? score : bestScore;
        bestScore = score;
      } else if (score === bestScore) {
        secondScore = bestScore;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    const zeroScoreCandidates = candidateCount - evaluatedCandidateCount;
    if (zeroScoreCandidates > 0) {
      if (bestScore < 0) bestScore = 0;
      if (zeroScoreCandidates > 1 || bestScore > 0) secondScore = Math.max(secondScore, 0);
    }
    if (!best || best.score < configuration.rf03.minimumScore || best.score - secondScore < configuration.rf03.minimumMargin) {
      return { signatureGroupsEvaluated: groups.size };
    }
    best.candidates.consume(best.group);
    return {
      selected: { ledger: best.ledger, score: best.score },
      signatureGroupsEvaluated: groups.size,
    };
  }
}

function indexWindowCandidates(transactions: PreparedTransaction[]): Map<string, WindowLedgerCandidates> {
  const buckets = indexTransactions(transactions, financialKey);
  return new Map([...buckets].map(([key, entries]) => [key, new WindowLedgerCandidates(entries)]));
}

function offsetDate(date: string, offset: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

function sameSign(left: bigint, right: bigint): boolean {
  return left !== 0n && right !== 0n && (left > 0n) === (right > 0n);
}

function dateDifference(left: string, right: string): number {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / DAY_MS;
}

function open(transactions: PreparedTransaction[], available: Set<string>, source?: ReconciliationSource): PreparedTransaction[] {
  return transactions.filter((transaction) => available.has(transaction.id) && (!source || transaction.source === source));
}

function total(transactions: readonly PreparedTransaction[]): bigint {
  return transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0n);
}

function compareTransactions(left: ReconciliationTransaction, right: ReconciliationTransaction): number {
  return left.sourceRow - right.sourceRow || left.id.localeCompare(right.id);
}

function compareTransactionArrays(left: readonly PreparedTransaction[], right: readonly PreparedTransaction[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (!left[index]) return -1;
    if (!right[index]) return 1;
    const compared = compareTransactions(left[index]!, right[index]!);
    if (compared !== 0) return compared;
  }
  return 0;
}

function assertValidTransactions(transactions: PreparedTransaction[]): void {
  const ids = new Set<string>();
  for (const transaction of transactions) {
    if (ids.has(transaction.id)) throw new Error(`Identificador de transação duplicado: ${transaction.id}`);
    ids.add(transaction.id);
    if (!transaction.id || !transaction.importBatchId || !transaction.accountId || !transaction.evidence.fileId) {
      throw new Error("Transação de conciliação sem identificação, lote, conta ou evidência.");
    }
    if (transaction.currency !== "BRL") throw new Error("A versão 1.0 aceita somente BRL.");
    if (transaction.amountCents === 0n) throw new Error(`Transação ${transaction.id} possui valor zero.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.postingDate) || !Number.isFinite(Date.parse(`${transaction.postingDate}T00:00:00Z`))) {
      throw new Error(`Data de lançamento inválida: ${transaction.postingDate}`);
    }
  }
}

function serializeTransaction(transaction: PreparedTransaction, status: ReconciliationStatus, matchGroupId?: string): SerializedReconciliationTransaction {
  const { amountCents, comparisonTokens: _comparisonTokens, ...serializable } = transaction;
  return {
    ...serializable,
    evidence: serializeRecord(serializable.evidence) as ReconciliationEvidence,
    metadata: serializeRecord(serializable.metadata) as Record<string, unknown>,
    amountCents: amountCents.toString(),
    status,
    ...(matchGroupId ? { matchGroupId } : {}),
  };
}

function serializeRecord(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeRecord);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeRecord(entry)]));
  }
  return value;
}

function auditFor(group: ReconciliationMatchGroup, outcome: ReconciliationStatus, evaluatedAt: string): ReconciliationAuditEntry {
  const transactionIds = [...group.bankTransactionIds, ...group.ledgerTransactionIds];
  return {
    id: deterministicId("AUDIT", { groupId: group.id, outcome }),
    ruleId: group.ruleId,
    ruleVersion: group.ruleVersion,
    transactionIds,
    bankTransactionIds: group.bankTransactionIds,
    ledgerTransactionIds: group.ledgerTransactionIds,
    bankTotalCents: group.bankTotalCents,
    ledgerTotalCents: group.ledgerTotalCents,
    differenceCents: group.differenceCents,
    ...(group.score !== undefined ? { score: group.score } : {}),
    outcome,
    evaluatedAt,
  };
}

function decisionAudit(
  ruleId: MatchRuleId,
  bank: PreparedTransaction[],
  ledger: PreparedTransaction[],
  outcome: ReconciliationStatus,
  evaluatedAt: string,
  version: typeof RECONCILIATION_RULE_VERSION,
): ReconciliationAuditEntry {
  const bankTotal = total(bank);
  const ledgerTotal = total(ledger);
  const bankIds = bank.map((item) => item.id);
  const ledgerIds = ledger.map((item) => item.id);
  return {
    id: deterministicId("AUDIT", { ruleId, version, bankIds, ledgerIds, outcome }),
    ruleId,
    ruleVersion: version,
    transactionIds: [...bankIds, ...ledgerIds],
    bankTransactionIds: bankIds,
    ledgerTransactionIds: ledgerIds,
    bankTotalCents: bankTotal.toString(),
    ledgerTotalCents: ledgerTotal.toString(),
    differenceCents: (bankTotal - ledgerTotal).toString(),
    outcome,
    evaluatedAt,
  };
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16).toUpperCase()}`;
}

function legacyTransaction(entry: MatchableEntry, source: ReconciliationSource, index: number): ReconciliationTransaction {
  const unsigned = decimalToCents(entry.amount);
  const amountCents = entry.nature === "CREDIT" ? -abs(unsigned) : abs(unsigned);
  return {
    id: entry.id,
    importBatchId: "legacy",
    source,
    accountId: entry.accountId ?? "legacy-account",
    currency: "BRL",
    sourceRow: entry.sourceRow ?? index + 1,
    postingDate: entry.date,
    amountCents,
    description: entry.description ?? "",
    ...(entry.documentNumber ? { documentId: entry.documentNumber } : {}),
    evidence: { fileId: "legacy" },
  };
}

function decimalToCents(value: string | number): bigint {
  const text = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Valor monetário inválido: ${text}`);
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function centsToDecimal(value: string): string {
  const cents = BigInt(value);
  const sign = cents < 0n ? "-" : "";
  const absolute = abs(cents);
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function legacyGroupResult(
  group: ReconciliationMatchGroup,
  ledgerById: Map<string, MatchableEntry>,
  statementById: Map<string, MatchableEntry>,
): MatchResult {
  const ledgers = group.ledgerTransactionIds.map((id) => ledgerById.get(id)!).filter(Boolean);
  const statements = group.bankTransactionIds.map((id) => statementById.get(id)!).filter(Boolean);
  const status: MatchStatus = group.type === "exact" ? "AUTO_MATCH_EXACT"
    : group.type === "date-window" ? "AUTO_MATCH_DATE_TOLERANCE"
      : group.type === "daily-total" ? "AUTO_MATCH_DAILY_TOTAL"
        : group.type === "bank-net-zero" ? "BANK_NET_ZERO" : "AUTO_MATCH_GROUP";
  const rule: MatchRule = group.ruleId === "RF-02" ? "RULE_1_EXACT"
    : group.ruleId === "RF-03" ? "RULE_2_DATE_TOLERANCE"
      : group.ruleId === "RF-07" ? "RULE_7_DAILY_TOTAL"
        : group.ruleId === "RF-08" ? "RULE_8_BANK_NET_ZERO" : "RULE_4_GROUPING";
  const cardinality = ledgers.length > 1 && statements.length > 1 ? "MANY_TO_MANY"
    : ledgers.length > 1 ? "MANY_TO_ONE" : statements.length > 1 ? "ONE_TO_MANY" : "ONE_TO_ONE";
  return {
    id: group.id,
    status,
    rule,
    ...(ledgers.length === 1 ? { ledger: ledgers[0] } : {}),
    ...(statements.length === 1 ? { statement: statements[0] } : {}),
    ...(ledgers.length > 0 ? { ledgers } : {}),
    ...(statements.length > 0 ? { statements } : {}),
    evidence: {
      ruleId: rule,
      cardinality,
      ledgerIds: group.ledgerTransactionIds,
      statementIds: group.bankTransactionIds,
      amountDifference: centsToDecimal(group.differenceCents),
      ...(group.score !== undefined ? { descriptionSimilarity: group.score } : {}),
      confidence: 1,
      status,
      evaluatedAt: group.evaluatedAt,
      ruleVersion: group.ruleVersion,
    },
  };
}

function legacySingleResult(
  transaction: SerializedReconciliationTransaction,
  ledgerById: Map<string, MatchableEntry>,
  statementById: Map<string, MatchableEntry>,
  evaluatedAt: string,
): MatchResult {
  const ledger = ledgerById.get(transaction.id);
  const statement = statementById.get(transaction.id);
  const excluded = transaction.status === "EXCLUDED_AUTO_APPLICATION";
  const status: MatchStatus = excluded ? "AUTO_APPLICATION_EXCLUDED"
    : ledger ? "LEDGER_WITHOUT_STATEMENT" : "STATEMENT_WITHOUT_LEDGER";
  const rule: MatchRule = excluded ? "RULE_1_AUTO_APPLICATION"
    : ledger ? "RULE_7_LEDGER_WITHOUT_STATEMENT" : "RULE_8_STATEMENT_WITHOUT_LEDGER";
  return {
    id: deterministicId("MATCH", { rule, transactionId: transaction.id }),
    status,
    rule,
    ...(ledger ? { ledger } : {}),
    ...(statement ? { statement } : {}),
    evidence: {
      ruleId: rule,
      cardinality: "ONE_TO_ONE",
      ledgerIds: ledger ? [ledger.id] : [],
      statementIds: statement ? [statement.id] : [],
      amountDifference: centsToDecimal(transaction.amountCents),
      confidence: excluded ? 1 : 0,
      status,
      evaluatedAt,
      ruleVersion: RECONCILIATION_RULE_VERSION,
    },
  };
}
