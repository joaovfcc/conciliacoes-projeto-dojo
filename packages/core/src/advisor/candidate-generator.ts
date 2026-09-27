import { createHash } from "node:crypto";
import { normalizeDocumentId } from "../normalization.js";
import { normalizeReconciliationText } from "../reconciliation/domain/ReconciliationEngine.js";
import type {
  AccountMapping,
  LedgerRecord,
  ReconciliationResult,
  SignProfile,
  StatementRecord,
} from "../types.js";
import { ADVISOR_CONTRACT_VERSION_V1, type AdvisorRequestGroupV1, type AdvisorRequestV1 } from "./contracts.js";

export interface CandidateGeneratorOptions {
  period: string;
  currency?: "BRL";
  promptVersion?: string;
  requestId?: string;
  idempotencyKey?: string;
  maxGroupsPerRequest?: number;
  maxCandidatesPerGroup?: number;
  dateToleranceDays?: number;
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

function signConvention(profile: SignProfile) {
  switch (profile) {
    case "BANK_LIABILITY":
      return { ledgerMovementMultiplier: 1n };
    case "INVESTMENT_ASSET":
    case "BANK_ASSET":
    default:
      return { ledgerMovementMultiplier: -1n };
  }
}

function dayDifference(left: string, right: string): number {
  const leftMs = Date.parse(`${left}T00:00:00.000Z`);
  const rightMs = Date.parse(`${right}T00:00:00.000Z`);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return 9999;
  return Math.round(Math.abs(leftMs - rightMs) / (1000 * 60 * 60 * 24));
}

function deterministicId(parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 24);
}

