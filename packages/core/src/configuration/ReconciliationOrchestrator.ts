import { createHash, randomUUID } from "node:crypto";

import {
  RECONCILIATION_CONTRACT_VERSION_V1,
  assertReconciliationRequestV1,
  projectReconciliationResultV1,
  toReconciliationEngineTransactionsV1,
  type CanonicalTransactionV1,
  type ReconciliationRequestV1,
  type ReconciliationResultV1,
} from "../contracts/reconciliation-v1.js";
import {
  ReconciliationEngine,
  type ReconciliationConfigurationV1,
} from "../reconciliation/domain/ReconciliationEngine.js";
import type { ConfigurationRepository } from "./ConfigurationRepository.js";
import { ConfigurationError, type RunMode, type RunRecord, type RunStatus } from "./models.js";
import { RoutingService } from "./RoutingService.js";

export interface EngineExecution {
  status: Extract<RunStatus, "SUCCEEDED" | "PENDING" | "BLOCKED" | "FAILED" | "TIMED_OUT" | "CANCELLED">;
  result?: Readonly<ReconciliationResultV1>;
  message?: string;
}

export interface EnginePort {
  execute(request: Readonly<ReconciliationRequestV1>): Promise<EngineExecution>;
}

export interface PrepareReconciliationInput {
  organizationId: string;
  snapshotId: string;
  requestId: string;
  runId: string;
  idempotencyKey: string;
  requestedAt: string;
  period: { startDate: string; endDate: string };
  bankTransactions: readonly CanonicalTransactionV1[];
  ledgerTransactions: readonly CanonicalTransactionV1[];
  fileHashes: readonly string[];
  fileNames?: readonly string[];
  mode: RunMode;
  actorId: string;
  allowReprocess?: boolean;
  reprocessAuthorized?: boolean;
  reprocessOfRunId?: string;
}

export interface PreparedReconciliation {
  request: Readonly<ReconciliationRequestV1>;
  existingRun?: RunRecord;
}

