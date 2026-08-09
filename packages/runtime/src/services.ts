import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { bankAccountsConflict, generateXlsx, preflightFiles, reconcile, StatementParseError, type ConfirmProcessingRequest, type OcrProvider, type SourceFileInput } from "@conciliacao/core";
import { Queue } from "bullmq";
import type { RuntimeConfig } from "./config.js";
import type { ObjectStore } from "./object-store.js";
import type { SessionStore } from "./session-store.js";
import type { ReconciliationSession, StoredFile } from "./types.js";

export class RuntimeServices {
  constructor(readonly config: RuntimeConfig, readonly sessions: SessionStore, readonly objects: ObjectStore) {}

  async registerUpload(session: ReconciliationSession, input: { kind: "LEDGER" | "STATEMENT"; originalName: string; contentType: string; size: number }): Promise<{ file: StoredFile; uploadUrl: string | null }> {
    validateUploadShape(session, input, this.config);
    const file: StoredFile = { id: randomBytes(12).toString("hex"), kind: input.kind, originalName: input.originalName, contentType: input.contentType, size: input.size, objectKey: `${session.id}/${randomBytes(24).toString("hex")}` };
    session.files.push(file); session.status = "UPLOADING"; session.progressMessage = "Recebendo arquivos."; await this.sessions.save(session);
    return { file, uploadUrl: await this.objects.authorizeUpload(file.objectKey, file.contentType, file.size) };
  }

  async completeUpload(session: ReconciliationSession, fileId: string): Promise<StoredFile> {
    const file = session.files.find((item) => item.id === fileId); if (!file) throw new PublicRuntimeError("ARQUIVO_NAO_ENCONTRADO", "O arquivo não pertence a esta sessão.", 404);
    try {
    const buffer = await this.objects.get(file.objectKey); if (buffer.length !== file.size) throw new PublicRuntimeError("TAMANHO_DIVERGENTE", "O tamanho recebido difere do upload autorizado.", 400);
    validateSignature(file, buffer); validateOfficeArchive(file, buffer); await scanBuffer(buffer, file.originalName, this.config);
    file.sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicate = session.files.find((item) => item.id !== file.id && item.sha256 === file.sha256); if (duplicate) throw new PublicRuntimeError("ARQUIVO_DUPLICADO", "O mesmo conteúdo foi enviado mais de uma vez.", 400);
    const ledgerCount = session.files.filter((item) => item.kind === "LEDGER" && item.sha256).length;
    const statementCount = session.files.filter((item) => item.kind === "STATEMENT" && item.sha256).length;
    session.status = ledgerCount === 1 && statementCount >= 1 ? "READY" : "UPLOADING"; await this.sessions.save(session); return file;
    } catch (error) {
      await this.objects.delete(file.objectKey).catch(() => undefined);
      session.files = session.files.filter((item) => item.id !== file.id);
      await this.sessions.save(session);
      throw error;
    }
  }

  async preflight(session: ReconciliationSession): Promise<void> {
    const ledger = session.files.find((item) => item.kind === "LEDGER" && item.sha256); const statements = session.files.filter((item) => item.kind === "STATEMENT" && item.sha256);
    if (!ledger || statements.length === 0) throw new PublicRuntimeError("ARQUIVOS_INCOMPLETOS", "Envie um razão e ao menos um extrato antes da pré-análise.", 400);
    session.status = "PREFLIGHT"; session.progress = 15; session.progressMessage = "Identificando arquivos e contas."; await this.sessions.save(session);
    let bundle;
    try {
      bundle = await preflightFiles(await this.loadFile(ledger), await Promise.all(statements.map((item) => this.loadFile(item))), createOcrProvider(this.config, async () => !(await this.sessions.get(session.id))), { maxPdfPages: this.config.maxPdfPages });
    } catch (error) {
      const publicError = preflightError(error);
      session.status = "FAILED"; session.errorCode = publicError.code; session.errorMessage = publicError.message; session.progressMessage = session.errorMessage; await this.sessions.save(session); await this.deleteFiles(session);
      throw publicError;
    }
    session.preflight = bundle.preflight; session.ledgers = bundle.ledgers; session.statements = bundle.statements; session.investments = bundle.investments; session.status = "AWAITING_CONFIRMATION"; delete session.pendingAction; session.progress = 35; session.progressMessage = "Pré-análise concluída; confirme os dados detectados."; await this.sessions.save(session);
  }

