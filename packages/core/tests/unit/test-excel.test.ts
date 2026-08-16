import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { utils, write } from "xlsx";

import { parseSpreadsheet } from "../../src/tabular/spreadsheet-reader.js";

async function replaceWorksheetDimension(buffer: Buffer, declaredRange: string): Promise<Buffer> {
  const archive = await JSZip.loadAsync(buffer);
  const worksheetPath = "xl/worksheets/sheet1.xml";
  const worksheet = archive.file(worksheetPath);
  if (!worksheet) throw new Error("Synthetic worksheet XML was not generated.");
  const xml = await worksheet.async("string");
  const replaced = xml.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="${declaredRange}"/>`);
  if (replaced === xml) throw new Error("Synthetic worksheet dimension was not replaced.");
  archive.file(worksheetPath, replaced);
  return archive.generateAsync({ type: "nodebuffer" });
}

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

  it("preserves physical cells outside the declared range and keeps real row numbers", async () => {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([
      ["Extrato Itau"],
      [],
      ["Data", "Lancamento", "Valor (R$)"],
      ["01/12/2025", "PAGAMENTO", "-108,29"],
      ["02/12/2025", "RECEBIMENTO", "500,00"],
    ]);
    utils.book_append_sheet(workbook, sheet, "Lancamentos");
    const original = Buffer.from(write(workbook, { type: "buffer", bookType: "xlsx" }));
    const malformed = await replaceWorksheetDimension(original, "A1:C1");

    const result = parseSpreadsheet({
      buffer: malformed,
      sourceFormat: "XLSX",
      fileName: "itau-intervalo-incorreto.xlsx",
    });

    expect(result.sheets[0]?.rows.map((row) => row.rowNumber)).toEqual([1, 3, 4, 5]);
    expect(result.sheets[0]?.rows[2]?.cells.map((cell) => cell.displayValue)).toEqual([
      "01/12/2025",
      "PAGAMENTO",
      "-108,29",
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "WORKSHEET_RANGE_REPAIRED", sheetName: "Lancamentos" }),
    ]));
  });

  it("rejects a distant physical cell before materializing an oversized range", async () => {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([["Data"]]);
    sheet.A500 = { t: "s", v: "01/12/2025" };
    sheet["!ref"] = "A1:A500";
    utils.book_append_sheet(workbook, sheet, "Lancamentos");
    const original = Buffer.from(write(workbook, { type: "buffer", bookType: "xlsx" }));
    const malformed = await replaceWorksheetDimension(original, "A1");

    expect(() => parseSpreadsheet({
      buffer: malformed,
      sourceFormat: "XLSX",
      limits: { maxCells: 100 },
    })).toThrowError(expect.objectContaining({ code: "CELL_LIMIT_EXCEEDED" }));
  });
});
