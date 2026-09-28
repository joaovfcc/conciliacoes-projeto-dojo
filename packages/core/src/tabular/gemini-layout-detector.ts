import { createHash } from "node:crypto";
import type { ExtractedTabularSheet } from "./tabular-types.js";
import type { StatementLayoutProfile } from "../statements/statement-types.js";

export interface GeminiLayoutDetectionResult {
  source: "DEEPSEEK_AI" | "GEMINI_AI" | "CACHE";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  headerRowIndex: number;
  columns: {
    date: number;
    description: number;
    descriptionComplement?: number;
    document?: number;
    amount?: number;
    debit?: number;
    credit?: number;
    balance?: number;
    dcIndicator?: number;
    account?: number;
  };
  rules: {
    valueMode: "SINGLE_SIGNED" | "SEPARATE_DEBIT_CREDIT" | "WITH_DC_INDICATOR";
    accountIsBlockHeader: boolean;
    inheritDateIfEmpty: boolean;
  };
  metadata: {
    bank?: string;
    agency?: string;
    account?: string;
    ledgerAccount?: string;
  };
}

export type LLMLayoutDetectionResult = GeminiLayoutDetectionResult;

// In-memory cache to prevent redundant LLM API calls for identical layouts
const layoutCache = new Map<string, GeminiLayoutDetectionResult>();

/**
 * Computes a stable structural fingerprint for the first 15 rows of a spreadsheet sheet.
 */
function computeSheetFingerprint(sheet: ExtractedTabularSheet): string {
  const headerSample = sheet.rows.slice(0, 15).map((row) =>
    row.cells.map((cell) => cell.displayValue.trim()).filter(Boolean).join("|")
  ).filter(Boolean).join("\n");

  return createHash("sha256").update(headerSample).digest("hex");
}

/**
 * Serializes the top 20 rows of a tabular sheet into a clean, compact text grid for the LLM prompt.
 */
function formatGridForPrompt(sheet: ExtractedTabularSheet, maxRows = 20): string {
  const lines: string[] = [];
  const rows = sheet.rows.slice(0, maxRows);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const values = row.cells.map((cell) => cell.displayValue.trim());
    if (values.every((v) => v === "")) continue;
    lines.push(`Linha ${r} (rowNumber=${row.rowNumber}): [${values.map((v, c) => `col${c}="${v}"`).join(" | ")}]`);
  }

  return lines.join("\n");
}

function parseLlmJsonOutput(
  rawText: string,
  source: "DEEPSEEK_AI" | "GEMINI_AI",
): GeminiLayoutDetectionResult | null {
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.headerRowIndex !== "number" ||
      typeof parsed.columns?.date !== "number" ||
      typeof parsed.columns?.description !== "number"
    ) {
      return null;
    }

    return {
      source,
      confidence: parsed.confidence || "MEDIUM",
      headerRowIndex: parsed.headerRowIndex,
      columns: {
        date: parsed.columns.date,
        description: parsed.columns.description,
        ...(parsed.columns.descriptionComplement !== null && parsed.columns.descriptionComplement !== undefined ? { descriptionComplement: parsed.columns.descriptionComplement } : {}),
        ...(parsed.columns.document !== null && parsed.columns.document !== undefined ? { document: parsed.columns.document } : {}),
        ...(parsed.columns.amount !== null && parsed.columns.amount !== undefined ? { amount: parsed.columns.amount } : {}),
        ...(parsed.columns.debit !== null && parsed.columns.debit !== undefined ? { debit: parsed.columns.debit } : {}),
        ...(parsed.columns.credit !== null && parsed.columns.credit !== undefined ? { credit: parsed.columns.credit } : {}),
        ...(parsed.columns.balance !== null && parsed.columns.balance !== undefined ? { balance: parsed.columns.balance } : {}),
        ...(parsed.columns.dcIndicator !== null && parsed.columns.dcIndicator !== undefined ? { dcIndicator: parsed.columns.dcIndicator } : {}),
        ...(parsed.columns.account !== null && parsed.columns.account !== undefined ? { account: parsed.columns.account } : {}),
      },
      rules: {
        valueMode: parsed.rules?.valueMode || "SINGLE_SIGNED",
        accountIsBlockHeader: !!parsed.rules?.accountIsBlockHeader,
        inheritDateIfEmpty: !!parsed.rules?.inheritDateIfEmpty,
      },
      metadata: {
        ...(parsed.metadata?.bank ? { bank: String(parsed.metadata.bank).trim() } : {}),
        ...(parsed.metadata?.agency ? { agency: String(parsed.metadata.agency).trim() } : {}),
        ...(parsed.metadata?.account ? { account: String(parsed.metadata.account).trim() } : {}),
        ...(parsed.metadata?.ledgerAccount ? { ledgerAccount: String(parsed.metadata.ledgerAccount).trim() } : {}),
      },
    };
  } catch {
    return null;
  }
}

