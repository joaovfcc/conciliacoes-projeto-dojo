import { createHash } from "node:crypto";
import type {
  AccountMapping,
  LedgerRecord,
  ReconciliationResult,
  StatementRecord,
} from "../types.js";
import type { ValidatedAdvisorSuggestion } from "./response-validator.js";

function deterministicId(parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 24);
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

function dayDifference(left: string, right: string): number {
  const leftMs = Date.parse(`${left}T00:00:00.000Z`);
  const rightMs = Date.parse(`${right}T00:00:00.000Z`);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return 0;
  return Math.round(Math.abs(leftMs - rightMs) / (1000 * 60 * 60 * 24));
}

export class AdvisorEvidenceRehydrator {
  rehydrate(
    suggestions: ValidatedAdvisorSuggestion[],
    ledgerById: Map<string, LedgerRecord>,
    statementById: Map<string, StatementRecord>,
    _mappings: AccountMapping[],
  ): ReconciliationResult[] {
    const results: ReconciliationResult[] = [];

    for (const suggestion of suggestions) {
      const ledgers = suggestion.ledgerIds
        .map((id) => ledgerById.get(id))
        .filter((item): item is LedgerRecord => Boolean(item));
      const statements = suggestion.statementIds
        .map((id) => statementById.get(id))
        .filter((item): item is StatementRecord => Boolean(item));

      if (ledgers.length === 0 || statements.length === 0) continue;

      const isSingle = ledgers.length === 1 && statements.length === 1;
      const status = isSingle ? "VALUE_ONLY_SUGGESTION" : "GROUP_SUGGESTION";
      const rule = "AI-ADVISOR-V1";
      const decisionLevel = "REVIEW_REQUIRED" as const;

      const primaryDate = statements[0]?.date ?? ledgers[0]?.date ?? "";
      const secondaryDate = ledgers[0]?.date ?? statements[0]?.date ?? "";
      const dateDiff = dayDifference(primaryDate, secondaryDate);

      const score = Number((suggestion.confidenceBps / 10000).toFixed(4));
      const reason = `[Sugestão da IA - ${suggestion.provider}/${suggestion.model}] ${suggestion.explanationPtBr}`;

      const resultId = deterministicId([
        "ADVISOR_RECONCILIATION_RESULT",
        suggestion.groupId,
        ...suggestion.statementIds.sort(),
        ...suggestion.ledgerIds.sort(),
      ]);

      if (isSingle) {
        const singleLedger = ledgers[0];
        const singleStatement = statements[0];
        if (!singleLedger || !singleStatement) continue;

        results.push({
          id: resultId,
          status,
          rule,
          decisionLevel,
          reason,
          ledger: singleLedger,
          statement: singleStatement,
          ledgers,
          statements,
          valueDifference: "0.00",
          dateDifference: dateDiff,
          valueTolerance: "0.00",
          ruleVersion: suggestion.promptVersion,
          score,
        });
      } else {
        results.push({
          id: resultId,
          status,
          rule,
          decisionLevel,
          reason,
          ledgers,
          statements,
          valueDifference: "0.00",
          dateDifference: dateDiff,
          valueTolerance: "0.00",
          ruleVersion: suggestion.promptVersion,
          score,
        });
      }
    }

    return results;
  }
}
