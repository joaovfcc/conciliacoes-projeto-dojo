import { NextRequest } from "next/server";
import {
  ConfigurationError,
  ConfigurationService,
  FakeReconciliationEngineAdapter,
  InMemoryConfigurationRepository,
  ProfileSnapshotService,
  ReconciliationOrchestrator,
  type ConfigurationRole,
  type EnginePort,
} from "@conciliacao/core";
import { afterEach, describe, expect, it } from "vitest";
import { createConfigurationHandlers } from "../../src/lib/configuration-api";
import type { ConfigurationRuntime } from "../../src/lib/configuration-runtime";
import { reconciliationSnapshotFixture } from "../../../../packages/core/tests/fixtures/reconciliation-v1";
import {
  toConfigurationCommandContext,
  V2HttpError,
  v2RouteError,
} from "../../src/lib/v2-auth";

const originalNodeEnv = process.env.NODE_ENV;
const organizationId = "organization-1";

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("configuration command context", () => {
  it.each([
    ["PREPARER", "EDITOR"],
    ["REVIEWER", "APPROVER"],
    ["ADMIN", "ADMIN"],
    ["AUDITOR", "AUDITOR"],
  ] as const)("mapeia %s para %s e lê metadados do body", (legacyRole, configurationRole) => {
    const request = requestFor("/configuration", undefined, legacyRole);
    const actor = { actorId: "actor-1", companyRoles: { [organizationId]: [legacyRole] } };

    const context = toConfigurationCommandContext(
      request,
      actor,
      organizationId,
      organizationId,
      { reason: "mudança aprovada", correlationId: "correlation-1" },
    );

    expect(context.actor.organizationRoles[organizationId]).toEqual([configurationRole] satisfies ConfigurationRole[]);
    expect(context.reason).toBe("mudança aprovada");
    expect(context.correlationId).toBe("correlation-1");
  });

  it("usa headers quando o body não contém metadados", () => {
    const request = requestFor("/configuration", undefined, "PREPARER", {
      "x-reason": "motivo no header",
      "x-correlation-id": "header-correlation",
    });
    const actor = { actorId: "actor-1", companyRoles: { [organizationId]: ["PREPARER" as const] } };

    const context = toConfigurationCommandContext(request, actor, organizationId, organizationId);

    expect(context.reason).toBe("motivo no header");
    expect(context.correlationId).toBe("header-correlation");
  });
});

describe("configuration error HTTP mapping", () => {
  it.each([
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["SNAPSHOT_NOT_FOUND", 404],
    ["DUPLICATE_PROFILE", 409],
    ["IDEMPOTENCY_CONFLICT", 409],
    ["FILE_NAME_CONTENT_CHANGED", 409],
    ["INVALID_LIFECYCLE_TRANSITION", 422],
    ["SNAPSHOT_BLOCKED", 422],
    ["AMBIGUOUS_ROUTING", 422],
  ])("mapeia %s para %i e preserva mensagem segura", async (code, status) => {
    const response = v2RouteError(new ConfigurationError(code, "mensagem segura do domínio"));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: "mensagem segura do domínio" } });
  });
});

