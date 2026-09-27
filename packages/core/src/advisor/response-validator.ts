import type { AccountMapping, LedgerRecord, StatementRecord } from "../types.js";
import {
  ADVISOR_CONTRACT_VERSION_V1,
  advisorResponseV1Schema,
  type AdvisorRequestGroupV1,
  type AdvisorRequestV1,
  type AdvisorResponseV1,
  type AdvisorSuggestionV1,
} from "./contracts.js";

export interface ValidationResult {
  validSuggestions: ValidatedAdvisorSuggestion[];
  rejectedSuggestions: RejectedAdvisorSuggestion[];
}

export interface ValidatedAdvisorSuggestion {
  groupId: string;
  anchorId: string;
  candidateIds: string[];
  statementIds: string[];
  ledgerIds: string[];
  decision: "SUGGEST_MATCH" | "REVIEW_REQUIRED";
  confidenceBps: number;
  reasonCode: AdvisorSuggestionV1["reasonCode"];
  explanationPtBr: string;
  provider: string;
  model: string;
  promptVersion: string;
}

export interface RejectedAdvisorSuggestion {
  groupId: string;
  anchorId: string;
  code: string;
  reason: string;
}

function decimalToCents(value: string | number): bigint {
  const str = String(value).trim().replace(/\s+/g, "");
  if (!str) return 0n;
  const isNegative = str.startsWith("-");
  const unsigned = isNegative ? str.slice(1) : str;
  const [wholePart = "0", fractionPart = ""] = unsigned.split(".");
  const paddedFraction = (fractionPart + "00").slice(0, 2);
  const cents = BigInt(wholePart) * 100n + BigInt(paddedFraction);
  return isNegative ? -cents : cents;
}

function signMultiplier(profile: AccountMapping["signProfile"]): bigint {
  return profile === "BANK_LIABILITY" ? 1n : -1n;
}

