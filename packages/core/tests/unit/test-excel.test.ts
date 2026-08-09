import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import { parseSpreadsheet } from "../../src/tabular/spreadsheet-reader.js";

describe("leitura de planilha bancária XLSX", () => {
  it("extrai metadados e linhas de uma planilha sintética", () => {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([
      ["Data", "Histórico", "Valor"],
      ["01/12/2025", "Tarifa bancária", "-10,00"],
    ]);
    utils.book_append_sheet(workbook, sheet, "Extrato");
    const buffer = write(workbook, { type: "buffer", bookType: "xlsx" });

    const result = parseSpreadsheet({
      buffer,
      sourceFormat: "XLSX",
      fileName: "extrato-sintetico.xlsx",
    });

    expect(result.metadata.totalSheets).toBe(1);
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0]?.name).toBe("Extrato");
    expect(result.sheets[0]?.rows).toHaveLength(2);
    expect(result.sheets[0]?.rows[1]?.cells.map((cell) => cell.displayValue)).toEqual([
      "01/12/2025",
      "Tarifa bancária",
      "-10,00",
    ]);
  });
});
