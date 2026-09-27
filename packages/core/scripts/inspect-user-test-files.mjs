import fs from "node:fs";
import * as xlsx from "xlsx";

function inspectFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log("Not found:", filePath);
    return;
  }
  const stat = fs.statSync(filePath);
  console.log("File:", filePath, "Size:", stat.size, "bytes");
  try {
    const reader = xlsx.readFile || xlsx.default?.readFile || (xlsx.default || xlsx);
    const wb = reader.readFile ? reader.readFile(filePath) : xlsx.read(fs.readFileSync(filePath));
    console.log("Sheet names:", wb.SheetNames);
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const utils = xlsx.utils || xlsx.default?.utils;
    const data = utils.sheet_to_json(firstSheet, { header: 1 });
    console.log("Total rows in sheet 1:", data.length);
    console.log("Sample header rows:");
    for (let i = 0; i < Math.min(8, data.length); i++) {
      console.log(`Row ${i}:`, JSON.stringify(data[i]));
    }
  } catch (e) {
    console.log("Error reading excel:", e.message);
  }
}

console.log("--- Inspecting 11102027.xlsx ---");
inspectFile("C:/Users/joao.carvalho/Documents/TESTES/ITAU/11102027.xlsx");

console.log("\n--- Inspecting 1225_11102027.xlsx ---");
inspectFile("C:/Users/joao.carvalho/Documents/TESTES/1225_11102027.xlsx");

console.log("\n--- Inspecting Itau_1_dados_limpos.xlsx ---");
inspectFile("C:/Users/joao.carvalho/Documents/TESTES/ITAU/Itau_1_dados_limpos.xlsx");