export class ReconciliationOrchestrator {
  public constructor(
    private readonly repository: ConfigurationRepository,
    private readonly engine: EnginePort,
    private readonly routing = new RoutingService(),
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  public async prepare(input: PrepareReconciliationInput): Promise<PreparedReconciliation> {
    const runs = this.runRepository();
    const existing = await runs.findRunRecordByIdempotencyKey(input.organizationId, input.idempotencyKey);
    if (existing && !input.allowReprocess) {
      if (sameReplayInput(existing, input)) {
        await this.auditAttempt(input, "execute", "IDEMPOTENT_REPLAY", existing.id);
        return { request: existing.request, existingRun: existing };
      }
      await this.auditAttempt(input, "execute", "IDEMPOTENCY_CONFLICT", existing.id);
      throw new ConfigurationError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outra requisição.");
    }
    if (input.allowReprocess && !input.reprocessAuthorized) {
      throw new ConfigurationError("REPROCESS_FORBIDDEN", "Reprocessamento exige autorização explícita.");
    }
    if (input.allowReprocess && !input.reprocessOfRunId) {
      throw new ConfigurationError("REPROCESS_SOURCE_REQUIRED", "Reprocessamento exige a execução de origem.");
    }
    if (input.allowReprocess && input.reprocessOfRunId) {
      const source = await runs.findRunRecordById(input.organizationId, input.reprocessOfRunId);
      if (!source) throw new ConfigurationError("NOT_FOUND", "Execução de origem não encontrada.");
    }

    const record = await this.snapshotRepository().findPublishedSnapshotById(input.organizationId, input.snapshotId);
    if (!record) throw new ConfigurationError("SNAPSHOT_NOT_FOUND", "Snapshot publicado não encontrado.");
    const snapshot = record.snapshot;
    assertPeriodWithinSnapshot(input.period, record);
    const profileVersion = snapshot.profileVersion;
    const bankTransactions = input.bankTransactions.map((transaction) => {
      assertTransactionScope(transaction, snapshot, "BANK");
      const routed = this.routing.routePolicy(transaction, snapshot.routing);
      if (routed.status !== "ROUTED") {
        throw new ConfigurationError(routed.status, `Transação bancária ${transaction.id} não possui destino único.`);
      }
      return { ...transaction, ledgerAccountId: routed.ledgerAccountId };
    });
    const ledgerTransactions = input.ledgerTransactions.map((transaction) => {
      assertTransactionScope(transaction, snapshot, "LEDGER");
      return transaction;
    });
    const resolvedScopeId = input.bankTransactions[0]?.scopeId ?? input.ledgerTransactions[0]?.scopeId
      ?? scopeId(snapshot.profileId, profileVersion, snapshot.bankAccountId);
    const request: ReconciliationRequestV1 = {
      schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1,
      requestId: input.requestId,
      runId: input.runId,
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.requestedAt,
      scope: {
        schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1,
        id: resolvedScopeId,
        organizationId: snapshot.organizationId,
        legalEntityId: snapshot.legalEntityId,
        profileId: snapshot.profileId,
        profileVersion,
        bankAccountId: snapshot.bankAccountId,
        ledgerAccountIds: snapshot.ledgerAccountIds,
        currency: snapshot.currency,
        timezone: snapshot.timezone,
        period: input.period,
      },
      snapshot,
      bankTransactions,
      ledgerTransactions,
    };
    assertReconciliationRequestV1(request);
    const version = await this.repository.findProfileVersionById(input.organizationId, record.profileVersionId);
    if (!version || !isExecutableVersion(version.status, input.mode)) {
      throw new ConfigurationError(
        "PROFILE_VERSION_NOT_EXECUTABLE",
        input.mode === "official"
          ? "Execução oficial exige versão publicada e ativa."
          : "Execução exige versão aprovada ou publicada e ativa.",
      );
    }
    const allRuns = await runs.listRunRecords(input.organizationId);
    const duplicate = allRuns.find(
      (run) => input.mode === "official" && run.mode === "official" && hashesOverlap(run.fileHashes, input.fileHashes),
    );
    if (duplicate && !input.allowReprocess) {
      await this.auditAttempt(input, "execute", "FILE_DUPLICATE", duplicate.id);
      throw new ConfigurationError("FILE_DUPLICATE", "Arquivo com o mesmo conteúdo já foi processado oficialmente.");
    }
    const sameName = allRuns.find(
      (run) => input.mode === "official" && run.mode === "official"
        && run.fileNames.some((name) => (input.fileNames ?? []).includes(name))
        && !sameHashes(run.fileHashes, input.fileHashes),
    );
    if (sameName && !input.allowReprocess) {
      await this.auditAttempt(input, "execute", "FILE_NAME_CONTENT_CHANGED", sameName.id);
      throw new ConfigurationError("FILE_NAME_CONTENT_CHANGED", "Arquivo com o mesmo nome possui conteúdo diferente.");
    }
    return { request };
  }

  public async execute(input: PrepareReconciliationInput): Promise<RunRecord> {
    const prepared = await this.prepare(input);
    if (prepared.existingRun) return prepared.existingRun;
    const base: RunRecord = {
      id: input.runId,
      organizationId: input.organizationId,
      profileId: prepared.request.scope.profileId,
      profileVersionId: (await this.requireSnapshot(input)).profileVersionId,
      bankAccountId: prepared.request.scope.bankAccountId,
      snapshotId: input.snapshotId,
      mode: input.mode,
      idempotencyKey: input.idempotencyKey,
      fileHashes: [...input.fileHashes],
      fileNames: [...(input.fileNames ?? [])],
      configurationHash: prepared.request.snapshot.configurationHash,
      snapshot: prepared.request.snapshot,
      request: prepared.request,
      status: "RUNNING",
      ...(input.reprocessOfRunId === undefined ? {} : { reprocessOfRunId: input.reprocessOfRunId }),
      createdAt: this.now().toISOString(),
      createdBy: input.actorId,
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.runRepository().saveRunRecord(base);
    } catch (error) {
      if (!(error instanceof ConfigurationError) || error.code !== "IDEMPOTENCY_CONFLICT") throw error;
      const concurrent = await this.runRepository().findRunRecordByIdempotencyKey(
        input.organizationId,
        input.idempotencyKey,
      );
      if (concurrent && sameSemanticRequest(concurrent, input, prepared.request)) return concurrent;
      throw error;
    }
    let execution: EngineExecution;
    try {
      execution = await this.engine.execute(prepared.request);
    } catch (error) {
      const failed: RunRecord = { ...base, status: "FAILED", updatedAt: this.now().toISOString() };
      await this.persistTerminal(input, failed, "engine threw");
      throw error;
    }
    const completed: RunRecord = {
      ...base,
      status: execution.status,
      ...(execution.result === undefined ? {} : { result: execution.result }),
      updatedAt: this.now().toISOString(),
    };
    await this.persistTerminal(input, completed);
    return structuredClone(completed);
  }

  private async persistTerminal(input: PrepareReconciliationInput, completed: RunRecord, reason?: string): Promise<void> {
    const persist = async (repository: ConfigurationRepository): Promise<void> => {
      if (!repository.saveRunRecord) {
        throw new ConfigurationError("RUN_REPOSITORY_UNSUPPORTED", "Repositório não suporta registros de execução.");
      }
      await repository.saveRunRecord(completed);
      await repository.appendAuditEvent({
       id: this.newId(),
      organizationId: input.organizationId,
      entityType: "RECONCILIATION_RUN",
      entityId: completed.id,
      action: input.allowReprocess ? "reprocess" : "execute",
      before: null,
      after: JSON.parse(JSON.stringify({
        id: completed.id,
        mode: completed.mode,
        status: completed.status,
        configurationHash: completed.configurationHash,
        reprocessOfRunId: completed.reprocessOfRunId ?? null,
      })),
      actor: input.actorId,
      at: this.now().toISOString(),
       reason: reason ?? (input.allowReprocess ? "authorized reprocess" : "reconciliation execution"),
       correlationId: input.requestId,
      });
    };
    if (this.repository.withTransaction) await this.repository.withTransaction(persist);
    else await persist(this.repository);
  }

  private async requireSnapshot(input: PrepareReconciliationInput) {
    const snapshot = await this.snapshotRepository().findPublishedSnapshotById(input.organizationId, input.snapshotId);
    if (!snapshot) throw new ConfigurationError("SNAPSHOT_NOT_FOUND", "Snapshot publicado não encontrado.");
    return snapshot;
  }

  private snapshotRepository(): Required<Pick<ConfigurationRepository, "findPublishedSnapshotById">> {
    if (!this.repository.findPublishedSnapshotById) {
      throw new ConfigurationError("SNAPSHOT_REPOSITORY_UNSUPPORTED", "Repositório não suporta snapshots publicados.");
    }
    return { findPublishedSnapshotById: this.repository.findPublishedSnapshotById.bind(this.repository) };
  }

  private runRepository(): Required<Pick<ConfigurationRepository,
    "saveRunRecord" | "findRunRecordById" | "findRunRecordByIdempotencyKey" | "listRunRecords">> {
    if (!this.repository.saveRunRecord || !this.repository.findRunRecordById
      || !this.repository.findRunRecordByIdempotencyKey || !this.repository.listRunRecords) {
      throw new ConfigurationError("RUN_REPOSITORY_UNSUPPORTED", "Repositório não suporta registros de execução.");
    }
    return {
      saveRunRecord: this.repository.saveRunRecord.bind(this.repository),
      findRunRecordById: this.repository.findRunRecordById.bind(this.repository),
      findRunRecordByIdempotencyKey: this.repository.findRunRecordByIdempotencyKey.bind(this.repository),
      listRunRecords: this.repository.listRunRecords.bind(this.repository),
    };
  }

  private async auditAttempt(
    input: PrepareReconciliationInput,
    action: "execute" | "reprocess",
    outcome: string,
    relatedRunId: string,
  ): Promise<void> {
    await this.repository.appendAuditEvent({
      id: this.newId(),
      organizationId: input.organizationId,
      entityType: "RECONCILIATION_RUN",
      entityId: input.runId,
      action,
      before: null,
      after: { outcome, relatedRunId },
      actor: input.actorId,
      at: this.now().toISOString(),
      reason: outcome,
      correlationId: input.requestId,
    });
  }
}

export class RealReconciliationEngineAdapter implements EnginePort {
  public constructor(
    private readonly createEngine: (request: Readonly<ReconciliationRequestV1>) => ReconciliationEngine = (request) => {
      const rules = request.snapshot.ruleset.configuration;
      const configuration = {
        version: rules.engineRuleVersion,
        genericWords: rules.genericWords,
        dateWindowDays: rules.dateWindowDays,
        rf03: rules.rf03,
        rf06: rules.rf06,
        maxCombinationsPerAnchor: rules.maxCombinationsPerAnchor,
        automaticApplicationPattern: rules.automaticApplicationPattern,
      } as ReconciliationConfigurationV1;
      return new ReconciliationEngine(0, rules.dateWindowDays, {
        evaluatedAt: request.requestedAt,
        configuration,
        descriptionSimilarityThreshold: request.snapshot.tolerances.descriptionSimilarity,
        maxGroupSize: request.snapshot.tolerances.maxGroupSize,
      });
    },
  ) {}

