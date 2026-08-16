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
      ["05/12/2025", "SALDO TOTAL", "", "", "590.00"],
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

    expect(records.map((record) => record.runningBalance)).toEqual(["90.00", "590.00"]);
    expect(metadata.finalBalance).toBe("590.00");
    expect(metadata.openingBalance).toBe("100.00");
    expect(metadata.closingBalance).toBe("590.00");
    expect(metadata.balanceCheck).toEqual(expect.objectContaining({
      status: "PASSED",
      openingBalance: "100.00",
      creditTotal: "500.00",
      debitTotal: "-10.00",
      movementTotal: "490.00",
      expectedClosingBalance: "590.00",
      extractedClosingBalance: "590.00",
      difference: "0.00",
    }));

    expect(issues.length).toBe(0);
  });

  it("combines transaction and counterparty without dropping movements with an empty counterparty", async () => {
    const buffer = await createXlsxBuffer("lancamentos", [
      ["Itau Empresas"],
      ["Agencia:", "0191"],
      ["Conta:", "0026775-6"],
      [],
      ["Data", "Lancamento", "Ag/origem", "Razao Social", "CPF/CNPJ", "Valor (R$)", "Saldo (R$)"],
      ["01/12/2025", "PAGAMENTOS A FORNECEDORES", "", "VIVO FIXO NAC", "02.558.157/0001-62", "-108,29", "891,71"],
      ["02/12/2025", "TARIFA BANCARIA", "", "", "", "-10,00", "881,71"],
    ]);

    const input: SourceFileInput = {
      id: "test-file-aliases",
      originalName: "itau-colunas-completas.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { records, issues } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.value)).toEqual(["-108.29", "-10.00"]);
    expect(records[0]?.history).toBe("PAGAMENTOS A FORNECEDORES - VIVO FIXO NAC");
    expect(records[0]?.document).toBe("02.558.157/0001-62");
    expect(records[1]?.history).toBe("TARIFA BANCARIA");
    expect(issues).toEqual([]);
  });

  it("does not expose an intermediate running balance as the final balance", async () => {
    const buffer = await createXlsxBuffer("lancamentos", [
      ["Itau Empresas"],
      ["Agencia:", "0191"],
      ["Conta:", "0026775-6"],
      ["Data", "Lancamento", "Valor (R$)", "Saldo (R$)"],
      ["01/12/2025", "PAGAMENTO", "-10,00", "90,00"],
      ["02/12/2025", "RECEBIMENTO", "20,00", ""],
    ]);

    const input: SourceFileInput = {
      id: "test-file-partial-balance",
      originalName: "itau-saldo-parcial.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { metadata } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);

    expect(metadata.balanceCheck?.status).toBe("NOT_AVAILABLE");
    expect(metadata.finalBalance).toBeUndefined();
  });

  it("reads structural balances when the description starts with the configured marker", async () => {
    const buffer = await createXlsxBuffer("lancamentos", [
      ["Itau Empresas"],
      ["Agencia:", "0191"],
      ["Conta:", "0026775-6"],
      ["Data", "Lancamento", "Valor (R$)", "Saldo (R$)"],
      ["01/12/2025", "SALDO ANTERIOR CONTA CORRENTE", "", "100,00"],
      ["01/12/2025", "PAGAMENTO", "-10,00", "90,00"],
      ["31/12/2025", "SALDO TOTAL DISPONIVEL", "", "90,00"],
    ]);
    const input: SourceFileInput = {
      id: "test-file-prefixed-balance",
      originalName: "itau-saldo-prefixo.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { metadata, records } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);

    expect(records).toHaveLength(1);
    expect(metadata).toMatchObject({ openingBalance: "100.00", closingBalance: "90.00", finalBalance: "90.00" });
  });

  it("preserves automatic applications but excludes them from the consolidated balance control", async () => {
    const buffer = await createXlsxBuffer("lancamentos", [
      ["Itau Empresas"],
      ["Agencia:", "0191"],
      ["Conta:", "0026775-6"],
      ["Data", "Lancamento", "Valor (R$)", "Saldo (R$)"],
      ["01/12/2025", "SALDO ANTERIOR", "", "100,00"],
      ["01/12/2025", "APL APLIC AUT MAIS", "-50,00", ""],
      ["01/12/2025", "RECEBIMENTO", "10,00", ""],
      ["31/12/2025", "SALDO TOTAL", "", "110,00"],
    ]);
    const input: SourceFileInput = {
      id: "test-file-application-balance",
      originalName: "itau-aplicacao-saldo.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { metadata, records } = await parseTabularStatement(input, [ITAU_CHECKING_XLSX_V1]);

    expect(records.map((record) => record.history)).toEqual(["APL APLIC AUT MAIS", "RECEBIMENTO"]);
    expect(metadata.balanceCheck).toMatchObject({ status: "PASSED", movementTotal: "10.00" });
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
