import { describe, expect, it } from "vitest";

import {
  EffectiveConfigurationResolver,
  FakeReconciliationEngineAdapter,
  type FakeEngineScenario,
  InMemoryConfigurationRepository,
  ProfileSnapshotService,
  RealReconciliationEngineAdapter,
  ReconciliationOrchestrator,
  RoutingService,
  type AccountMapping,
  type EnginePort,
  type PublishedSnapshot,
} from "../../src/configuration/index.js";
import {
  RECONCILIATION_CONTRACT_VERSION_V1,
  createEffectiveProfileSnapshotV1,
  type EffectiveProfileSnapshotV1,
} from "../../src/contracts/reconciliation-v1.js";
import { canonicalTransactionFixture, reconciliationSnapshotFixture } from "../fixtures/reconciliation-v1.js";

const at = "2026-06-16T12:00:00.000Z";
const date = "2026-06-15";

describe("configuration routing and orchestration", () => {
  it("roteia 1:N por menor prioridade e suporta ALL/ANY e campos de metadata", () => {
    const service = new RoutingService();
    const transaction = canonicalTransactionFixture("bank-1", "BANK", {
      description: "Supplier payment",
      metadata: { unit: "SP", branch: "001", transactionType: "PIX", history: "urgent" },
    });
    const mappings = [
      mapping("route-receipts", "ledger-receipts", 20, "DESCRIPTION", "RECEIPT"),
      {
        ...mapping("route-payments", "ledger-payments", 10, "DESCRIPTION", "PAYMENT"),
        match: "ALL" as const,
        conditions: [condition("DESCRIPTION", "CONTAINS", "PAYMENT"), condition("UNIT", "EQUALS", "SP")],
      },
      { ...mapping("fallback", "ledger-fallback", 99, "DESCRIPTION", "unused"), fallback: true, conditions: [] },
    ];

    expect(service.route(transaction, mappings)).toMatchObject({
      status: "ROUTED",
      ledgerAccountId: "ledger-payments",
      priority: 10,
      fallback: false,
    });
  });

  it("não escolhe destino quando duas regras aplicáveis empatam", () => {
    const service = new RoutingService();
    const transaction = canonicalTransactionFixture("bank-1", "BANK");
    const result = service.route(transaction, [
      mapping("route-a", "ledger-a", 10, "DESCRIPTION", "PAYMENT"),
      mapping("route-b", "ledger-b", 10, "DESCRIPTION", "PAYMENT"),
    ]);

    expect(result).toEqual({ status: "ROUTING_AMBIGUOUS", mappingIds: ["route-a", "route-b"] });
    expect(result).not.toHaveProperty("ledgerAccountId");
  });

  it("aplica amount range, sign, data, documento, contraparte e conta de contrapartida", () => {
    const transaction = canonicalTransactionFixture("bank-fields", "BANK", {
      amountCents: "-12500",
      documentId: "DOC-10",
      originCode: "PIX",
      counterparty: "ACME",
      taxId: "123",
      ledgerCounterpartAccount: "2.01",
      postingDate: date,
    });
    const conditions = [
      condition("AMOUNT_CENTS", "BETWEEN", ["-13000", "-12000"]),
      condition("SIGN", "EQUALS", "NEGATIVE"),
      condition("POSTING_DATE", "GREATER_THAN_OR_EQUAL", "2026-06-01"),
      condition("DOCUMENT_ID", "STARTS_WITH", "DOC"),
      condition("ORIGIN_CODE", "IN", ["TED", "PIX"]),
      condition("COUNTERPARTY", "MATCHES_REGEX", "^ACME$"),
      condition("TAX_ID", "EQUALS", "123"),
      condition("LEDGER_COUNTERPART_ACCOUNT", "EQUALS", "2.01"),
    ];
    const result = new RoutingService().route(transaction, [{ ...mapping("all", "ledger-a", 1), conditions }]);
    expect(result).toMatchObject({ status: "ROUTED", ledgerAccountId: "ledger-a" });
  });

  it("preserva a ordem dos limites BETWEEN ao publicar e executar a rota", () => {
    const input = JSON.parse(JSON.stringify(reconciliationSnapshotFixture())) as Omit<EffectiveProfileSnapshotV1, "configurationHash">;
    input.routing.rules = [{
      ...input.routing.rules[0]!,
      conditions: [condition("AMOUNT_CENTS", "BETWEEN", ["2", "100"])],
    }];
    const snapshot = createEffectiveProfileSnapshotV1(input);
    const transaction = canonicalTransactionFixture("bank-range", "BANK", { amountCents: "50" });

    expect(snapshot.routing.rules[0]!.conditions[0]!.value).toEqual(["2", "100"]);
    expect(new RoutingService().routePolicy(transaction, snapshot.routing)).toMatchObject({
      status: "ROUTED",
      ledgerAccountId: "ledger-account-payments",
    });
  });

  it("resolve GLOBAL até PROFILE_VERSION com proveniência e bloqueia ciclo", async () => {
    const repository = new InMemoryConfigurationRepository();
    const base = node("global", "ORGANIZATION", "global", undefined, { tolerance: 1, inherited: true }, "GLOBAL");
    const layout = node("layout", "ORGANIZATION", "layout-1", "global", { layout: "generic" }, "BANK_LAYOUT");
    const entity = node("entity", "LEGAL_ENTITY", "entity-1", "layout", { tolerance: 2 });
    const version = node("version", "PROFILE_VERSION", "version-1", "entity", { local: true });
    await repository.saveInheritanceNode(base);
    await repository.saveInheritanceNode(layout);
    await repository.saveInheritanceNode(entity);
    await repository.saveInheritanceNode(version);
    await repository.saveInheritanceOverride({
      id: "override-1", organizationId: "org-1", nodeId: "version", key: "tolerance", value: 3,
      reason: "specific", createdAt: at, createdBy: "actor",
    });

    const resolved = await new EffectiveConfigurationResolver(repository).resolveNode("org-1", "version", date);
    expect(resolved.values).toEqual({ tolerance: 3, inherited: true, layout: "generic", local: true });
    expect(resolved.provenance.tolerance).toMatchObject({
      effective: 3,
      origin: { nodeId: "version", level: "PROFILE_VERSION" },
      inherited: false,
      override: true,
    });

    const cyclic = new InMemoryConfigurationRepository();
    await cyclic.saveInheritanceNode(node("a", "ORGANIZATION", "a", "b", {}, "GLOBAL"));
    await cyclic.saveInheritanceNode(node("b", "LEGAL_ENTITY", "b", "a", {}));
    await expect(new EffectiveConfigurationResolver(cyclic).resolveNode("org-1", "a", date))
      .rejects.toMatchObject({ code: "INHERITANCE_CYCLE" });
  });

  it("gera snapshot validado somente com configuração completa e preserva imutabilidade histórica", async () => {
    const repository = await snapshotReadyRepository();
    repository.listSimulations = async () => { throw new Error("snapshot must not depend on simulation"); };
    const service = new ProfileSnapshotService(repository, undefined, () => new Date(at));
    const published = await service.create({
      id: "snapshot-1", organizationId: "org-1", profileVersionId: "version-1",
      bankAccountId: "bank-account-1", effectiveAt: date, createdBy: "actor",
    });

    expect(published.snapshot.configurationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(published.requestedEffectiveAt).toBe(date);
    expect(published.snapshot.ledgerAccountIds).toEqual(["ledger-payments", "ledger-receipts"]);
    await expect(repository.savePublishedSnapshot({ ...published, configurationHash: "changed" }))
      .rejects.toThrow("immutable");
    expect((await repository.findPublishedSnapshotById("org-1", "snapshot-1"))?.configurationHash)
      .toBe(published.configurationHash);
  });

  it("calcula vigência do snapshot com ledger, imports e cadeia de herança", async () => {
    const repository = await snapshotReadyRepository();
    await repository.saveLedgerAccount({
      ...(await repository.findLedgerAccountById("org-1", "ledger-payments"))!,
      effectiveFrom: "2026-03-01",
      effectiveTo: "2026-11-01",
    });
    await repository.saveImportMappingVersion({
      ...(await repository.findImportMappingVersionById("org-1", "import-BANK"))!,
      effectiveFrom: "2026-04-01",
      effectiveTo: "2026-10-01",
    });
    await repository.saveInheritanceNode(node("global", "ORGANIZATION", "global", undefined, {}, "GLOBAL"));
    await repository.saveInheritanceNode({
      ...node("version-node", "PROFILE_VERSION", "version-1", "global", {}),
      effectiveFrom: "2026-05-01",
      effectiveTo: "2026-09-01",
    });

    const published = await new ProfileSnapshotService(repository).create({
      ...snapshotInput(),
      inheritanceNodeId: "version-node",
    });

    expect(published).toMatchObject({ effectiveFrom: "2026-05-01", effectiveTo: "2026-09-01" });
  });

  it("reutiliza snapshot somente quando perfil, conta e data efetiva coincidem", async () => {
    const repository = await snapshotReadyRepository();
    const service = new ProfileSnapshotService(repository);
    const original = await service.create(snapshotInput());

    expect(await service.create(snapshotInput())).toEqual(original);
    await expect(service.create({ ...snapshotInput(), effectiveAt: "2026-06-14" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(service.create({ ...snapshotInput(), effectiveAt: "2025-12-31" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(service.create({ ...snapshotInput(), bankAccountId: "other-account" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(service.create({ ...snapshotInput(), inheritanceNodeId: "different-chain" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("bloqueia snapshot por moeda divergente e overlap incompatível", async () => {
    const currencyRepository = await snapshotReadyRepository();
    await currencyRepository.saveLedgerAccount({
      ...(await currencyRepository.findLedgerAccountById("org-1", "ledger-payments"))!, currency: "USD",
    });
    await expect(new ProfileSnapshotService(currencyRepository).create(snapshotInput()))
      .rejects.toMatchObject({ code: "SNAPSHOT_BLOCKED" });

    const overlapRepository = await snapshotReadyRepository();
    await overlapRepository.saveAccountMapping(mapping("conflict", "ledger-receipts", 10));
    await expect(new ProfileSnapshotService(overlapRepository).create(snapshotInput()))
      .rejects.toMatchObject({ code: "SNAPSHOT_BLOCKED" });
  });

  it("seleciona versões futuras por data sem superseder a atual", async () => {
    const repository = new InMemoryConfigurationRepository();
    await repository.saveProfileVersion(version("current", 1, "2026-01-01", "2027-01-01"));
    await repository.saveProfileVersion(version("future", 2, "2027-01-01"));
    const { ConfigurationService } = await import("../../src/configuration/ConfigurationService.js");
    const service = new ConfigurationService(repository);

    expect((await service.findEffectiveProfileVersion("org-1", "profile-1", "2026-12-31"))?.id).toBe("current");
    expect((await service.findEffectiveProfileVersion("org-1", "profile-1", "2027-01-01"))?.id).toBe("future");
    expect((await repository.findProfileVersionById("org-1", "current"))?.status).toBe("published");
  });

  it("preserva conteúdo publicado e permite somente inativação administrativa", async () => {
    const repository = new InMemoryConfigurationRepository();
    const published = version("current", 1, "2026-01-01");
    await repository.saveProfileVersion(published);

    await repository.saveProfileVersion({ ...published, status: "inactive", updatedAt: "2026-06-17T00:00:00.000Z" });
    expect((await repository.findProfileVersionById("org-1", "current"))?.status).toBe("inactive");
    await expect(repository.saveProfileVersion({
      ...published,
      status: "inactive",
      configuration: { changed: true },
      updatedAt: "2026-06-18T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "IMMUTABLE_PROFILE_VERSION" });
  });

  it("simulação usa fake e não cria execução oficial; N:1 permanece isolado por conta", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-a", reconciliationSnapshotFixture(), "version-a");
    const second = snapshotForBank("bank-account-2");
    await saveSnapshot(repository, "snapshot-b", second, "version-b");
    const fake = new FakeReconciliationEngineAdapter("success");
    const orchestrator = new ReconciliationOrchestrator(repository, fake, undefined, () => new Date(at));
    await orchestrator.execute(runInput("snapshot-a", "run-a", "simulation", "bank-account-1"));
    await orchestrator.execute(runInput("snapshot-b", "run-b", "official", "bank-account-2"));

    const runs = await repository.listRunRecords("organization-1");
    expect(runs.filter((run) => run.mode === "official").map((run) => run.bankAccountId)).toEqual(["bank-account-2"]);
    expect(runs.map((run) => run.profileVersionId).sort()).toEqual(["version-a", "version-b"]);
    expect(fake.requests).toHaveLength(2);
  });

  it("adapter real consome request v1 diretamente e projeta resultado", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const orchestrator = new ReconciliationOrchestrator(repository, new RealReconciliationEngineAdapter(), undefined, () => new Date(at));
    const run = await orchestrator.execute(runInput("snapshot-1", "run-real", "official", "bank-account-1"));

    expect(run.status).toBe("SUCCEEDED");
    expect(run.result).toMatchObject({ requestId: "request-run-real", runId: "run-real", configurationHash: run.configurationHash });
    expect(run.request.bankTransactions[0]?.ledgerAccountId).toBe("ledger-account-payments");
  });

  it("mantém ledger-only e envia ledger mesmo sem transações bancárias", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const fake = new FakeReconciliationEngineAdapter("success");
    const input = runInput("snapshot-1", "run-ledger-only", "simulation", "bank-account-1");
    const ledgerOnly = canonicalTransactionFixture("ledger-only", "LEDGER", {
      bankAccountId: "bank-account-1",
      ledgerAccountId: "ledger-account-receipts",
    });

    const run = await new ReconciliationOrchestrator(repository, fake).execute({
      ...input,
      bankTransactions: [],
      ledgerTransactions: [ledgerOnly],
    });

    expect(run.request.bankTransactions).toEqual([]);
    expect(run.request.ledgerTransactions.map((transaction) => transaction.id)).toEqual(["ledger-only"]);
    expect(fake.requests[0]?.ledgerTransactions).toHaveLength(1);
  });

  it.each([
    ["timeout", "TIMED_OUT"], ["cancel", "CANCELLED"], ["failure", "FAILED"], ["pending", "PENDING"], ["blocked", "BLOCKED"],
  ] as const)("fake %s persiste status %s", async (scenario: FakeEngineScenario, status: string) => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const run = await new ReconciliationOrchestrator(
      repository, new FakeReconciliationEngineAdapter(scenario), undefined, () => new Date(at), () => "audit-1",
    ).execute(runInput("snapshot-1", `run-${scenario}`, "official", "bank-account-1"));
    expect(run.status).toBe(status);
  });

  it("não chama engine para transação sem rota ou ambígua", async () => {
    for (const [id, snapshot] of [["unmapped", snapshotWithoutRoute()], ["ambiguous", ambiguousSnapshot()]] as const) {
      const repository = new InMemoryConfigurationRepository();
      await saveSnapshot(repository, id, snapshot, "version-1");
      const fake = new FakeReconciliationEngineAdapter();
      const orchestrator = new ReconciliationOrchestrator(repository, fake);
      await expect(orchestrator.execute(runInput(id, `run-${id}`, "official", "bank-account-1")))
        .rejects.toMatchObject({ code: id === "unmapped" ? "UNMAPPED" : "ROUTING_AMBIGUOUS" });
      expect(fake.requests).toHaveLength(0);
    }
  });

  it("distingue replay idempotente, duplicidade e reprocessamento autorizado com auditoria", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const fake = new FakeReconciliationEngineAdapter();
    const orchestrator = new ReconciliationOrchestrator(repository, fake, undefined, () => new Date(at), () => `audit-${Math.random()}`);
    const originalInput = runInput("snapshot-1", "run-1", "official", "bank-account-1");
    const original = await orchestrator.execute(originalInput);
    const replay = await orchestrator.execute(originalInput);
    expect(replay.id).toBe(original.id);
    expect(fake.requests).toHaveLength(1);

    await expect(orchestrator.execute({ ...runInput("snapshot-1", "run-2", "official", "bank-account-1"), idempotencyKey: "new-key" }))
      .rejects.toMatchObject({ code: "FILE_DUPLICATE" });
    await expect(orchestrator.execute({
      ...runInput("snapshot-1", "run-forbidden", "official", "bank-account-1"),
      idempotencyKey: "forbidden-key", allowReprocess: true, reprocessOfRunId: "run-1",
    })).rejects.toMatchObject({ code: "REPROCESS_FORBIDDEN" });
    const reprocessed = await orchestrator.execute({
      ...runInput("snapshot-1", "run-3", "official", "bank-account-1"),
      idempotencyKey: "reprocess-key", allowReprocess: true, reprocessAuthorized: true, reprocessOfRunId: "run-1",
    });
    expect(reprocessed.reprocessOfRunId).toBe("run-1");
    expect((await repository.listAuditEvents("organization-1", "RECONCILIATION_RUN"))
      .some((event) => event.action === "reprocess")).toBe(true);
  });

  it("conflita replay quando snapshot, período, modo ou transações mudam sem chamar engine", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const fake = new FakeReconciliationEngineAdapter();
    const orchestrator = new ReconciliationOrchestrator(repository, fake);
    const original = runInput("snapshot-1", "run-1", "official", "bank-account-1");
    await orchestrator.execute(original);

    await expect(orchestrator.execute({
      ...original,
      period: { startDate: "2026-06-02", endDate: "2026-06-30" },
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(fake.requests).toHaveLength(1);
  });

  it("reproduz execução idêntica após inativação e conflita mudança antes da revalidação de lifecycle", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const fake = new FakeReconciliationEngineAdapter();
    const orchestrator = new ReconciliationOrchestrator(repository, fake);
    const original = runInput("snapshot-1", "run-1", "official", "bank-account-1");
    const completed = await orchestrator.execute(original);
    await repository.saveProfileVersion({
      ...(await repository.findProfileVersionById("organization-1", "version-1"))!,
      status: "inactive",
      updatedAt: "2026-06-17T00:00:00.000Z",
    });

    expect(await orchestrator.execute(original)).toEqual(completed);
    await expect(orchestrator.execute({
      ...original,
      period: { startDate: "2026-06-02", endDate: "2026-06-30" },
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(orchestrator.execute({
      ...runInput("snapshot-1", "run-new", "official", "bank-account-1"),
      fileHashes: ["new-hash"],
      fileNames: ["new.xlsx"],
    })).rejects.toMatchObject({ code: "PROFILE_VERSION_NOT_EXECUTABLE" });
    expect(fake.requests).toHaveLength(1);
  });

  it("bloqueia qualquer hash sobreposto a execução oficial", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const orchestrator = new ReconciliationOrchestrator(repository, new FakeReconciliationEngineAdapter());
    await orchestrator.execute({
      ...runInput("snapshot-1", "run-1", "official", "bank-account-1"),
      fileHashes: ["hash-a", "hash-b"],
      fileNames: ["a.xlsx", "b.xlsx"],
    });

    await expect(orchestrator.execute({
      ...runInput("snapshot-1", "run-2", "official", "bank-account-1"),
      fileHashes: ["hash-a", "hash-c"],
      fileNames: ["a-copy.xlsx", "c.xlsx"],
    })).rejects.toMatchObject({ code: "FILE_DUPLICATE" });
  });

  it("bloqueia oficial sem versão publicada e período fora do snapshot", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1", "approved");
    const orchestrator = new ReconciliationOrchestrator(repository, new FakeReconciliationEngineAdapter());

    await expect(orchestrator.execute(runInput("snapshot-1", "run-approved", "official", "bank-account-1")))
      .rejects.toMatchObject({ code: "PROFILE_VERSION_NOT_EXECUTABLE" });
    await repository.saveProfileVersion({
      ...(await repository.findProfileVersionById("organization-1", "version-1"))!,
      status: "published",
      publishedAt: at,
      publishedBy: "approver",
    });
    await expect(orchestrator.execute({
      ...runInput("snapshot-1", "run-expired", "official", "bank-account-1"),
      period: { startDate: "2026-12-30", endDate: "2026-12-31" },
    })).rejects.toMatchObject({ code: "SNAPSHOT_NOT_EFFECTIVE" });
  });

  it("persiste FAILED e auditoria segura quando engine lança erro", async () => {
    const repository = new InMemoryConfigurationRepository();
    await saveSnapshot(repository, "snapshot-1", reconciliationSnapshotFixture(), "version-1");
    const throwing: EnginePort = { execute: async () => { throw new Error("secret engine detail"); } };
    const orchestrator = new ReconciliationOrchestrator(repository, throwing, undefined, () => new Date(at), () => "audit-failed");

    await expect(orchestrator.execute(runInput("snapshot-1", "run-throw", "official", "bank-account-1")))
      .rejects.toThrow("secret engine detail");
    expect(await repository.findRunRecordById("organization-1", "run-throw")).toMatchObject({ status: "FAILED" });
    expect(await repository.listAuditEvents("organization-1", "RECONCILIATION_RUN", "run-throw"))
      .toMatchObject([{ reason: "engine threw", after: { status: "FAILED" } }]);
  });
});

function mapping(
  id: string,
  ledgerAccountId: string,
  priority = 10,
  field: Parameters<typeof condition>[0] = "DESCRIPTION",
  value: string | readonly string[] = "PAYMENT",
): AccountMapping {
  return {
    id, organizationId: "org-1", profileVersionId: "version-1", bankAccountId: "bank-account-1",
    ledgerAccountId, priority, match: "ALL", conditions: [condition(field, "CONTAINS", value)], fallback: false,
    status: "ACTIVE", effectiveFrom: "2026-01-01", createdAt: at, updatedAt: at,
  };
}

function condition(
  field: "DESCRIPTION" | "DOCUMENT_ID" | "ORIGIN_CODE" | "TRANSACTION_TYPE" | "SIGN" | "AMOUNT_CENTS"
    | "COUNTERPARTY" | "TAX_ID" | "LEDGER_COUNTERPART_ACCOUNT" | "UNIT" | "BRANCH" | "POSTING_DATE" | "METADATA",
  operator: "EQUALS" | "CONTAINS" | "STARTS_WITH" | "MATCHES_REGEX" | "IN" | "GREATER_THAN_OR_EQUAL" | "LESS_THAN" | "BETWEEN",
  value: string | readonly string[],
) {
  return { schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1, field, operator, value } as const;
}

function node(
  id: string,
  level: "ORGANIZATION" | "LEGAL_ENTITY" | "PROFILE" | "PROFILE_VERSION",
  scopeId: string,
  parentNodeId: string | undefined,
  values: Record<string, boolean | number | string>,
  hierarchyLevel?: "GLOBAL" | "BANK_LAYOUT",
) {
  return {
    id, organizationId: "org-1", level, ...(hierarchyLevel ? { hierarchyLevel } : {}), scopeId,
    ...(parentNodeId ? { parentNodeId } : {}), values, status: "ACTIVE" as const,
    effectiveFrom: "2026-01-01", createdAt: at, updatedAt: at,
  };
}

async function snapshotReadyRepository(): Promise<InMemoryConfigurationRepository> {
  const repository = new InMemoryConfigurationRepository();
  const fixture = reconciliationSnapshotFixture();
  await repository.saveOrganization({
    id: "org-1", name: "Org", timezone: fixture.timezone, defaultCurrency: "BRL", status: "ACTIVE", createdAt: at, updatedAt: at,
  });
  await repository.saveLegalEntity({
    id: "entity-1", organizationId: "org-1", legalName: "Entity", taxId: "1", status: "ACTIVE", createdAt: at, updatedAt: at,
  });
  await repository.saveProfile({
    id: "profile-1", organizationId: "org-1", legalEntityId: "entity-1", name: "Profile", status: "ACTIVE", createdAt: at, updatedAt: at,
  });
  await repository.saveProfileVersion({
    id: "version-1", organizationId: "org-1", profileId: "profile-1", version: 1, status: "approved",
    configuration: JSON.parse(JSON.stringify({
      ruleset: fixture.ruleset, signConvention: fixture.signConvention, signConfirmed: true,
      exclusions: fixture.exclusions, tolerances: fixture.tolerances,
    })),
    validationIssues: [], effectiveFrom: "2026-01-01", createdAt: at, createdBy: "actor", updatedAt: at,
    approvedAt: at, approvedBy: "approver",
  });
  await repository.saveBankAccount({
    id: "bank-account-1", organizationId: "org-1", legalEntityId: "entity-1", bankId: "bank-1",
    agency: "1", account: "1", currency: "BRL", accountType: "CHECKING", status: "ACTIVE",
    effectiveFrom: "2026-01-01", createdAt: at, updatedAt: at,
  });
  for (const id of ["ledger-payments", "ledger-receipts"]) {
    await repository.saveLedgerAccount({
      id, organizationId: "org-1", legalEntityId: "entity-1", code: id, name: id, currency: "BRL",
      sourceSystem: "ERP", status: "ACTIVE", effectiveFrom: "2026-01-01", createdAt: at, updatedAt: at,
    });
  }
  await repository.saveAccountMapping(mapping("route-payments", "ledger-payments", 10));
  await repository.saveAccountMapping({ ...mapping("fallback", "ledger-receipts", 99), fallback: true, conditions: [] });
  for (const source of ["BANK", "LEDGER"] as const) {
    await repository.saveImportMappingVersion({
      id: `import-${source}`, organizationId: "org-1", profileVersionId: "version-1", source, version: 1,
      fieldMap: { amount: "amountCents" }, status: "ACTIVE", effectiveFrom: "2026-01-01", publishedAt: at,
      publishedBy: "actor", createdAt: at, updatedAt: at,
    });
  }
  await repository.saveSimulation({
    id: "simulation-1", organizationId: "org-1", profileVersionId: "version-1", status: "SUCCEEDED", result: {},
    bankAccountId: "bank-account-1",
    createdAt: at, createdBy: "actor", approvedAt: at, approvedBy: "approver",
  });
  return repository;
}

function snapshotInput() {
  return { id: "snapshot-1", organizationId: "org-1", profileVersionId: "version-1", bankAccountId: "bank-account-1", effectiveAt: date, createdBy: "actor" };
}

function version(id: string, number: number, effectiveFrom: string, effectiveTo?: string) {
  return {
    id, organizationId: "org-1", profileId: "profile-1", version: number, status: "published" as const,
    configuration: {}, validationIssues: [], effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}),
    createdAt: at, createdBy: "actor", updatedAt: at, publishedAt: at, publishedBy: "actor",
  };
}

async function saveSnapshot(
  repository: InMemoryConfigurationRepository,
  id: string,
  snapshot: Readonly<EffectiveProfileSnapshotV1>,
  profileVersionId: string,
  status: "approved" | "published" = "published",
): Promise<void> {
  const record: PublishedSnapshot = {
    id, organizationId: snapshot.organizationId, profileId: snapshot.profileId, profileVersionId,
    bankAccountId: snapshot.bankAccountId, requestedEffectiveAt: snapshot.effectiveFrom, effectiveFrom: snapshot.effectiveFrom,
    ...(snapshot.effectiveTo ? { effectiveTo: snapshot.effectiveTo } : {}), snapshot,
    configurationHash: snapshot.configurationHash, createdAt: at, createdBy: "actor",
  };
  await repository.savePublishedSnapshot(record);
  await repository.saveProfileVersion({
    id: profileVersionId,
    organizationId: snapshot.organizationId,
    profileId: snapshot.profileId,
    version: Number(snapshot.profileVersion),
    status,
    configuration: {},
    validationIssues: [],
    effectiveFrom: snapshot.effectiveFrom,
    ...(snapshot.effectiveTo ? { effectiveTo: snapshot.effectiveTo } : {}),
    createdAt: at,
    createdBy: "actor",
    updatedAt: at,
    approvedAt: at,
    approvedBy: "approver",
    ...(status === "published" ? { publishedAt: at, publishedBy: "approver" } : {}),
  });
}

function snapshotForBank(bankAccountId: string): Readonly<EffectiveProfileSnapshotV1> {
  const source = reconciliationSnapshotFixture();
  const { configurationHash: _hash, ...input } = source;
  return createEffectiveProfileSnapshotV1({ ...input, bankAccountId });
}

function runInput(snapshotId: string, runId: string, mode: "simulation" | "official", bankAccountId: string) {
  const bank = canonicalTransactionFixture(`bank-${runId}`, "BANK", { bankAccountId });
  const ledger = canonicalTransactionFixture(`ledger-${runId}`, "LEDGER", { bankAccountId });
  return {
    organizationId: "organization-1", snapshotId, requestId: `request-${runId}`, runId,
    idempotencyKey: `key-${runId}`, requestedAt: at, period: { startDate: "2026-06-01", endDate: "2026-06-30" },
    bankTransactions: [bank], ledgerTransactions: [ledger], fileHashes: ["same-file-hash"], fileNames: ["statement.xlsx"],
    mode, actorId: "actor",
  };
}

function snapshotWithoutRoute(): Readonly<EffectiveProfileSnapshotV1> {
  const source = reconciliationSnapshotFixture();
  const { configurationHash: _hash, ...input } = source;
  return createEffectiveProfileSnapshotV1({
    ...input,
    routing: { schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1, strategy: "FIRST_MATCH", rules: [] },
  });
}

function ambiguousSnapshot(): Readonly<EffectiveProfileSnapshotV1> {
  const source = reconciliationSnapshotFixture();
  const snapshot = structuredClone(source);
  Object.assign(snapshot.routing, {
    rules: [
      snapshot.routing.rules[0]!,
      { ...snapshot.routing.rules[0]!, id: "route-tied", ledgerAccountId: "ledger-account-receipts" },
    ],
  });
  return snapshot;
}
