import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import { institutionHintFromOriginalName } from "../packages/core/dist/src/private-corpus.js";
import { loadRuntimeConfig } from "../packages/runtime/dist/src/config.js";
import { LocalObjectStore } from "../packages/runtime/dist/src/object-store.js";
import { MemorySessionStore } from "../packages/runtime/dist/src/session-store.js";
import { RuntimeServices } from "../packages/runtime/dist/src/services.js";

const fixtureDirectory = requiredDirectory("PRIVATE_STATEMENTS_DIR");
const ledgerPath = requiredFile("PRIVATE_LEDGER_FILE");
const reportPath = requiredFile("PRIVATE_STATEMENT_TEST_REPORT", false);
const storagePath = await mkdtemp(join(tmpdir(), "conciliacao-private-test-"));
const config = { ...loadRuntimeConfig(process.env), localStoragePath: storagePath, antivirusRequired: false };
const runtime = new RuntimeServices(config, new MemorySessionStore(config), new LocalObjectStore(config));
const ledgerBuffer = await readFile(ledgerPath);
const pdfEntries = (await readdir(fixtureDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
  .sort((left, right) => left.name.localeCompare(right.name));
const results = [];
const batchResults = [];

try {
  for (const entry of pdfEntries) {
    const pdfPath = join(fixtureDirectory, entry.name);
    const pdfBuffer = await readFile(pdfPath);
    const sha256 = createHash("sha256").update(pdfBuffer).digest("hex");
    const documentId = `document-${sha256.slice(0, 16)}`;
    const created = await runtime.sessions.create(`private-test-${documentId}`);
    const session = await runtime.sessions.authorize(created.session.id, created.token);
    if (!session) throw new Error("Falha ao autorizar sessão privada de teste.");
    try {
      await upload(session, "LEDGER", `ledger-${createHash("sha256").update(ledgerBuffer).digest("hex").slice(0, 16)}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ledgerBuffer);
      await upload(session, "STATEMENT", `${documentId}.pdf`, "application/pdf", pdfBuffer);
      await runtime.preflight(session);
      const updated = await runtime.sessions.get(session.id);
      const detected = updated?.preflight?.statements[0];
      results.push({
        documentId,
        sha256,
        sourceInstitution: institutionHintFromOriginalName(entry.name) ?? "UNKNOWN",
        state: updated?.status ?? "UNKNOWN",
        bank: detected?.bank || "UNKNOWN",
        classification: detected?.classification ?? "UNKNOWN",
        parser: detected?.parser ?? "UNKNOWN",
        recordCount: detected?.recordCount ?? 0,
        balanceStatus: detected?.balanceCheck?.status ?? "NOT_AVAILABLE",
        issueCodes: [...new Set(updated?.preflight?.issues.map((issue) => issue.code) ?? [])].sort(),
      });
    } catch (error) {
      results.push({
        documentId,
        sha256,
        sourceInstitution: institutionHintFromOriginalName(entry.name) ?? "UNKNOWN",
        state: "FAILED",
        errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : "UNEXPECTED_ERROR",
      });
    } finally {
      const current = await runtime.sessions.get(session.id);
      if (current) await runtime.cleanup(current);
    }
  }

  for (let offset = 0; offset < pdfEntries.length; offset += 5) {
    const entries = pdfEntries.slice(offset, offset + 5);
    const batchNumber = Math.floor(offset / 5) + 1;
    const created = await runtime.sessions.create(`private-batch-${batchNumber}`);
    const session = await runtime.sessions.authorize(created.session.id, created.token);
    if (!session) throw new Error("Falha ao autorizar sessao privada de teste em lote.");
    try {
      await upload(session, "LEDGER", `ledger-${createHash("sha256").update(ledgerBuffer).digest("hex").slice(0, 16)}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ledgerBuffer);
      for (const entry of entries) {
        const pdfBuffer = await readFile(join(fixtureDirectory, entry.name));
        const documentId = `document-${createHash("sha256").update(pdfBuffer).digest("hex").slice(0, 16)}`;
        await upload(session, "STATEMENT", `${documentId}.pdf`, "application/pdf", pdfBuffer);
      }
      await runtime.preflight(session);
      const updated = await runtime.sessions.get(session.id);
      const statements = updated?.preflight?.statements ?? [];
      batchResults.push({
        batchNumber,
        statementCount: entries.length,
        state: updated?.status ?? "UNKNOWN",
        detectedStatements: statements.length,
        classifications: countBy(statements, (item) => item.classification ?? "UNKNOWN"),
        issueCodes: [...new Set(updated?.preflight?.issues.map((issue) => issue.code) ?? [])].sort(),
      });
    } catch (error) {
      batchResults.push({
        batchNumber,
        statementCount: entries.length,
        state: "FAILED",
        errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : "UNEXPECTED_ERROR",
      });
    } finally {
      const current = await runtime.sessions.get(session.id);
      if (current) await runtime.cleanup(current);
    }
  }

  const summary = {
    totalDocuments: results.length,
    totalBatches: batchResults.length,
    byState: countBy(results, (item) => item.state),
    byBatchState: countBy(batchResults, (item) => item.state),
    byErrorCode: countBy(results.filter((item) => item.errorCode), (item) => item.errorCode),
    byClassification: countBy(results, (item) => item.classification ?? "UNKNOWN"),
    byBalanceStatus: countBy(results, (item) => item.balanceStatus ?? "NOT_AVAILABLE"),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ schemaVersion: 2, summary, documents: results, batches: batchResults }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
  await rm(storagePath, { recursive: true, force: true });
}

async function upload(session, kind, originalName, contentType, buffer) {
  const registered = await runtime.registerUpload(session, { kind, originalName, contentType, size: buffer.length });
  await runtime.objects.put(registered.file.objectKey, buffer, contentType);
  await runtime.completeUpload(session, registered.file.id);
}

function requiredDirectory(name) {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error(`${name} deve apontar para uma pasta privada absoluta.`);
  return value;
}

function requiredFile(name, mustExist = true) {
  const value = process.env[name];
  if (!value || !isAbsolute(value) || (mustExist && !basename(value))) throw new Error(`${name} deve apontar para um arquivo privado absoluto.`);
  return value;
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