describe("configuration HTTP handlers", () => {
  it("rejeita comando sem autenticação antes de acessar o serviço", async () => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).saveDraft(new NextRequest(
      "http://localhost/api/v2/configuration/drafts",
      { method: "POST", body: JSON.stringify(draftBody()) },
    ));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Credencial ausente ou inválida" },
    });
    expect(await runtime.repository.findWizardDraftById(organizationId, "draft-1")).toBeNull();
  });

  it("rejeita tenant sem papel no companyId antes do serviço", async () => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).saveDraft(requestFor(
      "/api/v2/configuration/drafts",
      { ...draftBody(), orgId: "organization-2", companyId: "organization-2" },
      "PREPARER",
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Acesso negado para a empresa informada" },
    });
    expect(await runtime.repository.findWizardDraftById(organizationId, "draft-1")).toBeNull();
  });

  it("rejeita organização diferente da empresa autorizada antes do serviço", async () => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).saveDraft(requestFor(
      "/api/v2/configuration/drafts",
      { ...draftBody(), orgId: "organization-2" },
      "PREPARER",
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "A organização deve corresponder à empresa autorizada" },
    });
    expect(await runtime.repository.findWizardDraftById("organization-2", "draft-1")).toBeNull();
  });

  it("salva e retoma rascunho pelo mesmo ator com contexto auditável", async () => {
    const runtime = createRuntime();
    const handlers = createConfigurationHandlers(runtime);

    const savedResponse = await handlers.saveDraft(requestFor(
      "/api/v2/configuration/drafts",
      draftBody(),
      "PREPARER",
    ));
    const resumedResponse = await handlers.resumeDraft(requestFor(
      "/api/v2/configuration/drafts/draft-1?orgId=organization-1&companyId=organization-1&reason=retomar&correlationId=resume-1",
      undefined,
      "PREPARER",
    ), { params: Promise.resolve({ id: "draft-1" }) });

    expect(savedResponse.status).toBe(200);
    expect(await savedResponse.json()).toMatchObject({
      success: true,
      data: { id: "draft-1", organizationId, actorId: "actor-1", step: "accounts", data: { account: "123" } },
    });
    expect(resumedResponse.status).toBe(200);
    expect(await resumedResponse.json()).toMatchObject({ success: true, data: { id: "draft-1", actorId: "actor-1" } });
    expect(await runtime.repository.listAuditEvents(organizationId, "WIZARD_DRAFT", "draft-1")).toMatchObject([{
      reason: "salvar configuração",
      correlationId: "correlation-1",
      actor: "actor-1",
    }]);
  });

  it("registra conta bancária e cria perfil por comandos HTTP validados", async () => {
    const runtime = createRuntime();
    await seedReferences(runtime);
    const handlers = createConfigurationHandlers(runtime);

    const bankResponse = await handlers.registerBankAccount(requestFor(
      "/api/v2/configuration/bank-accounts",
      {
        orgId: organizationId,
        companyId: organizationId,
        id: "bank-account-1",
        legalEntityId: "legal-1",
        bankId: "bank-1",
        agency: "0001-0",
        account: "000123-4",
        currency: "BRL",
        accountType: "CHECKING",
        effectiveFrom: "2026-01-01",
        reason: "cadastrar conta",
        correlationId: "bank-correlation",
      },
      "PREPARER",
    ));
    const profileResponse = await handlers.createProfile(requestFor(
      "/api/v2/configuration/profiles",
      {
        orgId: organizationId,
        companyId: organizationId,
        id: "profile-1",
        versionId: "profile-version-1",
        legalEntityId: "legal-1",
        name: "Conciliação principal",
        effectiveFrom: "2026-01-01",
        configuration: { signConfirmed: true },
        reason: "criar perfil",
        correlationId: "profile-correlation",
      },
      "PREPARER",
    ));

    expect(bankResponse.status).toBe(200);
    expect(await bankResponse.json()).toMatchObject({
      success: true,
      data: { id: "bank-account-1", agency: "10", account: "1234", currency: "BRL", status: "ACTIVE" },
    });
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toMatchObject({
      success: true,
      data: {
        profile: { id: "profile-1", organizationId, legalEntityId: "legal-1" },
        version: { id: "profile-version-1", status: "draft", createdBy: "actor-1" },
      },
    });
    expect((await runtime.repository.listProfiles(organizationId)).map(({ id }) => id)).toEqual(["profile-1"]);
  });

  it("rejeita campos extras em comando sem persistir dados", async () => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).saveDraft(requestFor(
      "/api/v2/configuration/drafts",
      { ...draftBody(), unexpected: true },
      "PREPARER",
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(await runtime.repository.findWizardDraftById(organizationId, "draft-1")).toBeNull();
  });

  it("exige reason e correlationId em comandos antes de persistir", async () => {
    const runtime = createRuntime();
    const { reason: _reason, correlationId: _correlationId, ...body } = draftBody();
    const response = await createConfigurationHandlers(runtime).saveDraft(requestFor(
      "/api/v2/configuration/drafts",
      body,
      "PREPARER",
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "REASON_REQUIRED", message: "Motivo é obrigatório" } });
    expect(await runtime.repository.findWizardDraftById(organizationId, "draft-1")).toBeNull();
  });

  it("permite ao AUDITOR listar perfis sem contexto de comando", async () => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).listProfiles(requestFor(
      "/api/v2/configuration/profiles?orgId=organization-1&companyId=organization-1",
      undefined,
      "AUDITOR",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: [] });
  });

  it.each(["PREPARER", "AUDITOR"] as const)("rejeita snapshot para %s antes do domínio", async (role) => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).generateSnapshot(requestFor(
      "/api/v2/configuration/snapshots",
      {
        orgId: organizationId,
        companyId: organizationId,
        id: "snapshot-1",
        profileVersionId: "version-1",
        bankAccountId: "bank-account-1",
        effectiveAt: "2026-08-12",
        reason: "snapshot",
        correlationId: "snapshot-1",
      },
      role,
    ));

    expect(response.status).toBe(403);
    expect(await runtime.repository.findPublishedSnapshotById?.(organizationId, "snapshot-1")).toBeNull();
  });

  it.each(["REVIEWER", "AUDITOR"] as const)("rejeita execução normal para %s antes do domínio", async (role) => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).executeRun(requestFor(
      "/api/v2/configuration/runs",
      runBody(),
      role,
    ));

    expect(response.status).toBe(403);
    expect(await runtime.repository.findRunRecordById?.(organizationId, "run-1")).toBeNull();
  });

  it("exige ADMIN para reprocesso e ignora autorização fornecida pelo cliente", async () => {
    const runtime = createRuntime();
    const handlers = createConfigurationHandlers(runtime);
    const response = await handlers.executeRun(requestFor(
      "/api/v2/configuration/runs",
      { ...runBody(), allowReprocess: true, reprocessOfRunId: "source-run" },
      "PREPARER",
    ));
    const injected = await handlers.executeRun(requestFor(
      "/api/v2/configuration/runs",
      { ...runBody(), reprocessAuthorized: true },
      "PREPARER",
    ));

    expect(response.status).toBe(403);
    expect(injected.status).toBe(400);
    expect(await injected.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("não aceita resultado arbitrário de simulação", async () => {
    const runtime = createRuntime();
    const response = await createConfigurationHandlers(runtime).recordSimulation(requestFor(
      "/api/v2/configuration/simulations",
      {
        orgId: organizationId,
        companyId: organizationId,
        id: "simulation-1",
        profileVersionId: "version-1",
        status: "SUCCEEDED",
        result: { forged: true },
        reason: "forjar simulação",
        correlationId: "simulation-1",
      },
      "PREPARER",
    ));

    expect(response.status).toBe(400);
    expect(await runtime.repository.findSimulationById(organizationId, "simulation-1")).toBeNull();
  });

  it("registra simulação a partir do resultado real do orchestrator fake", async () => {
    const runtime = createRuntime();
    const snapshot = reconciliationSnapshotFixture();
    await runtime.repository.savePublishedSnapshot?.({
      id: "snapshot-1", organizationId, profileId: snapshot.profileId, profileVersionId: "version-1",
      bankAccountId: snapshot.bankAccountId, requestedEffectiveAt: snapshot.effectiveFrom,
      effectiveFrom: snapshot.effectiveFrom, effectiveTo: snapshot.effectiveTo, snapshot,
      configurationHash: snapshot.configurationHash, createdAt: "2026-08-12T12:00:00.000Z", createdBy: "actor-1",
    });
    await runtime.repository.saveProfileVersion({
      id: "version-1", organizationId, profileId: snapshot.profileId, version: 7, status: "approved", configuration: {},
      validationIssues: [], effectiveFrom: snapshot.effectiveFrom, effectiveTo: snapshot.effectiveTo,
      createdAt: "2026-08-12T12:00:00.000Z", createdBy: "actor-1", updatedAt: "2026-08-12T12:00:00.000Z",
      approvedAt: "2026-08-12T12:00:00.000Z", approvedBy: "reviewer-1",
    });
    const { mode: _mode, ...simulationRun } = runBody();
    const response = await createConfigurationHandlers(runtime).recordSimulation(requestFor(
      "/api/v2/configuration/simulations",
      { ...simulationRun, id: "simulation-1", profileVersionId: "version-1", fakeScenario: "success" },
      "PREPARER",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { id: "simulation-1", status: "SUCCEEDED" } });
    expect(await runtime.repository.findSimulationById(organizationId, "simulation-1"))
      .toMatchObject({ bankAccountId: snapshot.bankAccountId, status: "SUCCEEDED", result: { runId: "run-1", status: "SUCCEEDED" } });
  });

  it("em produção proíbe fakeScenario e usa o engine real injetado para simulação", async () => {
    process.env.NODE_ENV = "production";
    const requests: unknown[] = [];
    const engine: EnginePort = {
      execute: async (request) => {
        requests.push(request);
        return { status: "SUCCEEDED" };
      },
    };
    const runtime = createRuntime(engine);
    await seedRunnableSnapshot(runtime);
    const { mode: _mode, ...simulationRun } = runBody();
    const handlers = createConfigurationHandlers(runtime);
    const rejected = await handlers.recordSimulation(requestFor(
      "/api/v2/configuration/simulations",
      { ...simulationRun, id: "simulation-fake", profileVersionId: "version-1", fakeScenario: "success" },
      "PREPARER",
    ));
    const executed = await handlers.recordSimulation(requestFor(
      "/api/v2/configuration/simulations",
      {
        ...simulationRun,
        id: "simulation-real",
        runId: "run-real",
        requestId: "request-real",
        idempotencyKey: "key-real",
        profileVersionId: "version-1",
      },
      "PREPARER",
    ));

    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: "FAKE_SCENARIO_FORBIDDEN" } });
    expect(executed.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(await runtime.repository.findSimulationById(organizationId, "simulation-real"))
      .toMatchObject({ bankAccountId: "bank-account-1", status: "SUCCEEDED" });
  });

  it("rejeita metadados de publicação forjados no save de import mapping", async () => {
    const runtime = createRuntime();
    await seedDraftProfileVersion(runtime);
    const response = await createConfigurationHandlers(runtime).saveImportMapping(requestFor(
      "/api/v2/configuration/import-mappings",
      { ...importMappingBody(), publishedAt: "2026-08-12T12:00:00.000Z", publishedBy: "attacker" },
      "PREPARER",
    ));

    expect(response.status).toBe(400);
    expect(await runtime.repository.findImportMappingVersionById(organizationId, "import-1")).toBeNull();
  });

  it.each(["PREPARER", "AUDITOR"] as const)("rejeita publicação de import mapping para %s", async (role) => {
    const runtime = createRuntime();
    await seedDraftProfileVersion(runtime);
    await saveImportMapping(runtime);
    const response = await createConfigurationHandlers(runtime).publishImportMapping(requestFor(
      "/api/v2/configuration/import-mappings/import-1/publish",
      publicationBody(),
      role,
    ), { params: Promise.resolve({ id: "import-1" }) });

    expect(response.status).toBe(403);
    expect(await runtime.repository.findImportMappingVersionById(organizationId, "import-1"))
      .not.toHaveProperty("publishedAt");
  });

  it.each(["REVIEWER", "ADMIN"] as const)("publica import mapping com carimbo do servidor para %s", async (role) => {
    const runtime = createRuntime();
    await seedDraftProfileVersion(runtime);
    await saveImportMapping(runtime);
    const response = await createConfigurationHandlers(runtime).publishImportMapping(requestFor(
      "/api/v2/configuration/import-mappings/import-1/publish",
      publicationBody(),
      role,
    ), { params: Promise.resolve({ id: "import-1" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: "import-1", publishedAt: "2026-08-12T12:00:00.000Z", publishedBy: "actor-1" },
    });
  });
});

