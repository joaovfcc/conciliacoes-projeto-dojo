import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  createPrivateCorpusRecord,
  institutionHintFromOriginalName,
  listPrivateCorpusPdfFiles,
  resolvePrivateCorpusSource,
  summarizePrivateCorpus,
} from "../../src/private-corpus.js";

describe("inventário privado do corpus", () => {
  it("cria um identificador estável sem expor o nome ou o conteúdo do documento", () => {
    const record = createPrivateCorpusRecord({
      originalName: "empresa confidencial - conta 12345.pdf",
      buffer: Buffer.from("conteúdo financeiro confidencial"),
      outcome: {
        state: "PARSED_AWAITING_ORACLE",
        sourceInstitution: "ITAU",
        bank: "ITAU",
        classification: "CURRENT_ACCOUNT",
        adapterId: "ITAU_CURRENT",
        adapterVersion: "1",
        recordCount: 3,
        issueCodes: [],
      },
    });

    expect(record).toEqual({
      documentId: "document-ffee99ddf5df1f88",
      sha256: "ffee99ddf5df1f888fb3dd4f0872ba97a35eeaf6846843c7fa893ea2fd5ce76c",
      extension: "pdf",
      state: "PARSED_AWAITING_ORACLE",
      sourceInstitution: "ITAU",
      bank: "ITAU",
      classification: "CURRENT_ACCOUNT",
      adapterId: "ITAU_CURRENT",
      adapterVersion: "1",
      recordCount: 3,
      issueCodes: [],
    });
    expect(JSON.stringify(record)).not.toContain("empresa confidencial");
    expect(JSON.stringify(record)).not.toContain("conteúdo financeiro");
  });

  it("usa o nome somente como pista de inventário, nunca como identidade bancária detectada", () => {
    expect(institutionHintFromOriginalName("itau documento privado.pdf")).toBe("ITAU");
    expect(institutionHintFromOriginalName("CEF documento privado.pdf")).toBe("CAIXA");
    expect(institutionHintFromOriginalName("arquivo-sem-pista.pdf")).toBeUndefined();
  });

  it("resume a cobertura por estado, banco, classificação e família", () => {
    const summary = summarizePrivateCorpus([
      {
        documentId: "document-a",
        sha256: "a",
        extension: "pdf",
        state: "PARSED_AWAITING_ORACLE",
        sourceInstitution: "ITAU",
        bank: "ITAU",
        classification: "CURRENT_ACCOUNT",
        adapterId: "ITAU_CURRENT",
        adapterVersion: "1",
        recordCount: 2,
        issueCodes: [],
      },
      {
        documentId: "document-b",
        sha256: "b",
        extension: "pdf",
        state: "UNSUPPORTED_LAYOUT",
        recordCount: 0,
        issueCodes: ["PDF_LAYOUT_UNSUPPORTED"],
      },
    ]);

    expect(summary.totalDocuments).toBe(2);
    expect(summary.byState).toEqual({ PARSED_AWAITING_ORACLE: 1, UNSUPPORTED_LAYOUT: 1 });
    expect(summary.byBank).toEqual({ ITAU: 1, UNKNOWN: 1 });
    expect(summary.bySourceInstitution).toEqual({ ITAU: 1, UNKNOWN: 1 });
    expect(summary.byClassification).toEqual({ CURRENT_ACCOUNT: 1, UNKNOWN: 1 });
    expect(summary.byAdapter).toEqual({ ITAU_CURRENT: 1, UNKNOWN: 1 });
  });
  it("requires exactly one absolute private source", () => {
    const directory = resolve("private-corpus");
    const archive = resolve("private-corpus.zip");
    expect(resolvePrivateCorpusSource({ directory })).toEqual({ kind: "DIRECTORY", path: directory });
    expect(resolvePrivateCorpusSource({ archive })).toEqual({ kind: "ZIP", path: archive });
    expect(() => resolvePrivateCorpusSource({})).toThrow("PRIVATE_CORPUS_DIR or PRIVATE_CORPUS_ZIP");
    expect(() => resolvePrivateCorpusSource({ directory, archive })).toThrow("exactly one");
    expect(() => resolvePrivateCorpusSource({ directory: "corpus" })).toThrow("absolute");
  });

  it("enumerates PDFs recursively, ignores other formats and keeps deterministic order", async () => {
    const root = await mkdtemp(join(tmpdir(), "private-corpus-"));
    try {
      await mkdir(join(root, "institution", "family"), { recursive: true });
      await writeFile(join(root, "z.pdf"), "%PDF-z");
      await writeFile(join(root, "institution", "a.PDF"), "%PDF-a");
      await writeFile(join(root, "institution", "family", "b.pdf"), "%PDF-b");
      await writeFile(join(root, "institution", "ignore.csv"), "date;value");

      const files = await listPrivateCorpusPdfFiles(root);
      const canonicalRoot = await realpath(root);

      expect(files.map((file) => file.relativeName)).toEqual([
        "institution/a.PDF",
        "institution/family/b.pdf",
        "z.pdf",
      ]);
      expect(files.every((file) => file.absolutePath.startsWith(canonicalRoot))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
