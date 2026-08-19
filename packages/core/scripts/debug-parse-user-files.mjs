import fs from "node:fs";
import { parseLedger } from "../dist/src/parsers/ledger.js";
import { parseStatement } from "../dist/src/preflight.js";

async function run() {
  console.log("=== Debugging file parsers on real user files ===");

  const ledgerFile1 = {
    id: "ledger-1",
    originalName: "1225_11102027.xlsx",
    kind: "LEDGER",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fs.readFileSync("C:/Users/joao.carvalho/Documents/TESTES/1225_11102027.xlsx"),
  };

  const ledgerFile2 = {
    id: "ledger-2",
    originalName: "11102027.xlsx",
    kind: "LEDGER",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fs.readFileSync("C:/Users/joao.carvalho/Documents/TESTES/ITAU/11102027.xlsx"),
  };

  const statementFile = {
    id: "statement-1",
    originalName: "Itau_1_dados_limpos.xlsx",
    kind: "STATEMENT",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fs.readFileSync("C:/Users/joao.carvalho/Documents/TESTES/ITAU/Itau_1_dados_limpos.xlsx"),
  };

  console.log("\n--- Testing 1225_11102027.xlsx ---");
  try {
    const l1 = await parseLedger(ledgerFile1);
    console.log("L1 Records:", l1.records.length);
    console.log("L1 Metadata:", l1.metadata);
    console.log("L1 Issues:", l1.issues);
    if (l1.records.length > 0) {
      console.log("L1 Sample record 0:", l1.records[0]);
    }
  } catch (e) {
    console.error("L1 Error:", e);
  }

  console.log("\n--- Testing 11102027.xlsx ---");
  try {
    const l2 = await parseLedger(ledgerFile2);
    console.log("L2 Records:", l2.records.length);
    console.log("L2 Metadata:", l2.metadata);
    console.log("L2 Issues:", l2.issues);
  } catch (e) {
    console.error("L2 Error:", e);
  }

  console.log("\n--- Testing Itau_1_dados_limpos.xlsx ---");
  try {
    const s1 = await parseStatement(statementFile);
    console.log("S1 Records:", s1.records.length);
    console.log("S1 Metadata:", s1.metadata);
    console.log("S1 Issues:", s1.issues);
    if (s1.records.length > 0) {
      console.log("S1 Sample record 0:", s1.records[0]);
      console.log("S1 Sample record last:", s1.records[s1.records.length - 1]);
    }
  } catch (e) {
    console.error("S1 Error:", e);
  }
}

run().catch(console.error);