export class AdvisorCandidateGenerator {
  generate(
    results: ReconciliationResult[],
    ledgers: LedgerRecord[],
    statements: StatementRecord[],
    mappings: AccountMapping[],
    options: CandidateGeneratorOptions,
  ): AdvisorRequestV1 {
    const currency = options.currency ?? "BRL";
    const promptVersion = options.promptVersion ?? "match-advisor-v1";
    const requestId = options.requestId ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const idempotencyKey = options.idempotencyKey ?? requestId;
    const maxGroups = options.maxGroupsPerRequest ?? 20;
    const maxCandidates = options.maxCandidatesPerGroup ?? 20;
    const dateToleranceDays = options.dateToleranceDays ?? 10;

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

    const groups: AdvisorRequestGroupV1[] = [];
    const usedGroupKeys = new Set<string>();

    // 1. Elegibilidade: AMBIGUOUS_MATCH com ambiguityGroup
    for (const result of results) {
      if (result.status === "AMBIGUOUS_MATCH" && result.ambiguityGroup) {
        const amb = result.ambiguityGroup;
        const groupKey = `amb-${amb.id}`;
        if (usedGroupKeys.has(groupKey)) continue;
        usedGroupKeys.add(groupKey);

        const ambLedgers = amb.ledgerCandidateIds
          .map((id) => ledgerById.get(id))
          .filter((item): item is LedgerRecord => Boolean(item));
        const ambStatements = amb.statementCandidateIds
          .map((id) => statementById.get(id))
          .filter((item): item is StatementRecord => Boolean(item));

        if (ambLedgers.length === 0 || ambStatements.length === 0) continue;

        const anchor = ambStatements[0] ?? ambLedgers[0]!;
        const anchorId = anchor.id;

        const entries = [
          ...ambStatements.slice(0, maxCandidates).map((s) => ({
            id: s.id,
            source: "STATEMENT" as const,
            date: s.date,
            amountCents: decimalToCents(s.value).toString(),
            document: normalizeDocumentId(s.document),
            normalizedHistory: normalizeReconciliationText(s.history).join(" "),
          })),
          ...ambLedgers.slice(0, maxCandidates).map((l) => {
            const mapping = mappingByLedgerAccount.get(l.ledgerAccount);
            const multiplier = mapping ? signConvention(mapping.signProfile).ledgerMovementMultiplier : -1n;
            return {
              id: l.id,
              source: "LEDGER" as const,
              date: l.date,
              amountCents: (decimalToCents(l.value) * multiplier).toString(),
              document: normalizeDocumentId(l.document),
              normalizedHistory: normalizeReconciliationText(l.history).join(" "),
            };
          }),
        ];

        groups.push({
          groupId: deterministicId(["ADVISOR_GROUP", "AMBIGUITY", amb.id]),
          anchorId,
          entries,
        });

        if (groups.length >= maxGroups) break;
      }
    }

    // 2. Elegibilidade: STATEMENT_WITHOUT_LEDGER (Âncoras de Extrato)
    if (groups.length < maxGroups) {
      const pendingStatements = results
        .filter((r) => r.status === "STATEMENT_WITHOUT_LEDGER" && r.statement)
        .map((r) => r.statement!);

      const pendingLedgers = results
        .filter((r) => r.status === "LEDGER_WITHOUT_STATEMENT" && r.ledger)
        .map((r) => r.ledger!);

      for (const statement of pendingStatements) {
        if (groups.length >= maxGroups) break;

        const ledgerAccount = fileToLedgerAccount.get(statement.evidence.fileId);
        if (!ledgerAccount) continue;
        const mapping = mappingByLedgerAccount.get(ledgerAccount);
        if (!mapping) continue;

        const multiplier = signConvention(mapping.signProfile).ledgerMovementMultiplier;
        const stmtCents = decimalToCents(statement.value);

        // Candidatos do razão na mesma conta, mesma direção de sinal e data próxima
        const matchingLedgers = pendingLedgers
          .filter((ledger) => {
            if (ledger.ledgerAccount !== ledgerAccount) return false;
            const ldgCents = decimalToCents(ledger.value) * multiplier;
            // Mesmo sinal
            if ((stmtCents > 0n && ldgCents <= 0n) || (stmtCents < 0n && ldgCents >= 0n)) return false;
            // Tolerância de data
            if (dayDifference(statement.date, ledger.date) > dateToleranceDays) return false;
            return true;
          })
          .sort((a, b) => dayDifference(statement.date, a.date) - dayDifference(statement.date, b.date))
          .slice(0, maxCandidates - 1);

        if (matchingLedgers.length === 0) continue;

        const groupKey = `stmt-anchor-${statement.id}`;
        if (usedGroupKeys.has(groupKey)) continue;
        usedGroupKeys.add(groupKey);

        const entries = [
          {
            id: statement.id,
            source: "STATEMENT" as const,
            date: statement.date,
            amountCents: stmtCents.toString(),
            document: normalizeDocumentId(statement.document),
            normalizedHistory: normalizeReconciliationText(statement.history).join(" "),
          },
          ...matchingLedgers.map((l) => ({
            id: l.id,
            source: "LEDGER" as const,
            date: l.date,
            amountCents: (decimalToCents(l.value) * multiplier).toString(),
            document: normalizeDocumentId(l.document),
            normalizedHistory: normalizeReconciliationText(l.history).join(" "),
          })),
        ];

        groups.push({
          groupId: deterministicId(["ADVISOR_GROUP", "STATEMENT_ANCHOR", statement.id]),
          anchorId: statement.id,
          entries,
        });
      }
    }

    // 3. Elegibilidade: LEDGER_WITHOUT_STATEMENT (Âncoras de Razão)
    if (groups.length < maxGroups) {
      const pendingStatements = results
        .filter((r) => r.status === "STATEMENT_WITHOUT_LEDGER" && r.statement)
        .map((r) => r.statement!);

      const pendingLedgers = results
        .filter((r) => r.status === "LEDGER_WITHOUT_STATEMENT" && r.ledger)
        .map((r) => r.ledger!);

      for (const ledger of pendingLedgers) {
        if (groups.length >= maxGroups) break;

        const mapping = mappingByLedgerAccount.get(ledger.ledgerAccount);
        if (!mapping) continue;

        const multiplier = signConvention(mapping.signProfile).ledgerMovementMultiplier;
        const ldgCents = decimalToCents(ledger.value) * multiplier;

        const matchingStatements = pendingStatements
          .filter((statement) => {
            const stmtAccount = fileToLedgerAccount.get(statement.evidence.fileId);
            if (stmtAccount !== ledger.ledgerAccount) return false;
            const stmtCents = decimalToCents(statement.value);
            if ((ldgCents > 0n && stmtCents <= 0n) || (ldgCents < 0n && stmtCents >= 0n)) return false;
            if (dayDifference(ledger.date, statement.date) > dateToleranceDays) return false;
            return true;
          })
          .sort((a, b) => dayDifference(ledger.date, a.date) - dayDifference(ledger.date, b.date))
          .slice(0, maxCandidates - 1);

        if (matchingStatements.length === 0) continue;

        const groupKey = `ldg-anchor-${ledger.id}`;
        if (usedGroupKeys.has(groupKey)) continue;
        usedGroupKeys.add(groupKey);

        const entries = [
          {
            id: ledger.id,
            source: "LEDGER" as const,
            date: ledger.date,
            amountCents: ldgCents.toString(),
            document: normalizeDocumentId(ledger.document),
            normalizedHistory: normalizeReconciliationText(ledger.history).join(" "),
          },
          ...matchingStatements.map((s) => ({
            id: s.id,
            source: "STATEMENT" as const,
            date: s.date,
            amountCents: decimalToCents(s.value).toString(),
            document: normalizeDocumentId(s.document),
            normalizedHistory: normalizeReconciliationText(s.history).join(" "),
          })),
        ];

        groups.push({
          groupId: deterministicId(["ADVISOR_GROUP", "LEDGER_ANCHOR", ledger.id]),
          anchorId: ledger.id,
          entries,
        });
      }
    }

    return {
      contractVersion: ADVISOR_CONTRACT_VERSION_V1,
      requestId,
      idempotencyKey,
      period: options.period,
      currency,
      promptVersion,
      groups,
    };
  }
}
