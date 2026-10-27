import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { utils, write } from "xlsx";

import { parseSpreadsheet } from "../../src/tabular/spreadsheet-reader.js";
import { parseLedger } from "../../src/parsers/ledger.js";

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

async function createOpenpyxlStyleDateWorkbook(): Promise<Buffer> {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["DATA", "CONTA", "HISTORICO", "DEBITO", "CREDITO"],
    ["46266", "11101", "PAGAMENTO FORNECEDOR", "0", "150.25"],
  ]);
  utils.book_append_sheet(workbook, sheet, "Razao");
  const baseBuffer = Buffer.from(write(workbook, { type: "buffer", bookType: "xlsx" }));

  const archive = await JSZip.loadAsync(baseBuffer);

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="165" formatCode="Short Date"/>
  </numFmts>
  <fonts count="1">
    <font><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:E2"/>
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>
    <row r="1" spans="1:5">
      <c r="A1" t="inlineStr"><is><t>DATA</t></is></c>
      <c r="B1" t="inlineStr"><is><t>CONTA</t></is></c>
      <c r="C1" t="inlineStr"><is><t>HISTORICO</t></is></c>
      <c r="D1" t="inlineStr"><is><t>DEBITO</t></is></c>
      <c r="E1" t="inlineStr"><is><t>CREDITO</t></is></c>
    </row>
    <row r="2" spans="1:5">
      <c r="A2" s="1"><v>46266</v></c>
      <c r="B2"><v>11101</v></c>
      <c r="C2" t="inlineStr"><is><t>PAGAMENTO FORNECEDOR</t></is></c>
      <c r="D2"><v>0</v></c>
      <c r="E2"><v>150.25</v></c>
    </row>
  </sheetData>
</worksheet>`;

  archive.file("xl/styles.xml", stylesXml);
  archive.file("xl/worksheets/sheet1.xml", sheet1Xml);

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

  it("lê planilha no padrão openpyxl com formato Short Date e cabeçalhos inlineStr", async () => {
    const buffer = await createOpenpyxlStyleDateWorkbook();

    const spreadsheetResult = parseSpreadsheet({
      buffer,
      sourceFormat: "XLSX",
      fileName: "razao-short-date.xlsx",
    });

    const dateCell = spreadsheetResult.sheets[0]?.rows[1]?.cells[0];
    expect(dateCell?.displayValue).toBe("2026-09-01");
    expect(dateCell?.rawValue).toBe("2026-09-01");
    expect(dateCell?.displayValue).not.toBe("00ort 1at2026");

    const ledgerResult = await parseLedger({
      id: "ledger-short-date",
      originalName: "razao-short-date.xlsx",
      kind: "LEDGER",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });

    expect(ledgerResult.issues).toEqual([]);
    expect(ledgerResult.records).toHaveLength(1);
    expect(ledgerResult.records[0]?.date).toBe("2026-09-01");
  });

  it("converte datas seriais numéricas com numFmtId=14 (m/d/yy no SheetJS) para ISO sem inverter dia e mês nos dias 1 a 12", () => {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([["DATA", "CONTA", "HISTORICO", "DEBITO", "CREDITO"]]);
    sheet.A2 = { t: "n", v: 46266, z: "m/d/yy" };
    sheet.B2 = { t: "s", v: "11102027" };
    sheet.C2 = { t: "s", v: "TRANSF BANCARIA" };
    sheet.D2 = { t: "n", v: 0 };
    sheet.E2 = { t: "n", v: 100.5 };
    sheet["!ref"] = "A1:E2";
    utils.book_append_sheet(workbook, sheet, "Razao");

    const buffer = write(workbook, { type: "buffer", bookType: "xlsx" });
    const result = parseSpreadsheet({
      buffer: Buffer.from(buffer),
      sourceFormat: "XLSX",
    });

    const row2 = result.sheets[0]?.rows[1];
    expect(row2).toBeDefined();

    const dateCell = row2?.cells[0];
    expect(dateCell?.displayValue).toBe("2026-09-01");
    expect(dateCell?.rawValue).toBe("2026-09-01");
    expect(dateCell?.displayValue).not.toBe("9/1/26");
    expect(dateCell?.displayValue).not.toBe("2026-01-09");

    const creditCell = row2?.cells[4];
    expect(creditCell?.displayValue).toBe("100.5");
  });
});
