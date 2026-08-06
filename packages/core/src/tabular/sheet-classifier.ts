import { ExtractedTabularSheet, TabularWarning } from "./tabular-types.js";

export type SheetRole =
  | "TRANSACTIONAL"
  | "FUTURE_TRANSACTIONS"
  | "SUMMARY"
  | "BALANCE"
  | "INSTRUCTIONS"
  | "COVER"
  | "EMPTY"
  | "UNKNOWN";

export interface ClassifiedSheet {
  sheet: ExtractedTabularSheet;
  role: SheetRole;
  score: number;
  matchedSignals: string[];
  warnings: TabularWarning[];
}

export function classifySheet(sheet: ExtractedTabularSheet): ClassifiedSheet {
  const matchedSignals: string[] = [];
  let score = 0;
  
  if (sheet.rows.length === 0) {
    return { sheet, role: "EMPTY", score: 0, matchedSignals: ["vazia"], warnings: [] };
  }
  
  const nameLower = sheet.name.toLowerCase();
  
  // Basic Name Checks
  if (nameLower.includes("futuro")) {
    score -= 50;
    matchedSignals.push("nome 'futuro'");
  }
  
  if (nameLower.includes("capa") || nameLower.includes("instruç")) {
    score -= 30;
    matchedSignals.push("nome 'capa/instruções'");
  }
  
  if (nameLower.includes("resumo") || nameLower.includes("posição")) {
    score -= 15;
    matchedSignals.push("nome 'resumo/posição'");
  }
  
  if ((nameLower.includes("extrato") || nameLower.includes("lançamento")) && !nameLower.includes("futuro")) {
    score += 10;
    matchedSignals.push("nome 'extrato/lançamentos'");
  }
  
  if (sheet.hidden) {
    score -= 20;
    matchedSignals.push("aba oculta");
  }
  
  if (sheet.rows.length < 3) {
    score -= 30;
    matchedSignals.push("menos de 3 linhas");
  } else if (sheet.rows.length > 20) {
    score += 10;
    matchedSignals.push("mais de 20 linhas");
  } else if (sheet.rows.length > 5) {
    score += 10;
    matchedSignals.push("mais de 5 linhas");
  }
  
  // Content Checks (search first 50 rows)
  const scanLimit = Math.min(sheet.rows.length, 50);
  let hasDate = false;
  let hasValue = false;
  let hasHistory = false;
  let hasBalance = false;
  
  for (let r = 0; r < scanLimit; r++) {
    const row = sheet.rows[r];
    if (!row) continue;
    const textRow = row.cells.map(c => c.displayValue.toLowerCase()).join(" ");
    
    if (!hasDate && (textRow.includes("data") || textRow.includes("vencimento"))) {
      hasDate = true;
      score += 30;
      matchedSignals.push("coluna de data");
    }
    
    if (!hasValue && (textRow.includes("valor") || textRow.includes("crédito") || textRow.includes("débito"))) {
      hasValue = true;
      score += 30;
      matchedSignals.push("coluna de valor/deb/cred");
    }
    
    if (!hasHistory && (textRow.includes("histórico") || textRow.includes("lançamento") || textRow.includes("descrição"))) {
      hasHistory = true;
      score += 20;
      matchedSignals.push("histórico");
    }
    
    if (!hasBalance && textRow.includes("saldo")) {
      hasBalance = true;
      score += 10;
      matchedSignals.push("saldo");
    }
  }

  let role: SheetRole = "UNKNOWN";
  
  if (nameLower.includes("futuro")) {
    role = "FUTURE_TRANSACTIONS";
  } else if (nameLower.includes("capa") || nameLower.includes("instruç")) {
    role = "COVER";
  } else if (nameLower.includes("resumo") || nameLower.includes("posição")) {
    role = "SUMMARY";
  } else if (score >= 30) {
    role = "TRANSACTIONAL";
  }

  return {
    sheet,
    role,
    score,
    matchedSignals,
    warnings: []
  };
}
