import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseTabularStatement } from "../../../src/parsers/tabular.js";
import { ITAU_CHECKING_XLSX_V1 } from "../../../src/statements/profiles/itau-checking-xlsx-v1.js";
import type { SourceFileInput } from "../../../src/parsers/types.js";

async function createXlsxBuffer(
  sheetName: string,
  rows: Array<Array<string | number | Date | null>>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  for (const row of rows) {
    sheet.addRow(row);
  }

  return (await workbook.xlsx.writeBuffer()) as any;
}

describe("Itaú Checking XLSX Parser Characterization", () => {
  it("should parse a valid statement with positive and negative amounts", async () => {
    const buffer = await createXlsxBuffer("lançamentos", [
      ["Itaú Empresas"],
      ["Agência: 0191", "Conta: 0026775-6"],
      [],
      ["data", "lançamento", "documento", "valor (R$)", "saldo (R$)"],
      ["02/12/2025", "SALDO ANTERIOR", "", "0.00", "100.00"],
      ["03/12/2025", "TARIFA BANCARIA", "12345", "-10.00", "90.00"],
      ["04/12/2025", "RECEBIMENTO PIX", "54321", "500.00", "590.00"],
      ["05/12/2025", "SALDO FINAL", "", "", "590.00"],
      ["Fim do Extrato"],
    ]);

    const input: SourceFileInput = {
      id: "test-file-1",
      originalName: "itau-statement.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { records, metadata, issues } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);

    // Verify metadata
    expect(metadata.agency).toBe("0191");
    expect(metadata.account).toBe("0026775-6");
    expect(metadata.parser).toBe("itau-checking-xlsx-v1");

    // "SALDO ANTERIOR" and "SALDO FINAL" should be ignored based on rules
    // "Fim do Extrato" triggers the stop pattern
    expect(records.length).toBe(2);

    // Transaction 1 (Debit)
    expect(records[0]!.date).toBe("2025-12-03");
    expect(records[0]!.history).toBe("TARIFA BANCARIA");
    expect(records[0]!.document).toBe("12345");
    expect(records[0]!.value).toBe("-10.00"); // Negative amount

    // Transaction 2 (Credit)
    expect(records[1]!.date).toBe("2025-12-04");
    expect(records[1]!.history).toBe("RECEBIMENTO PIX");
    expect(records[1]!.document).toBe("54321");
    expect(records[1]!.value).toBe("500.00"); // Positive amount

    expect(issues.length).toBe(0);
  });

  it("should reject a file with an unrecognized layout", async () => {
    const buffer = await createXlsxBuffer("lançamentos", [
      ["Coluna A", "Coluna B", "Coluna C"],
      ["01/01/2025", "TESTE", "10.00"],
    ]);

    const input: SourceFileInput = {
      id: "test-file-2",
      originalName: "invalid-statement.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { records, issues } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);

    expect(records.length).toBe(0);
    expect(issues.some(i => i.code === "TABULAR_SEM_MOVIMENTOS")).toBe(true);
  });

  it("should ignore negative sheet names like 'lançamentos futuros'", async () => {
    const buffer = await createXlsxBuffer("lançamentos futuros", [
      ["data", "lançamento", "documento", "valor (R$)", "saldo (R$)"],
      ["03/12/2025", "TARIFA BANCARIA", "12345", "-10.00", "90.00"],
    ]);

    const input: SourceFileInput = {
      id: "test-file-3",
      originalName: "itau-statement-future.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { records, issues } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);

    expect(records.length).toBe(0);
    expect(issues.some(i => i.code === "TABULAR_SEM_MOVIMENTOS")).toBe(true);
  });

  it("should handle empty or invalid files gracefully", async () => {
    const buffer = await createXlsxBuffer("Sheet1", []); // Empty sheet

    const input: SourceFileInput = {
      id: "test-file-4",
      originalName: "empty.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { records, issues } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);
    expect(records.length).toBe(0);
    expect(issues.some(i => i.code === "TABULAR_SEM_MOVIMENTOS")).toBe(true);
  });

});