async function callDeepSeek(
  prompt: string,
  apiKey: string,
): Promise<GeminiLayoutDetectionResult | null> {
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const url = "https://api.deepseek.com/chat/completions";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "Você é um perito contábil brasileiro sênior e arquiteto de sistemas para conciliação contábil. Sua resposta DEVE ser estritamente um objeto JSON válido, sem texto introdutório e sem blocos markdown.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.warn(`[DeepSeekLayoutDetector] API returned status ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return parseLlmJsonOutput(content, "DEEPSEEK_AI");
  } catch (error) {
    console.warn(`[DeepSeekLayoutDetector] Error invoking DeepSeek:`, error);
    return null;
  }
}

async function callGemini(
  prompt: string,
  apiKey: string,
): Promise<GeminiLayoutDetectionResult | null> {
  const candidateModels = [
    process.env.GEMINI_MODEL,
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
  ].filter((m): m is string => Boolean(m));

  let lastError = "";

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        lastError = `Model ${model} failed with status ${response.status}: ${await response.text()}`;
        continue;
      }

      const data = await response.json();
      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        continue;
      }

      const parsed = parseLlmJsonOutput(candidateText, "GEMINI_AI");
      if (parsed) return parsed;
    } catch (error) {
      lastError = `Model ${model} exception: ${String(error)}`;
    }
  }

  console.warn(`[GeminiLayoutDetector] All candidate models failed. Last error: ${lastError}`);
  return null;
}

/**
 * Calls an LLM (DeepSeek or Google Gemini) to detect table schema, header row, and column roles.
 */
export async function detectLayoutWithLLM(
  sheet: ExtractedTabularSheet,
  fileKind: "STATEMENT" | "LEDGER" = "STATEMENT",
): Promise<GeminiLayoutDetectionResult | null> {
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!deepseekApiKey && !geminiApiKey) {
    return null;
  }

  const fingerprint = `${fileKind}:${computeSheetFingerprint(sheet)}`;
  const cached = layoutCache.get(fingerprint);
  if (cached) {
    return { ...cached, source: "CACHE" };
  }

  const gridText = formatGridForPrompt(sheet, 20);
  if (!gridText.trim()) {
    return null;
  }

  const prompt = `Você é um perito contábil brasileiro sênior e arquiteto de sistemas para conciliação contábil.
Analise a amostra das primeiras linhas desta planilha (${fileKind === "STATEMENT" ? "Extrato Bancário" : "Razão Contábil de ERP"}).

AMOSTRA DA PLANILHA:
${gridText}

INSTRUÇÕES:
1. Identifique qual linha (índice 0-indexed) é a linha real de CABEÇALHO das colunas de lançamentos financeiros.
2. Identifique os índices das colunas (0-indexed col0, col1...):
   - data (obrigatório para extrato/razão)
   - descrição ou histórico (obrigatório)
   - documento (número do documento, cheque, doc, etc., se houver)
   - valor (se houver coluna única de valor)
   - débito e crédito (se houver colunas separadas para saídas e entradas)
   - saldo (se houver coluna de saldo após lançamento)
   - indicador D/C (se houver coluna com 'D'/'C')
   - conta contábil ou bancária (se houver em coluna)
3. Identifique o modo de valor (valueMode):
   - "SINGLE_SIGNED": coluna única com valores positivos e negativos.
   - "SEPARATE_DEBIT_CREDIT": coluna separada de débito e crédito.
   - "WITH_DC_INDICATOR": valor positivo acompanhado de coluna 'D' ou 'C'.
4. Identifique se a conta contábil/bancária está em uma linha de título/bloco antes dos lançamentos (ex: "Conta: 1.1.1.02.001 - Itaú") -> accountIsBlockHeader: true.
5. Identifique se datas vazias devem ser herdadas da linha anterior (comum em sublançamentos do Protheus/SAP) -> inheritDateIfEmpty: true.
6. Extraia metadados de banco, agência, conta corrente ou conta contábil encontrados nas linhas iniciais.

Responda ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "headerRowIndex": number,
  "columns": {
    "date": number,
    "description": number,
    "descriptionComplement": number | null,
    "document": number | null,
    "amount": number | null,
    "debit": number | null,
    "credit": number | null,
    "balance": number | null,
    "dcIndicator": number | null,
    "account": number | null
  },
  "rules": {
    "valueMode": "SINGLE_SIGNED" | "SEPARATE_DEBIT_CREDIT" | "WITH_DC_INDICATOR",
    "accountIsBlockHeader": boolean,
    "inheritDateIfEmpty": boolean
  },
  "metadata": {
    "bank": string | null,
    "agency": string | null,
    "account": string | null,
    "ledgerAccount": string | null
  }
}`;

  let result: GeminiLayoutDetectionResult | null = null;

  // Try DeepSeek first if configured
  if (deepseekApiKey) {
    result = await callDeepSeek(prompt, deepseekApiKey);
  }

  // Fallback to Gemini if DeepSeek was unavailable or failed
  if (!result && geminiApiKey) {
    result = await callGemini(prompt, geminiApiKey);
  }

  if (result) {
    layoutCache.set(fingerprint, result);
  }

  return result;
}

