import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import yauzl from "yauzl";

import { StatementParseError, preflightFiles } from "../dist/src/index.js";
import {
  createPrivateCorpusRecord,
  institutionHintFromOriginalName,
  listPrivateCorpusPdfFiles,
  resolvePrivateCorpusSource,
  summarizePrivateCorpus,
} from "../dist/src/private-corpus.js";

const source = resolvePrivateCorpusSource({
  directory: process.env.PRIVATE_CORPUS_DIR,
  archive: process.env.PRIVATE_CORPUS_ZIP,
});
const reportPath = requiredAbsolutePath("PRIVATE_CORPUS_REPORT");
const records = source.kind === "DIRECTORY"
  ? await inspectDirectory(source.path)
  : await inspectArchive(source.path);
const expectedCount = optionalExpectedCount();
if (expectedCount !== undefined && records.length !== expectedCount) {
  throw new Error(`Corpus incompleto: esperados ${expectedCount} PDFs, encontrados ${records.length}.`);
}
records.sort((left, right) => left.documentId.localeCompare(right.documentId));
const report = {
  schemaVersion: 2,
  sourceKind: source.kind,
  documents: records,
  summary: summarizePrivateCorpus(records),
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${JSON.stringify(report.summary)}\n`);

async function inspectDirectory(path) {
  const files = await listPrivateCorpusPdfFiles(path);
  const records = [];
  for (const file of files) {
    records.push(await inspectDocument(file.relativeName, await readFile(file.absolutePath)));
  }
  return records;
}

async function inspectArchive(path) {
  const archive = await openArchive(path);
  const records = [];
  try {
    const entries = await pdfEntries(archive);
    for (const entry of entries) {
      const buffer = await entryBuffer(archive, entry);
      records.push(await inspectDocument(entry.fileName, buffer));
    }
    return records;
  } finally {
    archive.close();
  }
}

async function inspectDocument(originalName, buffer) {
  try {
    const result = await preflightFiles(ledger(), [{
      id: "private-corpus-source",
      originalName,
      kind: "STATEMENT",
      contentType: "application/pdf",
      buffer,
    }], undefined, { maxPdfPages: 100 });
    const statement = result.preflight.statements[0];
    const issueCodes = result.preflight.issues.map((issue) => issue.code);
    const hasError = result.preflight.issues.some((issue) => issue.severity === "ERROR");
    const parser = statement?.parser;
    const parserMatch = parser?.match(/^(.*)_V(\d+)$/);
    return createPrivateCorpusRecord({
      originalName,
      buffer,
      outcome: {
        state: hasError ? "PARSED_WITH_INTEGRITY_ERROR" : "PARSED_AWAITING_ORACLE",
        ...(institutionHintFromOriginalName(originalName) ? { sourceInstitution: institutionHintFromOriginalName(originalName) } : {}),
        ...(statement?.bank ? { bank: statement.bank } : {}),
        ...(statement?.classification ? { classification: statement.classification } : {}),
        ...(parserMatch ? { adapterId: parserMatch[1], adapterVersion: parserMatch[2] } : {}),
        recordCount: statement?.recordCount ?? 0,
        issueCodes,
      },
    });
  } catch (error) {
    const code = error instanceof StatementParseError ? error.code : "PDF_INVALID";
    return createPrivateCorpusRecord({
      originalName,
      buffer,
      outcome: { state: stateFor(code), ...(institutionHintFromOriginalName(originalName) ? { sourceInstitution: institutionHintFromOriginalName(originalName) } : {}), recordCount: 0, issueCodes: [code] },
    });
  }
}

function stateFor(code) {
  return {
    PDF_OCR_UNAVAILABLE: "AWAITING_OCR",
    PDF_LAYOUT_UNSUPPORTED: "UNSUPPORTED_LAYOUT",
    DOCUMENT_CLASSIFICATION_AMBIGUOUS: "AMBIGUOUS_CLASSIFICATION",
    PDF_PASSWORD_PROTECTED: "PASSWORD_PROTECTED",
    PDF_INVALID: "INVALID_FILE",
  }[code] ?? "INVALID_FILE";
}

function ledger() {
  return {
    id: "inventory-ledger",
    originalName: "inventory.csv",
    kind: "LEDGER",
    contentType: "text/csv",
    buffer: Buffer.from("EMPRESA,FILIAL,CONTA,DATA,DOCUMENTO,HISTORICO,VALOR\nINVENTARIO,01,111,2025-12-01,1,INVENTARIO,0.00\n"),
  };
}

function requiredAbsolutePath(name) {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error(`${name} deve apontar para um caminho absoluto privado.`);
  return value;
}

function optionalExpectedCount() {
  const value = process.env.PRIVATE_CORPUS_EXPECTED_PDFS?.trim();
  if (!value) return undefined;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("PRIVATE_CORPUS_EXPECTED_PDFS deve ser um inteiro positivo.");
  }
  return count;
}

function openArchive(path) {
  return new Promise((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, archive) => error ? reject(error) : resolve(archive)));
}

function pdfEntries(archive) {
  return new Promise((resolve, reject) => {
    const entries = [];
    archive.on("entry", (entry) => {
      if (!/\/$/.test(entry.fileName) && /\.pdf$/i.test(entry.fileName)) entries.push(entry);
      archive.readEntry();
    });
    archive.once("error", reject);
    archive.once("end", () => resolve(entries));
    archive.readEntry();
  });
}

function entryBuffer(archive, entry) {
  return new Promise((resolve, reject) => archive.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error ?? new Error("Entrada do corpus sem fluxo de leitura."));
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  }));
}
