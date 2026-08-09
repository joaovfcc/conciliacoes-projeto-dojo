import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseSpreadsheet } from "../../src/tabular/spreadsheet-reader.js";

describe("regressão tabular sem documentos financeiros privados", () => {
  it("preserva abas, linhas e posições de uma planilha sintética", async () => {
    const workbook = new ExcelJS.Workbook();
    const movements = workbook.addWorksheet("Lançamentos");
    movements.addRow(["Atualização:", "05/08/2026 09:39:54"]);
    movements.addRow(["Data", "Lançamento", "Valor", "Saldo"]);
    movements.addRow(["01/12/2025", "PAGAMENTO", "-10,00", "90,00"]);
    const future = workbook.addWorksheet("Lançamentos Futuros");
    future.addRow(["Data", "Lançamento", "Valor"]);
    future.addRow(["02/01/2026", "AGENDAMENTO", "-20,00"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const document = parseSpreadsheet({ buffer, sourceFormat: "XLSX", fileName: "sintetico.xlsx" });

    expect(document.sheets.map((sheet) => sheet.name)).toEqual(["Lançamentos", "Lançamentos Futuros"]);
    expect(document.sheets[0]?.rows[2]?.rowNumber).toBe(3);
    expect(document.sheets[0]?.rows[2]?.cells.map((cell) => cell.displayValue)).toEqual([
      "01/12/2025",
      "PAGAMENTO",
      "-10,00",
      "90,00",
    ]);
  });
});