/**
 * Backward compatibility alias for detectLayoutWithLLM.
 */
export async function detectLayoutWithGemini(
  sheet: ExtractedTabularSheet,
  fileKind: "STATEMENT" | "LEDGER" = "STATEMENT",
): Promise<GeminiLayoutDetectionResult | null> {
  return detectLayoutWithLLM(sheet, fileKind);
}

/**
 * Converts a Gemini-detected layout into a runtime StatementLayoutProfile that can be
 * consumed directly by generic-statement-parser.
 */
export function buildDynamicStatementProfile(
  sheet: ExtractedTabularSheet,
  detected: GeminiLayoutDetectionResult,
): StatementLayoutProfile {
  const headerRow = sheet.rows[detected.headerRowIndex];
  const cellAt = (colIndex: number | undefined): string[] => {
    if (colIndex === undefined) return [];
    const cell = headerRow?.cells.find((c) => c.columnIndex === colIndex);
    return cell && cell.displayValue.trim() ? [cell.displayValue.trim()] : [];
  };

  const dateAliases = cellAt(detected.columns.date);
  const descAliases = cellAt(detected.columns.description);
  const docAliases = cellAt(detected.columns.document);
  const amountAliases = cellAt(detected.columns.amount);
  const debitAliases = cellAt(detected.columns.debit);
  const creditAliases = cellAt(detected.columns.credit);
  const balanceAliases = cellAt(detected.columns.balance);
  const dcAliases = cellAt(detected.columns.dcIndicator);

  return {
    id: `gemini-dynamic-${sheet.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
    version: 1,
    status: "VALIDATED",
    bankCode: detected.metadata.bank || "",
    productType: "CHECKING",
    formats: ["XLSX", "XLS", "XLSM", "CSV"],
    detection: {
      requiredHeaderGroups: [dateAliases, descAliases],
      minimumScore: 10,
    },
    columns: {
      date: dateAliases.length > 0 ? dateAliases : ["data"],
      description: descAliases.length > 0 ? descAliases : ["historico", "descricao"],
      ...(docAliases.length > 0 ? { document: docAliases } : {}),
      ...(amountAliases.length > 0 ? { amount: amountAliases } : {}),
      ...(debitAliases.length > 0 ? { debit: debitAliases } : {}),
      ...(creditAliases.length > 0 ? { credit: creditAliases } : {}),
      ...(balanceAliases.length > 0 ? { balance: balanceAliases } : {}),
      ...(dcAliases.length > 0 ? { dcIndicator: dcAliases } : {}),
    },
    rules: {
      headerScanRows: Math.max(detected.headerRowIndex + 5, 20),
      negativeAmountMeansDebit: detected.rules.valueMode !== "SEPARATE_DEBIT_CREDIT",
      inheritDateFromPreviousRow: detected.rules.inheritDateIfEmpty,
      repeatedHeaderPolicy: "IGNORE",
      ignoreRowPatterns: ["saldo anterior", "saldo atual", "saldo final", "resumo", "subtotal", "total"],
      stopPatterns: ["não há lançamentos", "fim do extrato"],
    },
  };
}