  async enqueuePreflight(session: ReconciliationSession): Promise<void> {
    if (!this.config.redisUrl) { await this.preflight(session); return; }
    const queue = processingQueue(this.config.redisUrl);
    try { await assertQueueCapacity(queue, this.config.maxQueuedJobs); }
    catch (error) { await this.cleanup(session); throw error; }
    session.status = "QUEUED"; session.pendingAction = "PREFLIGHT"; session.progress = 10; session.progressMessage = "Pré-análise aguardando o worker."; await this.sessions.save(session);
    await queue.add("preflight", { sessionId: session.id, action: "preflight" }, { jobId: `${session.id}-preflight`, removeOnComplete: 100, removeOnFail: 100, attempts: 1 });
  }

  async process(session: ReconciliationSession, confirmation: ConfirmProcessingRequest): Promise<void> {
    if (!session.ledgers || !session.statements || !session.preflight) throw new PublicRuntimeError("PREFLIGHT_AUSENTE", "Execute a pré-análise antes de confirmar.", 409);
    validateConfirmation(confirmation, session);
    session.confirmation = confirmation; session.status = "RECONCILING"; session.progress = 65; session.progressMessage = "Aplicando as regras de conciliação."; await this.sessions.save(session);
    try {
      const result = reconcile(session.ledgers, session.statements, confirmation); result.issues = [...session.preflight.issues, ...result.issues]; result.files = session.preflight.statements; result.investments = session.investments ?? [];
      session.result = result; session.status = result.issues.some((item) => item.severity === "ERROR") || result.results.some((item) => item.decisionLevel !== "AUTOMATIC") ? "COMPLETED_WITH_ISSUES" : "COMPLETED"; session.progress = 100; session.progressMessage = "Conciliação concluída."; delete session.ledgers; delete session.statements; delete session.investments; await this.sessions.save(session);
    } catch (error) {
      session.status = "FAILED"; session.progressMessage = "O processamento falhou de forma segura."; session.errorCode = "PROCESSAMENTO_FALHOU"; session.errorMessage = "Não foi possível processar os arquivos."; delete session.ledgers; delete session.statements; delete session.investments; await this.sessions.save(session); throw error;
    } finally { await this.deleteFiles(session); }
  }

  async enqueue(session: ReconciliationSession, confirmation: ConfirmProcessingRequest): Promise<void> {
    if (session.confirmation?.idempotencyKey === confirmation.idempotencyKey && ["QUEUED", "RECONCILING", "COMPLETED", "COMPLETED_WITH_ISSUES"].includes(session.status)) return;
    if (!session.ledgers || !session.statements || !session.preflight) throw new PublicRuntimeError("PREFLIGHT_AUSENTE", "Execute a pré-análise antes de confirmar.", 409);
    validateConfirmation(confirmation, session);
    if (!this.config.redisUrl) { await this.process(session, confirmation); return; }
    const queue = processingQueue(this.config.redisUrl);
    try { await assertQueueCapacity(queue, this.config.maxQueuedJobs); }
    catch (error) { await this.cleanup(session); throw error; }
    session.confirmation = confirmation; session.status = "QUEUED"; session.pendingAction = "PROCESS"; session.progress = 50; session.progressMessage = "Execução aguardando o worker."; await this.sessions.save(session);
    await queue.add("reconcile", { sessionId: session.id, action: "process" }, { jobId: `${session.id}-${confirmation.idempotencyKey}`, removeOnComplete: 100, removeOnFail: 100, attempts: 1 });
  }

