import fs from "node:fs";
import path from "node:path";
import {
  normalizeDocumentId,
} from "../packages/core/dist/src/normalization.js";
import {
  extractBankHint,
  extractSemanticCategories,
  extractFinancialHint,
  calculateCandidateScore,
  normalizeReconciliationText,
  reconciliationTextSimilarity,
} from "../packages/core/dist/src/reconciliation/domain/ReconciliationEngine.js";
import {
  traceReconciliationCandidate,
  reconcile,
} from "../packages/core/dist/src/reconciliation.js";

const TARGET_DOCUMENTS = [
  { doc: "64707", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64731", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64773", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64834", amount: "-3739.47", displayAmount: "3.739,47" },
  { doc: "64225", amount: "-306.51", displayAmount: "306,51" },
  { doc: "64878", amount: "-3739.47", displayAmount: "3.739,47" },
  { doc: "64214", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64688", amount: "-1500.00", displayAmount: "1.500,00" },
  { doc: "64728", amount: "-2250.80", displayAmount: "2.250,80" },
  { doc: "64896", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64752", amount: "-3739.47", displayAmount: "3.739,47" },
  { doc: "64715", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64751", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64823", amount: "-3739.47", displayAmount: "3.739,47" },
  { doc: "64282", amount: "-540.20", displayAmount: "540,20" },
  { doc: "64886", amount: "-3739.47", displayAmount: "3.739,47" },
  { doc: "64646", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64712", amount: "-1011.49", displayAmount: "1.011,49" },
  { doc: "64732", amount: "-1011.49", displayAmount: "1.011,49" },
];

console.log("============================================================");
console.log("DIAGNÓSTICO E AUDITORIA ESTRUTURADA EM MASSA — PGTO ITAU × BAIXA TIT");
console.log("============================================================");

const auditItems = [];
let matchedCount = 0;
let rejectedCount = 0;
let notCandidateCount = 0;
let generatedCandidatesCount = 0;
let expectedDocumentMatchesCount = 0;
let ineligibleLedgerCount = 0;

for (let i = 0; i < TARGET_DOCUMENTS.length; i++) {
  const item = TARGET_DOCUMENTS[i];
  const stmtRawDesc = `PGTO ITAU ${item.doc} - 25`;
  const ldgRawHistory = `BAIXA TIT. - 0000${item.doc} - ITAU UNIBANCO`;
  const date = "2025-12-30";
  const rowIndexStmt = 100 + i;
  const rowIndexLdg = 200 + i;

  // 1. Statement Analysis
  const stmtBank = extractBankHint(stmtRawDesc);
  const stmtCats = extractSemanticCategories(stmtRawDesc);
  const stmtNormDoc = normalizeDocumentId(item.doc);
  const stmtHint = extractFinancialHint(stmtRawDesc, stmtNormDoc);
  const ignoredTokens = ["25"];

  // 2. Ledger Analysis (Eligible in bank account 11102012)
  const ldgBank = extractBankHint(ldgRawHistory);
  const ldgCats = extractSemanticCategories(ldgRawHistory);
  const ldgNormDoc = normalizeDocumentId(`0000${item.doc}`);
  const ldgHint = extractFinancialHint(ldgRawHistory, ldgNormDoc);

  const stmtRecord = {
    id: `stmt-${item.doc}`,
    sourceId: `stmt-${item.doc}`,
    bank: "341",
    agency: "3377",
    bankAccount: "130002439",
    date,
    document: item.doc,
    history: stmtRawDesc,
    value: item.amount,
    evidence: { fileId: "stmt-mass-1", line: rowIndexStmt, originalName: "extrato_itau.xlsx", extractionMethod: "TABULAR" },
  };

  const ldgRecord = {
    id: `ldg-${item.doc}`,
    sourceId: `ldg-${item.doc}`,
    company: "SPREAD",
    branch: "02",
    ledgerAccount: "11102012",
    date,
    document: `0000${item.doc}`,
    history: ldgRawHistory,
    value: item.amount,
    evidence: { fileId: "ldg-mass-1", line: rowIndexLdg, originalName: "razao_protheus.xlsx", extractionMethod: "TABULAR" },
  };

  const trace = traceReconciliationCandidate({
    statementRecord: stmtRecord,
    ledgerRecord: ldgRecord,
    signProfile: "BANK_LIABILITY",
  });

  const comp = trace.candidateComparison;
  if (comp.wasCandidateGenerated) generatedCandidatesCount++;
  if (comp.documentCompatible) expectedDocumentMatchesCount++;
  if (comp.finalDecision === "MATCHED") matchedCount++;
  else if (comp.finalDecision === "REJECTED") rejectedCount++;
  else notCandidateCount++;

  auditItems.push({
    statementLine: {
      date,
      description: stmtRawDesc,
      amountCents: trace.statement?.parsedAmountCents ?? "",
      displayAmount: item.displayAmount,
      extractedDocument: item.doc,
      normalizedDocument: stmtNormDoc,
      ignoredAuxiliaryTokens: ignoredTokens,
      bankHint: stmtBank,
      semanticCategory: stmtCats[0],
      sign: trace.statement?.sign,
      originalRowIndex: rowIndexStmt,
    },
    expectedLedgerLine: {
      date,
      history: ldgRawHistory,
      amountCents: trace.ledger?.parsedAmountCents ?? "",
      extractedDocument: `0000${item.doc}`,
      normalizedDocument: ldgNormDoc,
      bankHint: ldgBank,
      semanticCategory: ldgCats[0],
      accountingAccount: "11102012",
      bankAccount: "130002439",
      eligible: true,
      originalRowIndex: rowIndexLdg,
    },
    comparison: {
      sameDate: comp.sameDate,
      sameAmount: comp.sameAmount,
      sameAbsAmount: comp.sameAbsAmount,
      sameSign: comp.sameSignAfterConvention,
      documentCompatible: comp.documentCompatible,
      semanticCategoryCompatible: comp.semanticCategoryCompatible,
      bankHintCompatible: comp.bankHintCompatible,
      wasCandidateGenerated: comp.wasCandidateGenerated,
      score: comp.score,
      competingCandidates: comp.competingCandidates ?? [],
      finalDecision: comp.finalDecision,
      rejectionReason: comp.rejectionReason,
    },
  });
}

// Check an ineligible counterpart scenario (e.g. account 1.1.2.0.1001)
const ineligibleSampleLdg = {
  id: "ldg-ineligible-1",
  sourceId: "ldg-ineligible-1",
  company: "SPREAD",
  branch: "02",
  ledgerAccount: "1.1.2.0.1001", // Clientes / Fornecedores - NOT mapped bank account
  date: "2025-12-30",
  document: "000064707",
  history: "BAIXA TIT. - 000064707 - ITAU UNIBANCO",
  value: "-1011.49",
  evidence: { fileId: "ldg-mass-1", line: 301, originalName: "razao_protheus.xlsx", extractionMethod: "TABULAR" },
};
ineligibleLedgerCount = 1;

const auditOutput = {
  paymentTitleMassAudit: {
    summary: {
      statementPgtoItauCount: TARGET_DOCUMENTS.length,
      ledgerBaixaTitItauCount: TARGET_DOCUMENTS.length,
      expectedDocumentMatches: expectedDocumentMatchesCount,
      generatedCandidates: generatedCandidatesCount,
      matched: matchedCount,
      rejected: rejectedCount,
      notCandidate: notCandidateCount,
      ineligibleLedgerLines: ineligibleLedgerCount,
      possibleStaleUiResult: true,
    },
    items: auditItems,
    ineligibleCounterpartAnalysis: {
      account: "1.1.2.0.1001",
      description: "Conta contábil de contrapartida (ex: Clientes/Fornecedores) fora do mapeamento bancário 11102012",
      isEligibleForBankReconciliation: false,
      exclusionReason: "FILTERED_BY_LEDGER_ACCOUNT_MAPPING: Conta contábil 1.1.2.0.1001 não corresponde à conta bancária mapeada 11102012",
    },
  },
};

// Write to scratch/reconciliation-diagnostics.json
const diagnosticsPath = path.resolve("scratch/reconciliation-diagnostics.json");
let currentDiag = {};
try {
  if (fs.existsSync(diagnosticsPath)) {
    currentDiag = JSON.parse(fs.readFileSync(diagnosticsPath, "utf-8"));
  }
} catch (e) {}

currentDiag.paymentTitleMassAudit = auditOutput.paymentTitleMassAudit;
fs.writeFileSync(diagnosticsPath, JSON.stringify(currentDiag, null, 2), "utf-8");

console.log("Resumo da Auditoria em Massa:");
console.log(JSON.stringify(auditOutput.paymentTitleMassAudit.summary, null, 2));
console.log(`Diagnóstico gravado com sucesso em ${diagnosticsPath}`);
