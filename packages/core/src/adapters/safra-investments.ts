import { money, parseDate, parseMoney } from "../normalization.js";
import {
  createSourceProvenance,
  type CanonicalInvestmentEntry,
  type CanonicalStatementDocument,
  type ExtractedStatementSource,
  type StatementSourceAdapter,
  type StatementSourceDetection,
  type StatementSourceValidation,
} from "../statement-sources.js";
import type { DocumentKind, ImportIssue } from "../types.js";

const BANK_CODE = "422";
const MONEY = "(?:\\d{1,3}(?:\\.\\d{3})*|\\d+),\\d{2}";

export const safraFundPositionAdapter = informationalAdapter({
  adapterId: "SAFRA_FUNDO_POSICAO",
  documentType: "FUND_STATEMENT",
  layoutFamily: "SAFRA_FUNDO_POSICAO",
  signatures: ["FUNDO (POSICAO DE INVESTIMENTOS", "MOVIMENTO AUTOMATICO"],
  parseInvestments(source, period) {
    const investments: CanonicalInvestmentEntry[] = [];
    for (const page of source.pages ?? []) {
      for (const rawLine of page.text.split(/\r?\n/)) {
        const line = ascii(rawLine).replace(/\s+/g, " ").trim();
        const match = new RegExp(`^(\\d{6,})\\s+(${MONEY})\\s+`).exec(line);
        if (!match) continue;
        investments.push(entry(source, page, investments.length + 1, {
          amount: money(parseMoney(match[2]!)),
          kind: "POSITION",
          description: "SAFRA FUNDO - POSIÇÃO DA OPERAÇÃO",
          ...(period ? { postingDate: period.end } : {}),
        }));
      }
    }
    return investments;
  },
});

export const safraCoePositionAdapter = informationalAdapter({
  adapterId: "SAFRA_COE_POSICAO",
  documentType: "STRUCTURED_PRODUCT_POSITION",
  layoutFamily: "SAFRA_COE_POSICAO",
  signatures: ["CERT OPER ESTR (POSICAO DE INVESTIMENTOS", "VALOR APLICADO VALOR LIQUIDO"],
  parseInvestments(source, period) {
    const investments: CanonicalInvestmentEntry[] = [];
    for (const page of source.pages ?? []) {
      for (const rawLine of page.text.split(/\r?\n/)) {
        const line = ascii(rawLine).replace(/\s+/g, " ").trim();
        const values = line.match(new RegExp(MONEY, "g")) ?? [];
        if (!/^[A-Z0-9]{3,}\s+\d{2}\/\d{2}\/\d{4}/.test(line) || values.length < 2) continue;
        investments.push(entry(source, page, investments.length + 1, {
          amount: money(parseMoney(values[1]!)),
          kind: "POSITION",
          description: `SAFRA COE - ${line.split(/\s+/).slice(0, 2).join(" ")}`,
          ...(period ? { postingDate: period.end } : {}),
        }));
      }
    }
    return investments;
  },
});

export const safraAutomaticProductsAdapter = informationalAdapter({
  adapterId: "SAFRA_PRODUTOS_AUTOMATICOS",
  documentType: "INVESTMENT_ACTIVITY",
  layoutFamily: "SAFRA_PRODUTOS_AUTOMATICOS",
  signatures: ["PRODUTOS AUTOMATICOS", "MOVIMENTACAO EM"],
  parseInvestments(source) {
    const investments: CanonicalInvestmentEntry[] = [];
    for (const page of source.pages ?? []) {
      for (const rawLine of page.text.split(/\r?\n/)) {
        const line = ascii(rawLine).replace(/\s+/g, " ").trim();
        const date = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{6,})\b/.exec(line);
        const values = line.match(new RegExp(MONEY, "g")) ?? [];
        if (!date?.[1] || !values[0]) continue;
        const redemption = /\d{6,}\s+\d{2}\/\d{2}\/\d{4}\s+/.test(line);
        investments.push(entry(source, page, investments.length + 1, {
          postingDate: parseDate(date[1]),
          amount: money(parseMoney(values[0])),
          kind: redemption ? "REDEMPTION" : "APPLICATION",
          description: redemption ? "SAFRA PRODUTO AUTOMÁTICO - RESGATE" : "SAFRA PRODUTO AUTOMÁTICO - APLICAÇÃO",
        }));
      }
    }
    return investments;
  },
});