export class AdvisorResponseValidator {
  validate(
    rawResponse: unknown,
    request: AdvisorRequestV1,
    ledgers: LedgerRecord[],
    statements: StatementRecord[],
    mappings: AccountMapping[],
    alreadyReconciledIds: Set<string> = new Set(),
  ): ValidationResult {
    const validSuggestions: ValidatedAdvisorSuggestion[] = [];
    const rejectedSuggestions: RejectedAdvisorSuggestion[] = [];

    // 1. Validação básica com Zod Schema
    const parseResult = advisorResponseV1Schema.safeParse(rawResponse);
    if (!parseResult.success) {
      for (const group of request.groups) {
        rejectedSuggestions.push({
          groupId: group.groupId,
          anchorId: group.anchorId,
          code: "ADVISOR_CONTRACT_MISMATCH",
          reason: `Resposta da IA fora do schema V1 esperado: ${parseResult.error.message}`,
        });
      }
      return { validSuggestions, rejectedSuggestions };
    }

    const response: AdvisorResponseV1 = parseResult.data;

    if (response.contractVersion !== ADVISOR_CONTRACT_VERSION_V1) {
      for (const group of request.groups) {
        rejectedSuggestions.push({
          groupId: group.groupId,
          anchorId: group.anchorId,
          code: "ADVISOR_CONTRACT_MISMATCH",
          reason: `Versão de contrato incompatível: ${response.contractVersion}`,
        });
      }
      return { validSuggestions, rejectedSuggestions };
    }

    if (response.requestId !== request.requestId) {
      for (const group of request.groups) {
        rejectedSuggestions.push({
          groupId: group.groupId,
          anchorId: group.anchorId,
          code: "ADVISOR_CONTRACT_MISMATCH",
          reason: `RequestId divergente: esperado ${request.requestId}, recebido ${response.requestId}`,
        });
      }
      return { validSuggestions, rejectedSuggestions };
    }

    const requestGroupMap = new Map<string, AdvisorRequestGroupV1>();
    for (const g of request.groups) {
      requestGroupMap.set(g.groupId, g);
    }

    const ledgerById = new Map<string, LedgerRecord>();
    for (const l of ledgers) ledgerById.set(l.id, l);

    const statementById = new Map<string, StatementRecord>();
    for (const s of statements) statementById.set(s.id, s);

    const fileToLedgerAccount = new Map<string, string>();
    const mappingByLedgerAccount = new Map<string, AccountMapping>();
    for (const m of mappings) {
      mappingByLedgerAccount.set(m.ledgerAccount, m);
      for (const fId of m.statementFileIds) {
        fileToLedgerAccount.set(fId, m.ledgerAccount);
      }
    }

    const consumedInThisBatch = new Set<string>();

    for (const suggestion of response.suggestions) {
      const group = requestGroupMap.get(suggestion.groupId);
      if (!group) {
        rejectedSuggestions.push({
          groupId: suggestion.groupId,
          anchorId: suggestion.anchorId,
          code: "ADVISOR_UNKNOWN_ID",
          reason: `Grupo ${suggestion.groupId} não existe na requisição original.`,
        });
        continue;
      }

      if (group.anchorId !== suggestion.anchorId) {
        rejectedSuggestions.push({
          groupId: suggestion.groupId,
          anchorId: suggestion.anchorId,
          code: "ADVISOR_SCOPE_VIOLATION",
          reason: `Âncora ${suggestion.anchorId} não corresponde à âncora enviada ${group.anchorId}.`,
        });
        continue;
      }

      // Se a decisão for NO_MATCH, não gera sugestão válida nem erro
      if (suggestion.decision === "NO_MATCH" || suggestion.candidateIds.length === 0) {
        continue;
      }

      const allGroupEntryIds = new Set(group.entries.map((e) => e.id));
      const invalidCandidateIds = suggestion.candidateIds.filter((id) => !allGroupEntryIds.has(id));
      if (invalidCandidateIds.length > 0) {
        rejectedSuggestions.push({
          groupId: suggestion.groupId,
          anchorId: suggestion.anchorId,
          code: "ADVISOR_UNKNOWN_ID",
          reason: `Candidatos inventados ou não pertencentes ao grupo: ${invalidCandidateIds.join(", ")}`,
        });
        continue;
      }

      const allInvolvedIds = [suggestion.anchorId, ...suggestion.candidateIds];

      // Verificar reutilização de IDs já conciliados ou usados nesta rodada
      const reusedIds = allInvolvedIds.filter(
        (id) => alreadyReconciledIds.has(id) || consumedInThisBatch.has(id),
      );
      if (reusedIds.length > 0) {
        rejectedSuggestions.push({
          groupId: suggestion.groupId,
          anchorId: suggestion.anchorId,
          code: "ADVISOR_REUSED_TRANSACTION",
          reason: `Lançamentos já consumidos ou duplicados: ${reusedIds.join(", ")}`,
        });
        continue;
      }

      // Classificar em statement e ledger
      const involvedStatements: StatementRecord[] = [];
      const involvedLedgers: LedgerRecord[] = [];

      for (const id of allInvolvedIds) {
        const stmt = statementById.get(id);
        const ldg = ledgerById.get(id);
        if (stmt) involvedStatements.push(stmt);
        else if (ldg) involvedLedgers.push(ldg);
        else {
          // ID desconhecido
          rejectedSuggestions.push({
            groupId: suggestion.groupId,
            anchorId: suggestion.anchorId,
            code: "ADVISOR_UNKNOWN_ID",
            reason: `ID ${id} não encontrado nos registros canônicos.`,
          });
          break;
        }
      }

      if (involvedStatements.length === 0 || involvedLedgers.length === 0) {
        rejectedSuggestions.push({
          groupId: suggestion.groupId,
          anchorId: suggestion.anchorId,
          code: "ADVISOR_SCOPE_VIOLATION",
          reason: "Uma sugestão deve conter ao menos 1 registro de extrato e 1 de razão.",
        });
        continue;
      }

      // Validar escopo contábil (mesma conta)
      const ledgerAccounts = new Set<string>();
      for (const l of involvedLedgers) {
        ledgerAccounts.add(l.ledgerAccount);
      }
      for (const s of involvedStatements) {
        const acc = fileToLedgerAccount.get(s.evidence.fileId);
        if (acc) ledgerAccounts.add(acc);
      }

      if (ledgerAccounts.size !== 1) {
        rejectedSuggestions.push({
          groupId: suggestion.groupId,
          anchorId: suggestion.anchorId,
          code: "ADVISOR_SCOPE_VIOLATION",
          reason: `Incompatibilidade de contas contábeis na sugestão: ${[...ledgerAccounts].join(", ")}`,
        });
        continue;
      }

      const ledgerAccount = [...ledgerAccounts][0]!;
      const mapping = mappingByLedgerAccount.get(ledgerAccount);
      const mult = mapping ? signMultiplier(mapping.signProfile) : -1n;

      // Validar fechamento matemático em centavos (BigInt)
      const bankTotalCents = involvedStatements.reduce(
        (sum, s) => sum + decimalToCents(s.value),
        0n,
      );
      const ledgerTotalCents = involvedLedgers.reduce(
        (sum, l) => sum + decimalToCents(l.value) * mult,
        0n,
      );

      if (bankTotalCents !== ledgerTotalCents) {
        rejectedSuggestions.push({
          groupId: suggestion.groupId,
          anchorId: suggestion.anchorId,
          code: "ADVISOR_AMOUNT_MISMATCH",
          reason: `Divergência matemática em centavos: extrato=${bankTotalCents} cents, razão=${ledgerTotalCents} cents`,
        });
        continue;
      }

      // Marcar IDs como consumidos neste lote
      for (const id of allInvolvedIds) {
        consumedInThisBatch.add(id);
      }

      validSuggestions.push({
        groupId: suggestion.groupId,
        anchorId: suggestion.anchorId,
        candidateIds: suggestion.candidateIds,
        statementIds: involvedStatements.map((s) => s.id),
        ledgerIds: involvedLedgers.map((l) => l.id),
        decision: suggestion.decision === "SUGGEST_MATCH" ? "SUGGEST_MATCH" : "REVIEW_REQUIRED",
        confidenceBps: suggestion.confidenceBps,
        reasonCode: suggestion.reasonCode,
        explanationPtBr: suggestion.explanationPtBr,
        provider: response.provider,
        model: response.model,
        promptVersion: response.promptVersion,
      });
    }

    return { validSuggestions, rejectedSuggestions };
  }
}