function createRuntime(engine: EnginePort = new FakeReconciliationEngineAdapter()): ConfigurationRuntime {
  const repository = new InMemoryConfigurationRepository();
  const configuration = new ConfigurationService(repository, () => new Date("2026-08-12T12:00:00.000Z"), () => "audit-1");
  const snapshots = new ProfileSnapshotService(repository, undefined, () => new Date("2026-08-12T12:00:00.000Z"));
  const orchestrator = new ReconciliationOrchestrator(repository, engine);
  return {
    repository,
    configuration,
    snapshots,
    orchestrator,
    orchestratorForScenario: (scenario) => new ReconciliationOrchestrator(
      repository,
      new FakeReconciliationEngineAdapter(scenario),
    ),
    authorizeActor: async (request, companyId, roles = ["PREPARER", "REVIEWER", "ADMIN", "AUDITOR"]) => {
      if (!request.headers.get("authorization")) throw new V2HttpError(401, "UNAUTHORIZED", "Credencial ausente ou inválida");
      const role = (request.headers.get("x-test-role") || "PREPARER") as "PREPARER" | "REVIEWER" | "ADMIN" | "AUDITOR";
      if (companyId !== organizationId || !roles.includes(role)) {
        throw new V2HttpError(403, "FORBIDDEN", "Acesso negado para a empresa informada");
      }
      return { actorId: "actor-1", companyRoles: { [companyId ?? organizationId]: [role] } };
    },
  };
}

