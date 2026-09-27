import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import {
  detectLayoutWithGemini,
  buildDynamicStatementProfile,
  type GeminiLayoutDetectionResult,
} from "../../../src/tabular/gemini-layout-detector.js";
import { parseSpreadsheet } from "../../../src/tabular/spreadsheet-reader.js";
import { parseStatement as parseStatementGeneric } from "../../../src/statements/generic-statement-parser.js";
import { tabularRows } from "../../../src/parsers/tabular-utils.js";
import { parseLedger } from "../../../src/parsers/ledger.js";
import type { SourceFileInput } from "../../../src/parsers/types.js";

async function createXlsxBuffer(
  sheetName: string,
  rows: Array<Array<string | number | Date | null>>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) {
    sheet.addRow(row);
  }
  return (await workbook.xlsx.writeBuffer()) as any;
}

function input(name: string, buffer: Buffer, kind: "STATEMENT" | "LEDGER" = "STATEMENT"): SourceFileInput {
  return {
    id: `test-${name}`,
    originalName: `${name}.xlsx`,
    kind,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  };
}

describe("Gemini Layout Detector & Dynamic Profile", () => {
  it("should build a valid StatementLayoutProfile from Gemini detection result", async () => {
    const buffer = await createXlsxBuffer("Extrato_Banco_Inter", [
      ["BANCO INTER S.A."],
      ["Agência 0001 Conta 998877-6"],
      [],
      ["Data Lançamento", "Histórico do Movimento", "Nº Doc", "Valor (R$)", "Saldo"],
      ["10/01/2026", "PIX ENVIADO FORNECEDOR", "12345", "-250.00", "5000.00"],
      ["11/01/2026", "TED RECEBIDA CLIENTE", "67890", "1200.00", "6200.00"],
    ]);

    const doc = parseSpreadsheet({ buffer, sourceFormat: "XLSX", fileName: "inter.xlsx" });
    const sheet = doc.sheets[0]!;

    const mockDetection: GeminiLayoutDetectionResult = {
      source: "GEMINI_AI",
      confidence: "HIGH",
      headerRowIndex: 2,
      columns: {
        date: 0,
        description: 1,
        document: 2,
        amount: 3,
        balance: 4,
      },
      rules: {
        valueMode: "SINGLE_SIGNED",
        accountIsBlockHeader: false,
        inheritDateIfEmpty: false,
      },
      metadata: {
        bank: "077 - Inter",
        agency: "0001",
        account: "998877-6",
      },
    };

    const profile = buildDynamicStatementProfile(sheet, mockDetection);
    expect(profile.id).toContain("gemini-dynamic");
    expect(profile.columns.date).toContain("Data Lançamento");
    expect(profile.columns.description).toContain("Histórico do Movimento");
    expect(profile.columns.amount).toContain("Valor (R$)");

    const parsed = parseStatementGeneric(sheet, profile, mockDetection.headerRowIndex, "XLSX", "inter.xlsx");
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[0]!.amount).toBe(250);
    expect(parsed.transactions[0]!.direction).toBe("DEBIT");
    expect(parsed.transactions[1]!.amount).toBe(1200);
    expect(parsed.transactions[1]!.direction).toBe("CREDIT");
  });

  it("should parse ledger with sticky account (account in header block, not repeated in each row)", async () => {
    const buffer = await createXlsxBuffer("Razao_Protheus", [
      ["EMPRESA: 01 - MATRIZ"],
      ["RELATÓRIO DE RAZÃO CONTÁBIL - PERÍODO: 01/2026 A 01/2026"],
      ["CONTA - 1.1.1.02.002 - BANCO ITAU CONTA CORRENTE"],
      [],
      ["DATA", "DOCUMENTO", "HISTORICO", "DEBITO", "CREDITO", "SALDO"],
      ["05/01/2026", "NF 101", "PAGAMENTO TITULO", "1500.00", "", "8500.00"],
      ["06/01/2026", "DOC 202", "RECEBIMENTO CLIENTE", "", "3200.00", "11700.00"],
      ["07/01/2026", "TAXA 303", "TARIFA BANCARIA", "45.00", "", "11655.00"],
      ["SALDO ATUAL DA CONTA:", "", "", "", "", "11655.00"],
    ]);

    const file = input("razao-protheus", buffer, "LEDGER");
    const { rows, metadata } = await tabularRows(file);

    expect(metadata.ledgerAccount).toBe("11102002");
    expect(rows).toHaveLength(4); // 3 transactions + 1 structure row
    expect(rows[0]!.values.ACCOUNT).toBe("11102002");
    expect(rows[1]!.values.ACCOUNT).toBe("11102002");
    expect(rows[2]!.values.ACCOUNT).toBe("11102002");

    const ledgerResult = await parseLedger(file);
    expect(ledgerResult.issues.filter((i) => i.severity === "ERROR")).toHaveLength(0);
    expect(ledgerResult.records).toHaveLength(3);
    expect(ledgerResult.records[0]!.ledgerAccount).toBe("11102002");
    expect(ledgerResult.records[0]!.value).toBe("1500.00");
    expect(ledgerResult.records[1]!.value).toBe("-3200.00");
    expect(ledgerResult.records[2]!.value).toBe("45.00");
  });

  it("should inherit date for multiline entries without repeated date in ledger", async () => {
    const buffer = await createXlsxBuffer("Razao_Multiline", [
      ["CONTA - 1.1.1.01.001 - CAIXA GERAL"],
      ["DATA", "HISTORICO", "VALOR"],
      ["10/01/2026", "DESPESA CARTORIO PARTE 1", "-120.00"],
      ["", "DESPESA CARTORIO PARTE 2 RECONHECIMENTO", "-55.00"],
      ["", "DESPESA CARTORIO PARTE 3 COPIAS", "-25.00"],
    ]);

    const file = input("razao-multiline", buffer, "LEDGER");
    const ledgerResult = await parseLedger(file);

    expect(ledgerResult.issues.filter((i) => i.severity === "ERROR")).toHaveLength(0);
    expect(ledgerResult.records).toHaveLength(3);
    expect(ledgerResult.records[0]!.date).toBe("2026-01-10");
    expect(ledgerResult.records[1]!.date).toBe("2026-01-10");
    expect(ledgerResult.records[2]!.date).toBe("2026-01-10");
  });
});
