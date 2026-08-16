import { normalizeHeader, parseDate, parseMoney } from "../normalization.js";
import type { ExtractedTabularRow, ExtractedTabularSheet, TabularSourceFormat } from "../tabular/tabular-types.js";
import type { StatementLayoutProfile } from "./statement-types.js";

export interface LayoutMatch {
  profileId: string;
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchedHeaders: string[];
  missingRequiredGroups: string[][];
  headerRowIndex: number;
  warnings: string[];
  requiresReview: boolean;
}

export interface LayoutDetectionResult { match: LayoutMatch | null; candidates: LayoutMatch[]; warnings: string[]; requiresReview: boolean }

function tokens(value: unknown): string[] { return normalizeHeader(value).split("_").filter(Boolean) }

function headerMatch(cell: string, alias: string): { matched: boolean; exact: boolean } {
  const cellNormalized = normalizeHeader(cell);
  const aliasNormalized = normalizeHeader(alias);
  if (!cellNormalized || !aliasNormalized) return { matched: false, exact: false };
  if (cellNormalized === aliasNormalized) return { matched: true, exact: true };
  const cellTokens = new Set(tokens(cellNormalized));
  const aliasTokens = tokens(aliasNormalized);
  return { matched: aliasTokens.length > 0 && aliasTokens.every((token) => cellTokens.has(token)), exact: false };
}

function contentScore(rows: ExtractedTabularRow[], headerIndex: number): { score: number; warnings: string[] } {
  const sample = rows.slice(headerIndex + 1, headerIndex + 31).filter((row) => row.cells.some((cell) => cell.displayValue.trim()));
  if (sample.length === 0) return { score: 0, warnings: ["NO_CONTENT_SAMPLE"] };
  let dates = 0; let monetary = 0; let descriptions = 0;
  for (const row of sample) {
    if (row.cells.some((cell) => { try { parseDate(cell.rawValue); return true; } catch { return false; } })) dates += 1;
    if (row.cells.some((cell) => { try { return !parseMoney(cell.rawValue).isZero(); } catch { return false; } })) monetary += 1;
    if (row.cells.some((cell) => /[A-Za-zÀ-ÿ]{3}/.test(cell.displayValue))) descriptions += 1;
  }
  const ratios = [dates / sample.length, monetary / sample.length, descriptions / sample.length];
  const warnings: string[] = [];
  if (ratios[0]! < 0.2) warnings.push("LOW_VALID_DATE_RATIO");
  if (ratios[1]! < 0.2) warnings.push("LOW_MONETARY_RATIO");
  if (ratios[2]! < 0.2) warnings.push("LOW_DESCRIPTION_RATIO");
  return { score: Math.round(ratios.reduce((total, ratio) => total + ratio, 0) * 10), warnings };
}

function detectProfile(sheet: ExtractedTabularSheet, profile: StatementLayoutProfile): LayoutMatch | null {
  if (profile.detection.negativeSheetNames?.some((name) => normalizeHeader(sheet.name) === normalizeHeader(name))) return null;
  let best: LayoutMatch | null = null;
  for (let index = 0; index < Math.min(sheet.rows.length, profile.rules.headerScanRows || 50); index += 1) {
    const cells = sheet.rows[index]!.cells.map((cell) => cell.displayValue).filter(Boolean);
    const matchedHeaders: string[] = []; const missing: string[][] = []; let exact = 0;
    for (const group of profile.detection.requiredHeaderGroups) {
      let found: { alias: string; exact: boolean } | undefined;
      for (const alias of group) {
        const match = cells.map((cell) => headerMatch(cell, alias)).find((candidate) => candidate.matched);
        if (match) { found = { alias, exact: match.exact }; break; }
      }
      if (found) { matchedHeaders.push(found.alias); if (found.exact) exact += 1; } else missing.push(group);
    }
    if (missing.length > 0) continue;
    const content = contentScore(sheet.rows, index);
    const sheetBonus = profile.detection.sheetNameAliases?.some((name) => normalizeHeader(sheet.name) === normalizeHeader(name)) ? 20 : 0;
    const bankSpecificBonus = profile.bankCode ? 15 : 0;
    const score = matchedHeaders.length * 20 + exact * 5 + sheetBonus + bankSpecificBonus + content.score;
    const requiresReview = content.warnings.length > 0 || score < profile.detection.minimumScore;
    const candidate: LayoutMatch = {
      profileId: profile.id, score, confidence: score >= 100 && !requiresReview ? "HIGH" : score >= 70 ? "MEDIUM" : "LOW",
      matchedHeaders, missingRequiredGroups: [], headerRowIndex: index, warnings: content.warnings, requiresReview,
    };
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

export function detectLayoutResult(sheet: ExtractedTabularSheet, profiles: StatementLayoutProfile[], sourceFormat: TabularSourceFormat): LayoutDetectionResult {
  const candidates = profiles.filter((profile) => profile.formats.includes(sourceFormat) && profile.status !== "DEPRECATED")
    .map((profile) => detectProfile(sheet, profile)).filter((match): match is LayoutMatch => match !== null)
    .sort((left, right) => right.score - left.score || left.profileId.localeCompare(right.profileId));
  const best = candidates[0] ?? null;
  if (!best) return { match: null, candidates: [], warnings: ["LAYOUT_NOT_DETECTED"], requiresReview: true };

  const profileForCandidate = (c: LayoutMatch) => profiles.find((p) => p.id === c.profileId);
  const bestProfile = profileForCandidate(best);
  const isGeneric = (c: LayoutMatch) => profileForCandidate(c)?.bankCode === "";

  // When the best match is bank-specific, check ambiguity only against other bank-specific profiles
  if (bestProfile && bestProfile.bankCode !== "") {
    const otherSpecific = candidates.find((c) => c.profileId !== best.profileId && !isGeneric(c));
    if (otherSpecific && best.score - otherSpecific.score < 15) {
      // Bank-specific profiles are ambiguous — fall back to generic if available
      const genericFallback = candidates.find((c) => isGeneric(c));
      if (genericFallback) {
        return { match: genericFallback, candidates, warnings: ["BANK_SPECIFIC_AMBIGUOUS_GENERIC_FALLBACK"], requiresReview: genericFallback.requiresReview };
      }
      return { match: null, candidates, warnings: ["LAYOUT_AMBIGUOUS"], requiresReview: true };
    }
  }

  // Standard ambiguity check: skip generic runner-up only when best is bank-specific
  const runnerUp = candidates[1];
  if (runnerUp && best.score - runnerUp.score < 15) {
    const bestIsSpecific = bestProfile && bestProfile.bankCode !== "";
    if (!bestIsSpecific || !isGeneric(runnerUp)) {
      return { match: null, candidates, warnings: ["LAYOUT_AMBIGUOUS"], requiresReview: true };
    }
  }

  return { match: best, candidates, warnings: best.warnings, requiresReview: best.requiresReview };
}

export function detectLayout(sheet: ExtractedTabularSheet, profiles: StatementLayoutProfile[], sourceFormat: TabularSourceFormat): LayoutMatch | null {
  const result = detectLayoutResult(sheet, profiles, sourceFormat);
  return result.requiresReview ? null : result.match;
}