  public async execute(request: Readonly<ReconciliationRequestV1>): Promise<EngineExecution> {
    const transactions = toReconciliationEngineTransactionsV1(request);
    const output = this.createEngine(request).run(transactions);
    return { status: "SUCCEEDED", result: projectReconciliationResultV1(request, output) };
  }
}

export type FakeEngineScenario = "success" | "pending" | "blocked" | "failure" | "timeout" | "cancel";

export class FakeReconciliationEngineAdapter implements EnginePort {
  public readonly requests: Readonly<ReconciliationRequestV1>[] = [];

  public constructor(private readonly scenario: FakeEngineScenario = "success") {}

  public async execute(request: Readonly<ReconciliationRequestV1>): Promise<EngineExecution> {
    this.requests.push(structuredClone(request));
    if (this.scenario === "success") {
      const output = new ReconciliationEngine(0, 3, { evaluatedAt: request.requestedAt }).run(
        toReconciliationEngineTransactionsV1(request),
      );
      return { status: "SUCCEEDED", result: projectReconciliationResultV1(request, output) };
    }
    const statuses: Record<Exclude<FakeEngineScenario, "success">, EngineExecution["status"]> = {
      pending: "PENDING",
      blocked: "BLOCKED",
      failure: "FAILED",
      timeout: "TIMED_OUT",
      cancel: "CANCELLED",
    };
    return { status: statuses[this.scenario], message: this.scenario };
  }
}

function assertTransactionScope(
  transaction: CanonicalTransactionV1,
  snapshot: { organizationId: string; legalEntityId: string; profileId: string; profileVersion: string; bankAccountId: string; currency: string; ledgerAccountIds: readonly string[] },
  source: "BANK" | "LEDGER",
): void {
  if (transaction.source !== source || transaction.organizationId !== snapshot.organizationId
    || transaction.legalEntityId !== snapshot.legalEntityId || transaction.profileId !== snapshot.profileId
    || transaction.profileVersion !== snapshot.profileVersion || transaction.bankAccountId !== snapshot.bankAccountId) {
    throw new ConfigurationError("INVALID_RECONCILIATION_INPUT", `Transação ${transaction.id} diverge do escopo publicado.`);
  }
  if (transaction.currency !== snapshot.currency) {
    throw new ConfigurationError("CURRENCY_MISMATCH", `Transação ${transaction.id} diverge da moeda do snapshot.`);
  }
  if (source === "LEDGER" && (!transaction.ledgerAccountId || !snapshot.ledgerAccountIds.includes(transaction.ledgerAccountId))) {
    throw new ConfigurationError("ACCOUNT_MISMATCH", `Transação contábil ${transaction.id} não pertence ao snapshot.`);
  }
}

function scopeId(profileId: string, profileVersion: string, bankAccountId: string): string {
  return createHash("sha256").update(`${profileId}\0${profileVersion}\0${bankAccountId}`).digest("hex").slice(0, 24);
}

function sameHashes(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function hashesOverlap(left: readonly string[], right: readonly string[]): boolean {
  const rightHashes = new Set(right);
  return left.some((hash) => rightHashes.has(hash));
}

function sameSemanticRequest(
  record: RunRecord,
  input: PrepareReconciliationInput,
  request: Readonly<ReconciliationRequestV1>,
): boolean {
  return semanticRequestHash({
    snapshotId: record.snapshotId,
    period: record.request.scope.period,
    mode: record.mode,
    bankTransactions: record.request.bankTransactions,
    ledgerTransactions: record.request.ledgerTransactions,
    fileHashes: [...record.fileHashes].sort(),
    fileNames: [...record.fileNames].sort(),
  }) === semanticRequestHash({
    snapshotId: input.snapshotId,
    period: request.scope.period,
    mode: input.mode,
    bankTransactions: request.bankTransactions,
    ledgerTransactions: request.ledgerTransactions,
    fileHashes: [...input.fileHashes].sort(),
    fileNames: [...(input.fileNames ?? [])].sort(),
  });
}

function sameReplayInput(record: RunRecord, input: PrepareReconciliationInput): boolean {
  return semanticRequestHash({
    snapshotId: record.snapshotId,
    period: record.request.scope.period,
    mode: record.mode,
    bankTransactions: record.request.bankTransactions.map(withoutBankRouting),
    ledgerTransactions: record.request.ledgerTransactions,
    fileHashes: [...record.fileHashes].sort(),
    fileNames: [...record.fileNames].sort(),
  }) === semanticRequestHash({
    snapshotId: input.snapshotId,
    period: input.period,
    mode: input.mode,
    bankTransactions: input.bankTransactions.map(withoutBankRouting),
    ledgerTransactions: input.ledgerTransactions,
    fileHashes: [...input.fileHashes].sort(),
    fileNames: [...(input.fileNames ?? [])].sort(),
  });
}

function withoutBankRouting(transaction: CanonicalTransactionV1): Omit<CanonicalTransactionV1, "ledgerAccountId"> {
  const { ledgerAccountId: _ledgerAccountId, ...canonical } = transaction;
  return canonical;
}

function semanticRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function assertPeriodWithinSnapshot(
  period: { startDate: string; endDate: string },
  snapshot: { effectiveFrom: string; effectiveTo?: string },
): void {
  if (period.endDate < period.startDate) {
    throw new ConfigurationError("INVALID_RECONCILIATION_PERIOD", "O fim do período deve ser igual ou posterior ao início.");
  }
  if (period.startDate < snapshot.effectiveFrom
    || (snapshot.effectiveTo !== undefined && period.endDate >= snapshot.effectiveTo)) {
    throw new ConfigurationError("SNAPSHOT_NOT_EFFECTIVE", "O período solicitado está fora da vigência do snapshot.");
  }
}

function isExecutableVersion(status: string, mode: RunMode): boolean {
  return mode === "official" ? status === "published" : status === "approved" || status === "published";
}
