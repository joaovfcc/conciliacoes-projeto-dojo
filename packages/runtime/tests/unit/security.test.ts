import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../src/config";
import { LocalObjectStore } from "../../src/object-store";
import { MemorySessionStore } from "../../src/session-store";
import { parseTsv, RuntimeServices } from "../../src/services";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function runtime() {
  const path = await mkdtemp(join(tmpdir(), "reconciliation_test_")); temporaryDirectories.push(path);
  const config = { ...loadRuntimeConfig({}), localStoragePath: path, heartbeatGraceSeconds: 1 };
  const sessions = new MemorySessionStore(config);
  return new RuntimeServices(config, sessions, new LocalObjectStore(config));
}

describe("isolamento de sessões anônimas", () => {
  it("usa 256 bits e impede que o token de outra sessão conceda acesso", async () => {
    const services = await runtime();
    const first = await services.sessions.create("cliente-a");
    const second = await services.sessions.create("cliente-b");
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(await services.sessions.authorize(first.session.id, second.token)).toBeNull();
    expect(await services.sessions.authorize(first.session.id, first.token)).not.toBeNull();
    expect(JSON.stringify(first.session)).not.toContain(first.token);
    expect(await services.sessions.countActive("cliente-a")).toBe(1);
    expect(await services.sessions.countCreatedLastHour("cliente-a")).toBe(1);
  });

  it("elimina a sessão após a tolerância sem heartbeat", async () => {
    const services = await runtime();
    const created = await services.sessions.create("cliente-c");
    const session = (await services.sessions.get(created.session.id))!;
    session.lastHeartbeatAt = new Date(Date.now() - 2_000).toISOString();
    await services.sessions.save(session);
    expect(await services.sweep()).toBe(1);
    expect(await services.sessions.get(session.id)).toBeNull();
  });
});

describe("defesa de arquivos públicos", () => {
  it("rejeita componente de macro oculto dentro de um XLSX e remove o objeto", async () => {
    const services = await runtime();
    const created = await services.sessions.create("cliente-d");
    const session = (await services.sessions.get(created.session.id))!;
    const payload = fakeZipCentralDirectory("xl/vbaProject.bin");
    const registration = await services.registerUpload(session, { kind: "LEDGER", originalName: "razao.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: payload.length });
    await services.objects.put(registration.file.objectKey, payload, registration.file.contentType);
    await expect(services.completeUpload(session, registration.file.id)).rejects.toMatchObject({ code: "MACRO_REJEITADA" });
    await expect(services.objects.get(registration.file.objectKey)).rejects.toBeDefined();
  });
});

describe("OCR em TSV", () => {
  it("preserva linhas com o mesmo line_num em blocos diferentes", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\t29/01",
      "5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t94\tTRIBUTO",
      "5\t1\t2\t1\t1\t1\t0\t0\t1\t1\t93\t30/01",
      "5\t1\t2\t1\t1\t2\t0\t0\t1\t1\t92\tPIX",
    ].join("\n");

    expect(parseTsv(tsv).text).toBe("29/01 TRIBUTO\n30/01 PIX");
  });

  it("exige que o idioma português esteja configurado", () => {
    expect(() => loadRuntimeConfig({ PDF_OCR_LANGUAGE: "eng" })).toThrow("idioma português");
    expect(loadRuntimeConfig({ PDF_OCR_LANGUAGE: "por" }).ocrLanguage).toBe("por");
  });
});

function fakeZipCentralDirectory(name: string): Buffer {
  const filename = Buffer.from(name);
  const buffer = Buffer.alloc(46 + filename.length);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt32LE(10, 20);
  buffer.writeUInt32LE(10, 24);
  buffer.writeUInt16LE(filename.length, 28);
  filename.copy(buffer, 46);
  return buffer;
}