  async export(session: ReconciliationSession): Promise<Buffer> { if (!session.result) throw new PublicRuntimeError("RESULTADO_INDISPONIVEL", "A conciliação ainda não possui resultado para exportar.", 409); return generateXlsx(session.result); }
  async cleanup(session: ReconciliationSession, status: "CANCELLED" | "EXPIRED" = "CANCELLED"): Promise<void> { session.closed = true; session.status = status; await this.deleteFiles(session); await this.sessions.delete(session.id); safeMetric("session_cleanup", { status }); }
  async heartbeat(session: ReconciliationSession): Promise<void> { session.lastHeartbeatAt = new Date().toISOString(); await this.sessions.save(session); }
  async sweep(): Promise<number> { const expired = await this.sessions.listExpired(new Date()); for (const session of expired) await this.cleanup(session, "EXPIRED"); return expired.length; }
  private async loadFile(file: StoredFile): Promise<SourceFileInput> { return { id: file.id, originalName: file.originalName, kind: file.kind, contentType: file.contentType, buffer: await this.objects.get(file.objectKey) }; }
  private async deleteFiles(session: ReconciliationSession): Promise<void> { await Promise.allSettled(session.files.map((file) => this.objects.delete(file.objectKey))); }
}

export class PublicRuntimeError extends Error { constructor(readonly code: string, message: string, readonly status = 400) { super(message); } }

function preflightError(error: unknown): PublicRuntimeError {
  if (error instanceof StatementParseError) {
    const messages: Record<StatementParseError["code"], string> = {
      PDF_LAYOUT_UNSUPPORTED: "Um dos PDFs possui um layout ainda não suportado. Envie outro formato do extrato ou contate o suporte.",
      DOCUMENT_CLASSIFICATION_AMBIGUOUS: "Não foi possível identificar com segurança o banco ou o tipo de um dos documentos enviados.",
      PDF_PASSWORD_PROTECTED: "Um dos PDFs é protegido por senha. Exporte uma cópia sem proteção antes de enviar.",
      PDF_OCR_UNAVAILABLE: "Um dos PDFs precisa de OCR em português, mas o OCR não está disponível neste ambiente.",
      PDF_INVALID: "Um dos PDFs é inválido ou não pôde ser lido com segurança.",
    };
    return new PublicRuntimeError(error.code, messages[error.code], 422);
  }
  return new PublicRuntimeError("ARQUIVO_NAO_PROCESSAVEL", "Um dos arquivos possui layout inválido ou não pôde ser lido.", 422);
}

function validateUploadShape(session: ReconciliationSession, input: { kind: "LEDGER" | "STATEMENT"; originalName: string; contentType: string; size: number }, config: RuntimeConfig): void {
  if (input.size <= 0 || input.size > config.maxFileBytes) throw new PublicRuntimeError("LIMITE_ARQUIVO", "O arquivo deve ter até 25 MB.", 413);
  const total = session.files.reduce((sum, item) => sum + item.size, 0) + input.size; if (total > config.maxSessionBytes) throw new PublicRuntimeError("LIMITE_SESSAO", "A sessão deve ter até 75 MB de arquivos.", 413);
  const extension = input.originalName.split(".").pop()?.toLowerCase(); const accepted = input.kind === "LEDGER" ? ["csv", "xlsx", "xls", "xlsm"] : ["csv", "xlsx", "xls", "xlsm", "ofx", "pdf"];
  if (!extension || !accepted.includes(extension)) throw new PublicRuntimeError("FORMATO_INVALIDO", `Formato não aceito para ${input.kind === "LEDGER" ? "razão" : "extrato"}.`, 400);
  if (session.files.some((item) => item.kind === "LEDGER") && input.kind === "LEDGER") throw new PublicRuntimeError("RAZAO_DUPLICADO", "A sessão aceita exatamente um arquivo de razão.", 400);
  if (session.files.filter((item) => item.kind === "STATEMENT").length >= config.maxStatements && input.kind === "STATEMENT") throw new PublicRuntimeError("LIMITE_EXTRATOS", `A sessão aceita no máximo ${config.maxStatements} extratos.`, 400);
}

