import fs from "fs";
import { test, expect } from "vitest";
import { parseSpreadsheet } from "../../src/tabular/spreadsheet-reader.js";

test("le planilha Itau 1.xlsx corretamente", () => {
  const filePath = "C:\\Users\\joao.carvalho\\Documents\\TESTES\\ITAU\\Itau 1.xlsx";
  const buffer = fs.readFileSync(filePath);
  
  const result = parseSpreadsheet({
    buffer,
    sourceFormat: "XLSX",
    fileName: "Itau 1.xlsx"
  });
  
  console.log("Metadata:", result.metadata);
  console.log("Sheets:", result.sheets.map(s => ({
    name: s.name,
    hidden: s.hidden,
    rows: s.rows.length
  })));
  
  if (result.sheets.length > 0) {
    const firstSheet = result.sheets[0];
    if (firstSheet) {
      console.log(`\nFirst 5 rows of sheet ${firstSheet.name}:`);
      firstSheet.rows.slice(0, 5).forEach(r => {
        console.log(`Row ${r.rowNumber}: ${r.cells.map(c => c.displayValue).join(" | ")}`);
      });
    }
  }

  expect(result.metadata.totalSheets).toBeGreaterThan(0);
});