type InformationalAdapterInput = {
  adapterId: "SAFRA_FUNDO_POSICAO" | "SAFRA_COE_POSICAO" | "SAFRA_PRODUTOS_AUTOMATICOS";
  documentType: Extract<DocumentKind, "FUND_STATEMENT" | "STRUCTURED_PRODUCT_POSITION" | "INVESTMENT_ACTIVITY">;
  layoutFamily: string;
  signatures: readonly [string, string];
  parseInvestments(source: ExtractedStatementSource & { format: "PDF" }, period?: { start: string; end: string }): CanonicalInvestmentEntry[];
};

function informationalAdapter(input: InformationalAdapterInput): StatementSourceAdapter<"PDF"> {
  return {
    adapterId: input.adapterId,
    adapterVersion: "1",
    format: "PDF",
    institutionCode: BANK_CODE,
    documentType: input.documentType,
    layoutFamily: input.layoutFamily,
    detect(source): StatementSourceDetection {
      const text = normalized(source);
      const bank = text.includes("BANCO SAFRA");
      const matches = input.signatures.filter((signature) => text.includes(signature));
      return {
        matched: bank && matches.length === input.signatures.length,
        score: (bank ? 34 : 0) + matches.length * 33,
        evidenceCodes: [...(bank ? ["SIGNATURE:BANCO_SAFRA"] : []), ...matches.map((signature) => `SIGNATURE:${signature}`)],
      };
    },
    parse(source): CanonicalStatementDocument {
      const text = normalized(source);
      const period = positionPeriod(text);
      const identityMatch = /AG\s*:\s*(\d+)\s*\|\s*CONTA\s*:\s*([\d-]+)/i.exec(text)
        ?? /AGENCIA\s+(\d+)\s+CONTA\s+([\d-]+)/i.exec(text);
      return {
        sourceId: source.sourceId,
        format: "PDF",
        institutionCode: BANK_CODE,
        documentType: input.documentType,
        layoutFamily: input.layoutFamily,
        adapterId: input.adapterId,
        adapterVersion: "1",
        identity: {
          bankCode: BANK_CODE,
          bankName: "SAFRA",
          ...(identityMatch?.[1] ? { agency: identifier(identityMatch[1]) } : {}),
          ...(identityMatch?.[2] ? { account: identifier(identityMatch[2]) } : {}),
        },
        ...(period ? { period } : {}),
        transactions: [],
        investments: input.parseInvestments(source, period),
        issues: [{
          severity: "WARNING",
          code: "INVESTIMENTO_INFORMATIVO",
          message: "O documento de investimento Safra é informativo e não participa da conciliação automática.",
        }],
      };
    },
    validate(document): StatementSourceValidation {
      const issues: ImportIssue[] = [...document.issues];
      if (!document.investments?.length) {
        issues.push({ severity: "ERROR", code: "INVESTMENT_POSITIONS_NOT_EXTRACTED", message: "Nenhuma informação de investimento Safra foi extraída." });
      }
      return { accepted: !issues.some((issue) => issue.severity === "ERROR"), issues };
    },
  };
}

function positionPeriod(text: string): { start: string; end: string } | undefined {
  const positionDate = /POSICAO DE INVESTIMENTOS EM\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1]
    ?? /DEMONSTRATIVO MENSAL\s*-?\s*(\d{2})\s*\/\s*(\d{4})/i.exec(text)?.slice(1).join("/");
  if (!positionDate) return undefined;
  if (/^\d{2}\/\d{4}$/.test(positionDate)) {
    const [month, year] = positionDate.split("/");
    return { start: `${year}-${month}-01`, end: `${year}-${month}-31` };
  }
  const date = parseDate(positionDate);
  return { start: date, end: date };
}

function entry(source: ExtractedStatementSource, page: { page: number; method: "TEXT" | "OCR" }, index: number, value: Omit<CanonicalInvestmentEntry, "investmentId" | "provenance">): CanonicalInvestmentEntry {
  return {
    investmentId: `safra-investment-${index}`,
    ...value,
    provenance: createSourceProvenance({
      sourceId: source.sourceId,
      format: "PDF",
      adapterId: "SAFRA_INVESTMENTS",
      adapterVersion: "1",
      rawHash: source.sha256,
      extractionMethod: page.method,
      page: page.page,
      row: index,
    }),
  };
}

function identifier(value: string) { return { raw: value, normalized: value.replace(/\D/g, "") }; }
function normalized(source: ExtractedStatementSource) { return ascii((source.pages ?? []).map((page) => page.text).join("\n")).toUpperCase(); }
function ascii(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