function validateSignature(file: StoredFile, buffer: Buffer): void {
  const extension = file.originalName.split(".").pop()?.toLowerCase();
  if (extension === "pdf" && !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new PublicRuntimeError("ASSINATURA_INVALIDA", "O conteúdo não possui assinatura real de PDF.");
  if (extension === "xlsx" && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new PublicRuntimeError("ASSINATURA_INVALIDA", "O conteúdo não possui assinatura real de XLSX.");
  if (extension === "ofx" && !buffer.toString("latin1", 0, Math.min(buffer.length, 4096)).toUpperCase().includes("OFX")) throw new PublicRuntimeError("ASSINATURA_INVALIDA", "O conteúdo não parece ser um OFX.");
}

export function validateOfficeArchive(file: Pick<StoredFile, "originalName">, buffer: Buffer): void {
  const extension = file.originalName.split(".").pop()?.toLowerCase();
  if (!["xlsx", "xlsm"].includes(extension ?? "")) return;
  const centralHeader = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const endOfDirectory = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const entries: Array<{ name: string; compressed: number; uncompressed: number }> = [];
  let offset = 0;
  while ((offset = buffer.indexOf(centralHeader, offset)) >= 0) {
    if (offset + 46 > buffer.length) break;
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength;
    if (end > buffer.length) break;
    const name = buffer.toString("utf8", offset + 46, end).replace(/\\/g, "/").toLowerCase();
    entries.push({ name, compressed, uncompressed });
    offset = end + extraLength + commentLength;
    if (entries.length > 10_000) {
      throw new PublicRuntimeError("ZIP_BOMB_REJEITADO", "A planilha possui entradas demais para ser processada com segurança.");
    }
  }
  if (extension === "xlsx" && entries.some((entry) => entry.name.endsWith("/vbaproject.bin") || entry.name === "vbaproject.bin")) {
    throw new PublicRuntimeError("MACRO_REJEITADA", "Uma planilha XLSX não pode conter componentes de macro.");
  }
  if (buffer.indexOf(endOfDirectory) < 0 || entries.length === 0) {
    throw new PublicRuntimeError("ARQUIVO_OOXML_INVALIDO", "A estrutura interna da planilha é inválida.");
  }
  const totalUncompressed = entries.reduce((total, entry) => total + entry.uncompressed, 0);
  if (totalUncompressed > 100 * 1024 * 1024 || entries.some((entry) => entry.uncompressed > 0 && entry.uncompressed / Math.max(1, entry.compressed) > 100)) {
    throw new PublicRuntimeError("ZIP_BOMB_REJEITADO", "A planilha excede os limites de descompactação segura.");
  }
  if (entries.some((entry) => entry.name.startsWith("/") || entry.name.split("/").includes(".."))) {
    throw new PublicRuntimeError("CAMINHO_INTERNO_INVALIDO", "A planilha contém um caminho interno inseguro.");
  }
}

function validateConfirmation(input: ConfirmProcessingRequest, session: ReconciliationSession): void {
  if (!/^\d{6}$/.test(input.period)) throw new PublicRuntimeError("PERIODO_INVALIDO", "Informe a competência no formato AAAAMM.");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(input.valueTolerance)) throw new PublicRuntimeError("TOLERANCIA_VALOR_INVALIDA", "A tolerância de valor deve ser um decimal não negativo.");
  if (!Number.isInteger(input.dateToleranceDays) || input.dateToleranceDays < 0 || input.dateToleranceDays > 31) throw new PublicRuntimeError("TOLERANCIA_DATA_INVALIDA", "A tolerância de data deve ser um número inteiro entre 0 e 31 dias.");
  if (!input.idempotencyKey || input.idempotencyKey.length > 100) throw new PublicRuntimeError("IDEMPOTENCIA_INVALIDA", "A chave de idempotência é obrigatória.");
  const preflight = session.preflight;
  if (!preflight) throw new PublicRuntimeError("PREFLIGHT_AUSENTE", "Execute a pré-análise antes de confirmar.", 409);
  if (preflight.statements.some((item) => item.reconciliationEligible && item.balanceCheck?.status === "FAILED")) throw new PublicRuntimeError("BALANCE_INTEGRITY_FAILED", "O controle de saldo de um extrato falhou; revise o arquivo antes de conciliar.", 422);
  if (preflight.issues.some((item) => item.severity === "ERROR")) throw new PublicRuntimeError("PREFLIGHT_BLOQUEADO", "A pré-análise identificou erros que precisam ser corrigidos antes da conciliação.", 422);

  const eligibleStatements = preflight.statements.filter((item) => item.reconciliationEligible);
  const mappedFileIds = new Set<string>();
  if (eligibleStatements.length && !input.mappings.length) throw new PublicRuntimeError("LEDGER_ACCOUNT_MAPPING_MISSING", "Confirme a conta contábil correspondente a cada extrato antes de conciliar.", 422);
  for (const mapping of input.mappings) {
    if (!mapping.ledgerAccount || !mapping.statementFileIds.length) throw new PublicRuntimeError("LEDGER_ACCOUNT_MAPPING_MISSING", "Todo mapeamento deve possuir uma conta contábil e ao menos um extrato.", 422);
    const ledgerAccount = preflight.ledgerAccounts.find((item) => item.account === mapping.ledgerAccount);
    if (!ledgerAccount) throw new PublicRuntimeError("LEDGER_ACCOUNT_MAPPING_MISSING", "A conta contábil selecionada não foi encontrada no razão enviado.", 422);
    if (!ledgerAccount.bank || !ledgerAccount.agency || !ledgerAccount.bankAccount) throw new PublicRuntimeError("ACCOUNT_IDENTITY_MISSING", "A conta bancária vinculada à conta contábil não pôde ser identificada no razão.", 422);
    for (const fileId of mapping.statementFileIds) {
      if (mappedFileIds.has(fileId)) throw new PublicRuntimeError("LEDGER_ACCOUNT_MAPPING_MISSING", "Um extrato só pode ser relacionado a uma conta contábil por execução.", 422);
      mappedFileIds.add(fileId);
      const statement = eligibleStatements.find((item) => item.fileId === fileId);
      if (!statement) throw new PublicRuntimeError("LEDGER_ACCOUNT_MAPPING_MISSING", "O mapeamento contém um extrato que não está elegível para conciliação.", 422);
      if (!statement.bank || !statement.agency || !statement.account) throw new PublicRuntimeError("ACCOUNT_IDENTITY_MISSING", "Banco, agência ou conta não puderam ser identificados no extrato.", 422);
      if (bankAccountsConflict(ledgerAccount, statement)) throw new PublicRuntimeError("BANK_ACCOUNT_MISMATCH", "A conta bancária do extrato não corresponde à conta vinculada à conta contábil selecionada.", 422);
    }
  }
  if (mappedFileIds.size !== eligibleStatements.length || eligibleStatements.some((item) => !mappedFileIds.has(item.fileId))) throw new PublicRuntimeError("LEDGER_ACCOUNT_MAPPING_MISSING", "Confirme o relacionamento de todos os extratos elegíveis antes de conciliar.", 422);
}



async function scanBuffer(buffer: Buffer, originalName: string, config: RuntimeConfig): Promise<void> {
  if (!config.antivirusRequired) return;
  const directory = await mkdtemp(join(tmpdir(), "conciliacao_scan_")); const path = join(directory, "input.bin");
  try { await writeFile(path, buffer); await run(config.antivirusCommand, ["--no-summary", path], 120_000); }
  catch { throw new PublicRuntimeError("ARQUIVO_REJEITADO_SEGURANCA", `O arquivo ${originalName} foi rejeitado pela validação de segurança.`); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

export function createOcrProvider(config: RuntimeConfig, isCancelled: () => Promise<boolean>): OcrProvider {
  return async (file, pages) => {
    const directory = await mkdtemp(join(tmpdir(), "conciliacao_ocr_")); const pdfPath = join(directory, "input.pdf"); const output = [];
    try {
      await writeFile(pdfPath, file.buffer);
      for (const page of pages) {
        if (await isCancelled()) throw new Error("Execução cancelada.");
        const prefix = join(directory, `page_${page}`); await run(config.pdftoppmCommand, ["-f", String(page), "-l", String(page), "-singlefile", "-png", "-r", "250", pdfPath, prefix], 120_000, isCancelled);
        const tsv = await run(config.tesseractCommand, [`${prefix}.png`, "stdout", "-l", config.ocrLanguage, "--psm", "6", "-c", "tessedit_create_tsv=1"], 120_000, isCancelled);
        const parsed = parseTsv(tsv); output.push({ page, text: parsed.text, confidence: parsed.confidence });
      }
      return output;
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
}

export function parseTsv(value: string): { text: string; confidence: string } {
  const lines = value.split(/\r?\n/); const header = lines.shift()?.split("\t") ?? []; const textIndex = header.indexOf("text"); const confidenceIndex = header.indexOf("conf"); const pageIndex = header.indexOf("page_num"); const blockIndex = header.indexOf("block_num"); const paragraphIndex = header.indexOf("par_num"); const lineIndex = header.indexOf("line_num"); const groups = new Map<string, string[]>(); const confidences: number[] = [];
  for (const line of lines) { const columns = line.split("\t"); const word = columns[textIndex]?.trim(); if (!word) continue; const key = [columns[pageIndex], columns[blockIndex], columns[paragraphIndex], columns[lineIndex]].join(":"); groups.set(key, [...(groups.get(key) ?? []), word]); const confidence = Number(columns[confidenceIndex]); if (confidence >= 0) confidences.push(confidence); }
  return { text: [...groups.values()].map((words) => words.join(" ")).join("\n"), confidence: (confidences.reduce((a, b) => a + b, 0) / Math.max(1, confidences.length)).toFixed(2) };
}

function run(command: string, args: string[], timeout: number, isCancelled?: () => Promise<boolean>): Promise<string> { return new Promise((resolve, reject) => { const child = spawn(command, args, { shell: false, windowsHide: true }); let stdout = ""; let stderr = ""; let settled = false; const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(cancellationTimer); if (error) reject(error); else resolve(stdout); }; const timer = setTimeout(() => { child.kill(); finish(new Error("Processo externo excedeu o tempo limite.")); }, timeout); const cancellationTimer = setInterval(() => { if (isCancelled) void isCancelled().then((cancelled) => { if (cancelled) { child.kill(); finish(new Error("Execução cancelada.")); } }).catch(() => undefined); }, 1_000); child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("error", (error) => finish(error)); child.on("close", (code) => { if (code === 0) finish(); else finish(new Error(stderr || `Processo terminou com código ${code}.`)); }); }); }
function safeMetric(event: string, fields: Record<string, string | number>): void { console.info(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields })); }

let sharedQueue: Queue | undefined;
function processingQueue(redisUrl: string): Queue {
  sharedQueue ??= new Queue("reconciliation", { connection: { url: redisUrl } });
  return sharedQueue;
}

async function assertQueueCapacity(queue: Queue, maximum: number): Promise<void> {
  const counts = await queue.getJobCounts("waiting", "delayed", "active");
  if ((counts.waiting ?? 0) + (counts.delayed ?? 0) >= maximum) throw new PublicRuntimeError("FILA_CHEIA", "A capacidade de processamento está temporariamente cheia. Tente novamente em alguns minutos.", 503);
}