async function seedRunnableSnapshot(runtime: ConfigurationRuntime): Promise<void> {
  const snapshot = reconciliationSnapshotFixture();
  await runtime.repository.savePublishedSnapshot?.({
    id: "snapshot-1", organizationId, profileId: snapshot.profileId, profileVersionId: "version-1",
    bankAccountId: snapshot.bankAccountId, requestedEffectiveAt: snapshot.effectiveFrom,
    effectiveFrom: snapshot.effectiveFrom, effectiveTo: snapshot.effectiveTo, snapshot,
    configurationHash: snapshot.configurationHash, createdAt: "2026-08-12T12:00:00.000Z", createdBy: "actor-1",
  });
  await runtime.repository.saveProfileVersion({
    id: "version-1", organizationId, profileId: snapshot.profileId, version: 7, status: "approved", configuration: {},
    validationIssues: [], effectiveFrom: snapshot.effectiveFrom, effectiveTo: snapshot.effectiveTo,
    createdAt: "2026-08-12T12:00:00.000Z", createdBy: "actor-1", updatedAt: "2026-08-12T12:00:00.000Z",
    approvedAt: "2026-08-12T12:00:00.000Z", approvedBy: "reviewer-1",
  });
}

async function seedDraftProfileVersion(runtime: ConfigurationRuntime): Promise<void> {
  await runtime.repository.saveProfileVersion({
    id: "version-1", organizationId, profileId: "profile-1", version: 1, status: "draft", configuration: {},
    validationIssues: [], effectiveFrom: "2026-01-01", createdAt: "2026-08-12T12:00:00.000Z",
    createdBy: "actor-1", updatedAt: "2026-08-12T12:00:00.000Z",
  });
}

