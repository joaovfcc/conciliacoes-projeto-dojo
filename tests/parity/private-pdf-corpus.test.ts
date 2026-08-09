import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preflightFiles, type SourceFileInput } from "../../packages/core/src/index";
import { validatePrivateStatementOracles, type PrivateStatementOracle } from "../../packages/core/src/private-oracle";
import { loadRuntimeConfig } from "../../packages/runtime/src/config";
import { createOcrProvider } from "../../packages/runtime/src/services";

const fixtureDirectory = process.env.PARITY_FIXTURES_DIR;
const manifestPath = fixtureDirectory ? join(fixtureDirectory, "statement-parser-manifest.json") : "";
const hasPrivateCorpus = fixtureDirectory ? await exists(manifestPath) : false;
const parityRequired = process.env.PARITY_REQUIRED === "1";

describe("disponibilidade da paridade privada", () => {
  it("falha explicitamente no gate de release quando o corpus homologado não está disponível", () => {
    expect(parityRequired && !hasPrivateCorpus).toBe(false);
  });
});

describe.skipIf(!hasPrivateCorpus)("corpus privado de extratos PDF", () => {
  it("mantém classificação, parser, metadados e quantidade homologados por hash", async () => {
    const expected = JSON.parse(await readFile(manifestPath, "utf8")) as PrivateStatementOracle[];
    expect(validatePrivateStatementOracles(expected)).toEqual([]);
    const sources = await sourcesByHash(fixtureDirectory!);
    const ocr = createOcrProvider(loadRuntimeConfig(process.env), async () => false);
    for (const item of expected) {
      const buffer = sources.get(item.fileSha256.toLowerCase());
      expect(buffer, `PDF privado ausente para o hash ${item.fileSha256.slice(0, 12)}`).toBeDefined();
      const source: SourceFileInput = {
        id: item.fileSha256,
        originalName: `private-${item.fileSha256.slice(0, 16)}.pdf`,
        kind: "STATEMENT",
        contentType: "application/pdf",
        buffer: buffer!,
      };
      const result = await preflightFiles(ledger(), [source], ocr, { maxPdfPages: 100 });
      const detected = result.preflight.statements[0]!;
      expect(detected).toMatchObject({
        classification: item.classification,
        bank: item.bank,
        ...(item.agency ? { agency: item.agency } : {}),
        ...(item.account ? { account: item.account } : {}),
        periods: item.periods,
        recordCount: item.recordCount,
        ...(item.finalBalance ? { finalBalance: item.finalBalance } : {}),
        ...(item.balanceCheck ? { balanceCheck: { status: item.balanceCheck } } : {}),
      });
      expect(detected.parser).toBe(`${item.adapterId}_V${item.adapterVersion}`);
      expect(result.statements.some((record) => /saldo/i.test(record.history) && record.evidence.parser?.includes("CC"))).toBe(false);
      if (item.classification !== "CURRENT_ACCOUNT") {
        expect(detected.reconciliationEligible).toBe(false);
        expect(result.statements).toEqual([]);
      }
    }
  });
});

function ledger(): SourceFileInput {
  return {
    id: "ledger",
    originalName: "razao.csv",
    kind: "LEDGER",
    contentType: "text/csv",
    buffer: Buffer.from("EMPRESA,FILIAL,CONTA,DATA,DOCUMENTO,HISTORICO,VALOR\nEMPRESA,01,111,2025-12-01,1,TESTE,1.00\n"),
  };
}

async function sourcesByHash(directory: string): Promise<Map<string, Buffer>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = new Map<string, Buffer>();
  for (const entry of entries.filter((item) => item.isFile() && item.name.toLowerCase().endsWith(".pdf"))) {
    const buffer = await readFile(join(directory, entry.name));
    sources.set(createHash("sha256").update(buffer).digest("hex"), buffer);
  }
  return sources;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}
