import { execFile, fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type {
  CompletedReconciliation,
  CompletedReconciliationRepository,
} from "../../packages/core/src/index";
import type { ReconciliationSession } from "../../packages/runtime/src/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(import.meta.dirname, "../..");

let postgres: StartedTestContainer;
let redis: StartedTestContainer;
let databaseUrl: string;
let redisUrl: string;
let core: typeof import("../../packages/core/src/index");
let runtime: typeof import("../../packages/runtime/src/index");
const childProcesses = new Set<ChildProcess>();

beforeAll(async () => {
  [postgres, redis] = await Promise.all([
    new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_DB: "conciliacao_test",
        POSTGRES_PASSWORD: "conciliacao_test",
        POSTGRES_USER: "conciliacao_test",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
      .withStartupTimeout(120_000)
      .start(),
    new GenericContainer("redis:8-alpine")
      .withCommand(["redis-server", "--save", "", "--appendonly", "no"])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .withStartupTimeout(120_000)
      .start(),
  ]);

  databaseUrl = `postgresql://conciliacao_test:conciliacao_test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/conciliacao_test`;
  redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;

  await runPrisma("migrate", "deploy", "--schema", "prisma/schema.prisma");
  core = await import("../../packages/core/src/index");
  runtime = await import("../../packages/runtime/src/index");
}, 180_000);

afterAll(async () => {
  for (const child of childProcesses) child.kill("SIGKILL");
  await Promise.allSettled([...childProcesses].map((child) => once(child, "exit")));
  if (core) await core.prisma.$disconnect();
  await Promise.allSettled([
    redis?.stop({ remove: true, removeVolumes: true }),
    postgres?.stop({ remove: true, removeVolumes: true }),
  ]);
});

describe.sequential("gate PostgreSQL 16", () => {
  it("aplica todas as migrations em um banco vazio", async () => {
    const migrations = await core.prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
      'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name',
    );

    expect(migrations.map((migration) => migration.migration_name)).toEqual([
      "20260809120000_initial_modular_monolith",
      "20260812120000_multicount_configuration",
      "20260813120000_persistent_authentication",
      "20260813160000_completed_reconciliation_history",
    ]);
    expect(migrations.every((migration) => migration.finished_at !== null)).toBe(true);
  });

  it("persiste histórico idempotente, escopado e sem metadados temporários", async () => {
    const tenant = await seedTenant("history");
    const repository = new core.PrismaCompletedReconciliationRepository(core.prisma);
    const record = completedRecord("history-record", tenant);

    expect(await repository.save(record)).toBe(true);
    expect(await repository.save({ ...record, period: "202602" })).toBe(false);

    const visible = await repository.findById(record.id, [tenant.companyId], new Date("2026-08-14T00:00:00.000Z"));
    const hidden = await repository.findById(record.id, ["another-company"], new Date("2026-08-14T00:00:00.000Z"));
    const rows = await core.prisma.completedReconciliation.findMany({ where: { id: record.id } });

    expect(visible).toMatchObject({
      organizationId: tenant.organizationId,
      companyId: tenant.companyId,
      userId: tenant.userId,
      period: "202601",
    });
    expect(hidden).toBeNull();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toMatch(/objectKey|tokenHash|credential|private\//i);
    expect(await repository.save(record, "attempt-a", 1)).toBe(true);
    expect(await repository.save(record, "attempt-c", 3)).toBe(true);
    expect(await repository.save(record, "attempt-b", 2)).toBe(false);
    await repository.delete(record.id, "attempt-a");
    expect(await core.prisma.completedReconciliation.count({ where: { id: record.id } })).toBe(1);
    await expect(repository.save({ ...record, id: "invalid-company", companyId: "missing" })).rejects.toBeDefined();
  });

  it("oculta e elimina somente históricos expirados", async () => {
    const tenant = await seedTenant("retention");
    const repository = new core.PrismaCompletedReconciliationRepository(core.prisma);
    const now = new Date("2026-08-14T12:00:00.000Z");
    const expired = completedRecord("retention-expired", tenant, now);
    const future = completedRecord("retention-future", tenant, new Date("2027-08-14T12:00:00.000Z"));
    await repository.save(expired);
    await repository.save(future);

    const beforeSweep = await repository.list([tenant.companyId], 1, 20, now);
    const deleted = await repository.deleteExpired(now);

    expect(beforeSweep.items.map((item) => item.id)).toEqual([future.id]);
    expect(deleted).toBe(1);
    expect(await repository.findById(expired.id, [tenant.companyId], now)).toBeNull();
    expect(await repository.findById(future.id, [tenant.companyId], now)).not.toBeNull();
  });

  it("serializa duas rotações concorrentes sem expor erro Prisma", async () => {
    const tenant = await seedTenant("refresh");
    const repository = new core.PrismaAuthRepository(core.prisma);
    const now = new Date("2026-08-14T12:00:00.000Z");
    const absoluteExpiresAt = new Date("2026-08-15T12:00:00.000Z");
    await repository.createSession({
      userId: tenant.userId,
      authVersion: 1,
      now,
      idleExpiresAt: absoluteExpiresAt,
      absoluteExpiresAt,
      refreshTokenHash: "refresh-current",
    });

    const results = await Promise.all([
      repository.rotateRefreshToken({
        currentTokenHash: "refresh-current",
        replacementTokenHash: "refresh-a",
        now: new Date(now.getTime() + 1_000),
        idleExpiresAt: absoluteExpiresAt,
      }),
      repository.rotateRefreshToken({
        currentTokenHash: "refresh-current",
        replacementTokenHash: "refresh-b",
        now: new Date(now.getTime() + 1_000),
        idleExpiresAt: absoluteExpiresAt,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["REUSED", "ROTATED"]);
    const session = await core.prisma.authSession.findFirstOrThrow({ where: { userId: tenant.userId } });
    const tokens = await core.prisma.authRefreshToken.findMany({ where: { sessionId: session.id } });
    expect(session.revocationReason).toBe("REFRESH_REUSE");
    expect(tokens.filter((token) => token.replacedByTokenId !== null)).toHaveLength(1);
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
  });
});

describe.sequential("gate Redis 8", () => {
  it("executa claims concorrentes e preserva o TTL", async () => {
    const store = redisStore();
    try {
      const created = await store.create("infra-claim", "user", "org", "company");
      const confirmation = confirmationFor("infra-claim");
      const before = await redisPttl(`session:${created.session.id}`);
      const claims = await Promise.all(Array.from({ length: 20 }, () => store.claimConfirmation(created.session.id, confirmation)));
      const after = await redisPttl(`session:${created.session.id}`);

      expect(claims.filter((claim) => claim === "CLAIMED")).toHaveLength(1);
      expect(claims.filter((claim) => claim === "SAME")).toHaveLength(19);
      expect(await store.claimConfirmation(created.session.id, { ...confirmation, valueTolerance: "0.01" })).toBe("CONFLICT");
      expect(after).toBeGreaterThan(0);
      expect(after).toBeLessThanOrEqual(before);
    } finally {
      await store.close();
    }
  });

  it("não regride estado nem ressuscita uma sessão eliminada", async () => {
    const store = redisStore();
    try {
      const created = await store.create("infra-stale", "user", "org", "company");
      const stale = (await store.get(created.session.id))!;
      await store.claimConfirmation(stale.id, confirmationFor("infra-stale"));
      const current = (await store.get(stale.id))!;
      current.status = "QUEUED";
      current.progress = 50;
      current.progressMessage = "Execução aguardando o worker.";
      await store.save(current);
      stale.status = "UPLOADING";
      await store.save(stale);

      expect(await store.get(stale.id)).toMatchObject({
        status: "QUEUED",
        progress: 50,
        confirmation: { idempotencyKey: "infra-stale" },
      });

      await store.delete(stale.id);
      await store.save(stale);
      expect(await store.get(stale.id)).toBeNull();

      const terminal = await store.create("infra-terminal", "user", "org", "company");
      const completed = (await store.get(terminal.session.id))!;
      completed.status = "COMPLETED";
      completed.progress = 100;
      expect(await store.complete(completed)).toBe(true);
      await store.save({
        ...completed,
        status: "FAILED",
        progress: 90,
        errorCode: "STALE",
        errorMessage: "Falha atrasada.",
      });
      expect(await store.get(completed.id)).toMatchObject({ status: "COMPLETED", progress: 100 });
      expect(await store.get(completed.id)).not.toHaveProperty("errorCode");
    } finally {
      await store.close();
    }
  });

  it("mantém a sessão ausente quando delete disputa com complete", async () => {
    const store = redisStore();
    try {
      const created = await store.create("infra-complete", "user", "org", "company");
      const session = (await store.get(created.session.id))!;
      session.status = "COMPLETED";
      session.closed = true;

      await Promise.all([store.delete(session.id), store.complete(session)]);

      expect(await store.get(session.id)).toBeNull();
      expect(await store.complete(session)).toBe(false);
      expect(await store.touchHeartbeat(session.id, new Date().toISOString())).toBe(false);
    } finally {
      await store.close();
    }
  });

  it("aplica o limite exatamente uma vez sob concorrência", async () => {
    const limiter = new runtime.RedisRateLimiter(redisUrl, "infrastructure-test-secret-at-least-32-bytes");
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => limiter.consume({
        name: "infra",
        limit: 3,
        windowMs: 60_000,
      }, "same-client")));

      expect(results.filter((result) => result.allowed)).toHaveLength(3);
      expect(results.every((result) => result.retryAfterSeconds > 0)).toBe(true);
    } finally {
      await limiter.close();
    }
  });
});

describe.sequential("gate combinado PostgreSQL e Redis", () => {
  it("compensa inclusive histórico anterior se a sessão for eliminada após o commit PostgreSQL", async () => {
    const tenant = await seedTenant("compensation");
    const store = redisStore();
    const repository = new core.PrismaCompletedReconciliationRepository(core.prisma);
    const temporaryPath = await mkdtemp(join(tmpdir(), "conciliacao-infra-"));
    const config = runtimeConfig(temporaryPath);
    const compensatingRepository: CompletedReconciliationRepository = {
      save: async (record, processingAttemptId, processingGeneration) => {
        const created = await repository.save(record, processingAttemptId, processingGeneration);
        await store.delete(record.id);
        return created;
      },
      list: (...arguments_) => repository.list(...arguments_),
      findById: (...arguments_) => repository.findById(...arguments_),
      delete: (id, processingAttemptId) => repository.delete(id, processingAttemptId),
      deleteExpired: (now) => repository.deleteExpired(now),
    };
    const services = new runtime.RuntimeServices(
      config,
      store,
      new runtime.LocalObjectStore(config),
      compensatingRepository,
    );
    const session = processableSession("compensation-session", tenant);
    await repository.save(completedRecord(session.id, tenant));
    await store.save(session);

    try {
      await expect(services.process(session, confirmationFor("compensation-session"))).rejects.toMatchObject({
        code: "PROCESSAMENTO_CANCELADO",
      });
      expect(await repository.findById(session.id, [tenant.companyId], new Date())).toBeNull();
      expect(await store.get(session.id)).toBeNull();
    } finally {
      await store.close();
      await rm(temporaryPath, { force: true, recursive: true });
    }
  });

  it("recupera um job após crash entre o commit PostgreSQL e a conclusão Redis", async () => {
    const tenant = await seedTenant("worker-crash");
    const store = redisStore();
    const repository = new core.PrismaCompletedReconciliationRepository(core.prisma);
    const temporaryPath = await mkdtemp(join(tmpdir(), "conciliacao-worker-crash-"));
    const config = runtimeConfig(temporaryPath);
    const objects = new runtime.LocalObjectStore(config);
    const services = new runtime.RuntimeServices(config, store, objects, repository);
    const session = processableSession("worker-crash-session", tenant);
    const objectKey = `${session.id}/temporary-statement`;
    session.files.push({
      id: "statement",
      kind: "STATEMENT",
      originalName: "extrato.xlsx",
      contentType: "application/octet-stream",
      size: 9,
      objectKey,
      sha256: "temporary-sha256",
    });
    await objects.put(objectKey, Buffer.from("temporary"));
    await store.save(session);

    let crashingWorker: ChildProcess | undefined;
    let recoveryWorker: ChildProcess | undefined;
    try {
      crashingWorker = spawnWorker("crash", temporaryPath);
      await waitForChildMessage(crashingWorker, "ready");
      const historyPersisted = waitForChildMessage(crashingWorker, "history-persisted");
      await services.enqueue(session, confirmationFor(session.id));
      await historyPersisted;

      expect(await repository.findById(session.id, [tenant.companyId], new Date())).not.toBeNull();
      expect((await store.get(session.id))?.status).toBe("RECONCILING");
      await killChild(crashingWorker);
      crashingWorker = undefined;

      recoveryWorker = spawnWorker("recover", temporaryPath);
      const recoveryExit = once(recoveryWorker, "exit");
      const stalled = waitForChildMessage(recoveryWorker, "stalled");
      const completed = waitForChildMessage(recoveryWorker, "completed");
      await waitForChildMessage(recoveryWorker, "ready");
      await stalled;
      await completed;
      await recoveryExit;
      recoveryWorker = undefined;

      expect(await store.get(session.id)).toMatchObject({ status: "COMPLETED", progress: 100 });
      expect(await core.prisma.completedReconciliation.count({ where: { id: session.id } })).toBe(1);
      const persisted = await core.prisma.completedReconciliation.findUniqueOrThrow({ where: { id: session.id } });
      expect(JSON.stringify(persisted)).not.toMatch(/objectKey|private\/|temporary-statement/i);
      await expect(objects.get(objectKey)).rejects.toBeDefined();
    } finally {
      if (crashingWorker) await killChild(crashingWorker);
      if (recoveryWorker) await killChild(recoveryWorker);
      await store.close();
      await rm(temporaryPath, { force: true, recursive: true });
    }
  });

  it("abre e fecha filas independentes em enqueues consecutivos", async () => {
    const store = redisStore();
    const temporaryPath = await mkdtemp(join(tmpdir(), "conciliacao-queue-lifecycle-"));
    const config = runtimeConfig(temporaryPath);
    const services = new runtime.RuntimeServices(
      config,
      store,
      new runtime.LocalObjectStore(config),
      new core.InMemoryCompletedReconciliationRepository(),
    );
    const tenant = { organizationId: "queue-org", companyId: "queue-company", userId: "queue-user" };
    const first = processableSession("queue-first", tenant);
    const second = processableSession("queue-second", tenant);
    await store.save(first);
    await store.save(second);

    try {
      await services.enqueue(first, confirmationFor(first.id));
      await services.enqueue(second, confirmationFor(second.id));
      expect(await store.get(first.id)).toMatchObject({ status: "QUEUED" });
      expect(await store.get(second.id)).toMatchObject({ status: "QUEUED" });
    } finally {
      await store.close();
      await rm(temporaryPath, { force: true, recursive: true });
    }
  });
});

async function runPrisma(...arguments_: string[]): Promise<void> {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error("npm_execpath não está disponível para executar Prisma.");
  await execFileAsync(
    process.execPath,
    [pnpmCli, "--filter", "@conciliacao/core", "exec", "prisma", ...arguments_],
    { cwd: workspaceRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 10 * 1024 * 1024 },
  );
}

async function seedTenant(prefix: string): Promise<{
  organizationId: string;
  legalEntityId: string;
  companyId: string;
  userId: string;
}> {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const organizationId = `${prefix}-organization`;
  const legalEntityId = `${prefix}-legal-entity`;
  const companyId = `${prefix}-company`;
  const userId = `${prefix}-user`;
  await core.prisma.configOrganization.create({
    data: {
      id: organizationId,
      name: `${prefix} organization`,
      timezone: "America/Sao_Paulo",
      defaultCurrency: "BRL",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  });
  await core.prisma.configLegalEntity.create({
    data: {
      id: legalEntityId,
      organizationId,
      legalName: `${prefix} legal entity`,
      taxId: `${prefix}-tax-id`,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  });
  await core.prisma.company.create({
    data: {
      id: companyId,
      organizationId,
      legalEntityId,
      name: `${prefix} company`,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  });
  await core.prisma.user.create({
    data: {
      id: userId,
      email: `${prefix}@example.test`,
      passwordHash: "not-used-by-infrastructure-tests",
      passwordChangeRequired: false,
      status: "ACTIVE",
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
  });
  await core.prisma.companyAccess.create({
    data: { id: `${prefix}-access`, companyId, userId, roles: ["PREPARER"], createdAt: now, updatedAt: now },
  });
  return { organizationId, legalEntityId, companyId, userId };
}

function completedRecord(
  id: string,
  tenant: { organizationId: string; companyId: string; userId: string },
  expiresAt = new Date("2027-08-14T00:00:00.000Z"),
): CompletedReconciliation {
  return {
    id,
    organizationId: tenant.organizationId,
    companyId: tenant.companyId,
    userId: tenant.userId,
    status: "COMPLETED",
    period: "202601",
    confirmation: confirmationFor(id),
    sourceFiles: [{ id: "statement", kind: "STATEMENT", originalName: "extrato.xlsx", sha256: "sha256" }],
    result: { period: "202601", results: [], issues: [] } as unknown as CompletedReconciliation["result"],
    completedAt: new Date("2026-08-14T00:00:00.000Z"),
    expiresAt,
  };
}

function redisStore(): import("../../packages/runtime/src/session-store").RedisSessionStore {
  return new runtime.RedisSessionStore(runtimeConfig(".local-storage"));
}

function runtimeConfig(localStoragePath: string): import("../../packages/runtime/src/config").RuntimeConfig {
  return { ...runtime.loadRuntimeConfig({ REDIS_URL: redisUrl }), localStoragePath, sessionTtlSeconds: 300 };
}

async function redisPttl(key: string): Promise<number> {
  const result = await redis.exec(["redis-cli", "PTTL", key]);
  expect(result.exitCode).toBe(0);
  return Number.parseInt(result.stdout.trim(), 10);
}

function spawnWorker(mode: "crash" | "recover", localStoragePath: string): ChildProcess {
  const child = fork(resolve(import.meta.dirname, "fixtures/worker-crash.mjs"), [mode], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      STORAGE_MODE: "local",
      LOCAL_STORAGE_PATH: localStoragePath,
      SESSION_TTL_SECONDS: "300",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  childProcesses.add(child);
  child.once("exit", () => childProcesses.delete(child));
  return child;
}

async function waitForChildMessage(child: ChildProcess, type: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    let stderr = "";
    const onStderr = (chunk: Buffer) => { stderr += chunk.toString(); };
    const onMessage = (message: unknown) => {
      if (!isChildMessage(message)) return;
      if (message.type === "failed") {
        cleanup();
        reject(new Error(message.error ?? "Worker de infraestrutura falhou."));
        return;
      }
      if (message.type !== type) return;
      cleanup();
      resolvePromise();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Worker encerrou antes de ${type} (code=${code}): ${stderr}`));
    };
    const cleanup = () => {
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.stderr?.off("data", onStderr);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.stderr?.on("data", onStderr);
  });
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await once(child, "exit");
}

function isChildMessage(value: unknown): value is { type: string; error?: string } {
  return typeof value === "object" && value !== null && "type" in value
    && typeof (value as { type: unknown }).type === "string";
}

function confirmationFor(idempotencyKey: string) {
  return {
    company: "EMPRESA",
    branch: "01",
    period: "202601",
    valueTolerance: "0.00",
    dateToleranceDays: 0,
    mappings: [{ ledgerAccount: "111", statementFileIds: ["statement"], signProfile: "BANK_ASSET" as const }],
    idempotencyKey,
  };
}

function processableSession(
  id: string,
  tenant: { organizationId: string; companyId: string; userId: string },
): ReconciliationSession {
  const now = new Date();
  return {
    id,
    tokenHash: "hash",
    clientKey: "client",
    actorId: tenant.userId,
    organizationId: tenant.organizationId,
    companyId: tenant.companyId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    lastHeartbeatAt: now.toISOString(),
    status: "AWAITING_CONFIRMATION",
    progress: 35,
    progressMessage: "",
    files: [],
    closed: false,
    ledgers: [{
      id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02",
      document: "", history: "PAGAMENTO", value: "10.00", sourceId: "l1",
      evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 2 },
    }],
    statements: [{
      id: "s1", bank: "ITAU", agency: "1", bankAccount: "2", date: "2026-01-02",
      document: "", history: "PAGAMENTO", value: "-10.00", sourceId: "s1",
      evidence: { fileId: "statement", originalName: "extrato.xlsx", extractionMethod: "TABULAR", line: 2 },
    }],
    preflight: {
      companies: ["EMPRESA"],
      branches: ["01"],
      detectedPeriods: [{ period: "202601", recordCount: 2 }],
      ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "1", bankAccount: "2", recordCount: 1 }],
      statements: [{
        fileId: "statement", originalName: "extrato.xlsx", bank: "ITAU", agency: "1", account: "2",
        periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "TEST",
        classification: "CURRENT_ACCOUNT", reconciliationEligible: true,
      }],
      investments: [],
      issues: [],
      requiresUserInput: false,
    },
  };
}