async function saveImportMapping(runtime: ConfigurationRuntime): Promise<void> {
  const response = await createConfigurationHandlers(runtime).saveImportMapping(requestFor(
    "/api/v2/configuration/import-mappings",
    importMappingBody(),
    "PREPARER",
  ));
  expect(response.status).toBe(200);
}

function importMappingBody() {
  return {
    orgId: organizationId,
    companyId: organizationId,
    id: "import-1",
    profileVersionId: "version-1",
    source: "BANK" as const,
    version: 1,
    fieldMap: { amount: "amountCents" },
    status: "ACTIVE" as const,
    effectiveFrom: "2026-01-01",
    reason: "salvar mapping",
    correlationId: "import-save-1",
  };
}

function publicationBody() {
  return {
    orgId: organizationId,
    companyId: organizationId,
    profileVersionId: "version-1",
    reason: "publicar mapping",
    correlationId: "import-publish-1",
  };
}

async function seedReferences(runtime: ConfigurationRuntime): Promise<void> {
  const at = "2026-08-12T12:00:00.000Z";
  await runtime.repository.saveOrganization({
    id: organizationId,
    name: "Organização",
    timezone: "America/Sao_Paulo",
    defaultCurrency: "BRL",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  });
  await runtime.repository.saveLegalEntity({
    id: "legal-1",
    organizationId,
    legalName: "Empresa 1",
    taxId: "12345678000100",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  });
  await runtime.repository.saveBankDirectory({
    id: "directory-1",
    organizationId,
    name: "FEBRABAN",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  });
  await runtime.repository.saveBank({
    id: "bank-1",
    organizationId,
    directoryId: "directory-1",
    code: "001",
    name: "Banco",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  });
}

function draftBody() {
  return {
    orgId: organizationId,
    companyId: organizationId,
    id: "draft-1",
    step: "accounts",
    data: { account: "123" },
    reason: "salvar configuração",
    correlationId: "correlation-1",
  };
}

function runBody() {
  return {
    orgId: organizationId,
    companyId: organizationId,
    snapshotId: "snapshot-1",
    requestId: "request-1",
    runId: "run-1",
    idempotencyKey: "key-1",
    requestedAt: "2026-08-12T12:00:00.000Z",
    period: { startDate: "2026-08-01", endDate: "2026-08-12" },
    bankTransactions: [],
    ledgerTransactions: [],
    fileHashes: ["a".repeat(64)],
    mode: "official" as const,
    reason: "executar",
    correlationId: "run-1",
  };
}

function requestFor(
  path: string,
  body?: unknown,
  role: "PREPARER" | "REVIEWER" | "ADMIN" | "AUDITOR" = "PREPARER",
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer test-access-token", "x-test-role": role, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
