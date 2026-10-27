import { beforeEach, describe, expect, it } from "vitest";

import {
  ConfigurationError,
  ConfigurationService,
  InMemoryConfigurationRepository,
  type Bank,
  type ConfigurationCommandContext,
  type LegalEntity,
  type Organization,
} from "../../src/index.js";
import { reconciliationSnapshotFixture } from "../fixtures/reconciliation-v1.js";

const fixedNow = new Date("2026-08-12T12:00:00.000Z");
const editor = context("org-1", ["EDITOR"]);
const approver = context("org-1", ["APPROVER"]);
const admin = context("org-1", ["ADMIN"]);

describe("configuration domain", () => {
  let repository: InMemoryConfigurationRepository;
  let service: ConfigurationService;
  let sequence: number;

  beforeEach(async () => {
    repository = new InMemoryConfigurationRepository();
    sequence = 0;
    service = new ConfigurationService(repository, () => fixedNow, () => `generated-${++sequence}`);
    await seedOrganization(repository, "org-1");
  });

  it("cadastra conta bancária 1:1 com agência e conta normalizadas", async () => {
    const account = await service.registerBankAccount(bankAccountInput(), editor);

    expect(account).toMatchObject({
      organizationId: "org-1",
      legalEntityId: "entity-1",
      bankId: "bank-1",
      agency: "1234",
      account: "12345X",
      currency: "BRL",
      status: "ACTIVE",
    });
  });

  it("detecta duplicidade por organização, entidade, banco, agência, conta, moeda e sobreposição de vigência", async () => {
    await service.registerBankAccount(bankAccountInput(), editor);

    await expect(
      service.registerBankAccount(
        {
          ...bankAccountInput(),
          id: "bank-account-2",
          agency: "001234",
          account: "12.345-x",
          effectiveFrom: "2026-06-01",
          effectiveTo: "2027-01-01",
        },
        editor,
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_BANK_ACCOUNT" });

    const next = await service.registerBankAccount(
      { ...bankAccountInput(), id: "bank-account-3", effectiveFrom: "2027-01-01", effectiveTo: "2028-01-01" },
      editor,
    );
    expect(next.id).toBe("bank-account-3");
  });

  it("clona perfil e repositório sem compartilhar estado mutável", async () => {
    const source = await service.createProfile(profileInput(), editor);
    const clone = await service.cloneProfile(
      {
        profileId: "profile-2",
        versionId: "profile-version-2",
        sourceProfileId: source.profile.id,
        sourceVersionId: source.version.id,
        organizationId: "org-1",
        name: "Clone",
        effectiveFrom: "2026-01-01",
      },
      editor,
    );

    (clone.version.configuration.nested as { enabled: boolean }).enabled = false;
    const persistedClone = await repository.findProfileVersionById("org-1", clone.version.id);
    const persistedSource = await repository.findProfileVersionById("org-1", source.version.id);

    expect(persistedClone?.configuration).toEqual({ nested: { enabled: true } });
    expect(persistedSource?.configuration).toEqual({ nested: { enabled: true } });
  });

  it("rejeita identificador de versão duplicado antes de criar perfil ou nova versão", async () => {
    await service.createProfile(profileInput(), editor);

    await expect(service.createProfile({
      ...profileInput(),
      id: "profile-2",
      versionId: "profile-version-1",
      name: "Profile 2",
    }, editor)).rejects.toMatchObject({ code: "DUPLICATE_PROFILE_VERSION" });
    expect(await repository.findProfileById("org-1", "profile-2")).toBeNull();

    await expect(service.createNewProfileVersion({
      id: "profile-version-1",
      organizationId: "org-1",
      profileId: "profile-1",
      sourceVersionId: "profile-version-1",
      effectiveFrom: "2027-01-01",
    }, editor)).rejects.toMatchObject({ code: "DUPLICATE_PROFILE_VERSION" });
    expect(await repository.listProfileVersions("org-1", "profile-1")).toHaveLength(1);
  });

  it("faz rollback de profile e versão quando auditoria falha", async () => {
    const failingRepository = new InMemoryConfigurationRepository();
    await seedOrganization(failingRepository, "org-1");
    failingRepository.appendAuditEvent = async () => { throw new Error("audit unavailable"); };
    const failingService = new ConfigurationService(failingRepository, () => fixedNow);

    await expect(failingService.createProfile(profileInput(), editor)).rejects.toThrow("audit unavailable");
    expect(await failingRepository.findProfileById("org-1", "profile-1")).toBeNull();
    expect(await failingRepository.findProfileVersionById("org-1", "profile-version-1")).toBeNull();
  });

  it("permite edição somente em draft/validating e limpa issues ao editar", async () => {
    const { version } = await service.createProfile(profileInput(), editor);
    await service.startProfileVersionValidation("org-1", version.id, editor);
    await service.validateProfileVersion("org-1", version.id, ["stale issue"], editor);

    const changed = await service.updateProfileVersionConfiguration("org-1", version.id, { changed: true }, editor);
    expect(changed.validationIssues).toEqual([]);
    await service.validateProfileVersion("org-1", version.id, [], editor);
    await expect(service.updateProfileVersionConfiguration("org-1", version.id, { changed: false }, editor))
      .rejects.toMatchObject({ code: "IMMUTABLE_PROFILE_VERSION" });
  });

  it("bloqueia alteração de mappings e herança dependente quando a versão está ready", async () => {
    const { version } = await service.createProfile(profileInput(), editor);
    await service.startProfileVersionValidation("org-1", version.id, editor);
    await service.validateProfileVersion("org-1", version.id, [], editor);
    const recordDates = { createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString() };

    await expect(service.saveAccountMapping({
      id: "mapping-1",
      organizationId: "org-1",
      profileVersionId: version.id,
      bankAccountId: "bank-account-1",
      ledgerAccountId: "ledger-1",
      priority: 0,
      fallback: true,
      conditions: [],
      status: "ACTIVE",
      effectiveFrom: "2026-01-01",
      ...recordDates,
    }, editor)).rejects.toMatchObject({ code: "IMMUTABLE_PROFILE_VERSION" });
    await expect(service.saveImportMappingVersion({
      id: "import-1",
      organizationId: "org-1",
      profileVersionId: version.id,
      source: "BANK",
      version: 1,
      fieldMap: {},
      status: "ACTIVE",
      effectiveFrom: "2026-01-01",
      ...recordDates,
    }, editor)).rejects.toMatchObject({ code: "IMMUTABLE_PROFILE_VERSION" });
    await expect(service.saveInheritanceNode({
      id: "inheritance-version",
      organizationId: "org-1",
      level: "PROFILE_VERSION",
      scopeId: version.id,
      values: { changed: true },
      status: "ACTIVE",
      effectiveFrom: "2026-01-01",
      ...recordDates,
    }, editor)).rejects.toMatchObject({ code: "IMMUTABLE_PROFILE_VERSION" });
  });

  it("torna versão publicada imutável e exige nova versão para alteração ou rollback", async () => {
    const { version } = await service.createProfile(profileInput(), editor);
    await publish(version.id);

    await expect(
      service.updateProfileVersionConfiguration("org-1", version.id, { changed: true }, editor),
    ).rejects.toMatchObject({ code: "IMMUTABLE_PROFILE_VERSION" });

    const next = await service.createNewProfileVersion(
      {
        id: "profile-version-2",
        organizationId: "org-1",
        profileId: "profile-1",
        sourceVersionId: version.id,
        effectiveFrom: "2027-01-01",
        configuration: { changed: true },
      },
      editor,
    );
    expect(next).toMatchObject({ version: 2, status: "draft", sourceVersionId: version.id });
  });

  it("bloqueia publicação sem simulação aprovada e sem snapshot gerado", async () => {
    const { version } = await service.createProfile(profileInput(), editor);
    await saveMappedAccount(version.id);
    await service.startProfileVersionValidation("org-1", version.id, editor);
    await service.validateProfileVersion("org-1", version.id, [], editor);
    await service.approveProfileVersion("org-1", version.id, approver);

    await expect(service.publishProfileVersion("org-1", version.id, approver))
      .rejects.toMatchObject({ code: "SIMULATION_APPROVAL_REQUIRED" });
    await repository.saveSimulation({
      id: "simulation-publish", organizationId: "org-1", profileVersionId: version.id,
      bankAccountId: "bank-account-1",
      status: "SUCCEEDED", result: {}, createdAt: fixedNow.toISOString(), createdBy: "actor-1",
      approvedAt: fixedNow.toISOString(), approvedBy: "actor-1",
    });
    await expect(service.publishProfileVersion("org-1", version.id, approver))
      .rejects.toMatchObject({ code: "SNAPSHOT_REQUIRED" });
  });

  it("seleciona a versão por vigência inclusiva no início e exclusiva no fim", async () => {
    const { version } = await service.createProfile(
      { ...profileInput(), effectiveTo: "2027-01-01" },
      editor,
    );
    await publish(version.id);
    const future = await service.createNewProfileVersion(
      {
        id: "profile-version-2",
        organizationId: "org-1",
        profileId: "profile-1",
        sourceVersionId: version.id,
        effectiveFrom: "2027-01-01",
        configuration: { nested: { enabled: false } },
      },
      editor,
    );
    await publish(future.id);

    expect((await service.findEffectiveProfileVersion("org-1", "profile-1", "2026-12-31"))?.id).toBe(version.id);
    expect((await service.findEffectiveProfileVersion("org-1", "profile-1", "2027-01-01"))?.id).toBe(future.id);
  });

  it("inativa conta com motivo sem alterar versões históricas", async () => {
    await service.registerBankAccount(bankAccountInput(), editor);
    const { version } = await service.createProfile(profileInput(), editor);
    await publish(version.id);

    const inactive = await service.inactivateBankAccount("org-1", "bank-account-1", "Conta encerrada", editor);
    const history = await repository.listProfileVersions("org-1", "profile-1");

    expect(inactive).toMatchObject({ status: "INACTIVE", inactivationReason: "Conta encerrada" });
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("published");
    expect(await service.findEffectiveBankAccount("org-1", "bank-account-1", "2026-08-11")).not.toBeNull();
    expect(await service.findEffectiveBankAccount("org-1", "bank-account-1", "2026-08-12")).toBeNull();
  });

  it("rejeita reprocessamento não autorizado e registra o autorizado", async () => {
    const { version } = await service.createProfile(profileInput(), editor);
    const simulation = await service.recordSimulation(
      {
        id: "simulation-1",
        organizationId: "org-1",
        profileVersionId: version.id,
        bankAccountId: "bank-account-1",
        status: "SUCCEEDED",
        result: { records: 10 },
      },
      editor,
    );

    await expect(
      service.reprocessSimulation(
        "org-1",
        simulation.id,
        { id: "simulation-2", status: "SUCCEEDED", result: { records: 12 } },
        editor,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const reprocessed = await service.reprocessSimulation(
      "org-1",
      simulation.id,
      { id: "simulation-2", status: "SUCCEEDED", result: { records: 12 } },
      admin,
    );
    expect(reprocessed.reprocessOfSimulationId).toBe(simulation.id);
    expect((await service.getHistory("org-1", "SIMULATION", reprocessed.id))[0]?.action).toBe("reprocess");
  });

  it("salva e retoma wizard draft com deep copy", async () => {
    const draft = await service.saveWizardDraft(
      { id: "draft-1", organizationId: "org-1", step: "accounts", data: { selected: ["bank-account-1"] } },
      editor,
    );
    (draft.data.selected as string[]).push("mutated");

    const resumed = await service.resumeWizardDraft("org-1", "draft-1", editor);
    expect(resumed).toMatchObject({ step: "accounts", data: { selected: ["bank-account-1"] } });
  });

  it("isola registros e chaves de duplicidade por organização", async () => {
    await seedOrganization(repository, "org-2");
    await service.registerBankAccount(bankAccountInput(), editor);
    const org2Editor = context("org-2", ["EDITOR"]);
    const account = await service.registerBankAccount(
      { ...bankAccountInput(), organizationId: "org-2" },
      org2Editor,
    );

    expect(account.id).toBe("bank-account-1");
    expect(await repository.findBankAccountById("org-1", account.id)).not.toBeNull();
    expect(await repository.findBankAccountById("org-2", account.id)).not.toBeNull();
    expect(await repository.findBankAccountById("org-3", account.id)).toBeNull();
  });

  it("registra auditoria administrativa completa e JSON-safe", async () => {
    await service.registerBankAccount(bankAccountInput(), editor);
    const [event] = await service.getHistory("org-1", "BANK_ACCOUNT", "bank-account-1");

    expect(event).toEqual({
      id: "generated-1",
      organizationId: "org-1",
      entityType: "BANK_ACCOUNT",
      entityId: "bank-account-1",
      action: "create",
      before: null,
      after: expect.objectContaining({ id: "bank-account-1", agency: "1234" }),
      actor: "actor-1",
      at: fixedNow.toISOString(),
      reason: "configuração de teste",
      correlationId: "correlation-1",
    });
    expect(() => JSON.stringify(event)).not.toThrow();
  });

  it.each(["approve", "publish"] as const)("faz rollback de %s quando auditoria falha", async (transition: "approve" | "publish") => {
    const failingRepository = new InMemoryConfigurationRepository();
    await seedOrganization(failingRepository, "org-1");
    const failingService = new ConfigurationService(failingRepository, () => fixedNow, () => "audit-failure");
    await failingRepository.saveProfile({
      id: "profile-1", organizationId: "org-1", legalEntityId: "entity-1", name: "Profile",
      status: "ACTIVE", createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString(),
    });
    await failingRepository.saveProfileVersion({
      id: "version-1", organizationId: "org-1", profileId: "profile-1", version: 1,
      status: transition === "approve" ? "ready" : "approved", configuration: {}, validationIssues: [],
      effectiveFrom: "2026-01-01", createdAt: fixedNow.toISOString(), createdBy: "actor-1",
      updatedAt: fixedNow.toISOString(),
      ...(transition === "publish" ? { approvedAt: fixedNow.toISOString(), approvedBy: "actor-1" } : {}),
    });
    if (transition === "publish") {
      await failingRepository.saveAccountMapping(mappingFor("version-1"));
      await failingRepository.saveSimulation({
        id: "simulation-1", organizationId: "org-1", profileVersionId: "version-1",
        bankAccountId: "bank-account-1", status: "SUCCEEDED", result: {}, createdAt: fixedNow.toISOString(),
        createdBy: "actor-1", approvedAt: fixedNow.toISOString(), approvedBy: "actor-1",
      });
      const snapshot = reconciliationSnapshotFixture();
      await failingRepository.savePublishedSnapshot({
        id: "snapshot-1", organizationId: "org-1", profileId: "profile-1", profileVersionId: "version-1",
        bankAccountId: "bank-account-1", requestedEffectiveAt: "2026-06-01", effectiveFrom: "2026-01-01",
        snapshot, configurationHash: snapshot.configurationHash, createdAt: fixedNow.toISOString(), createdBy: "actor-1",
      });
    }
    failingRepository.appendAuditEvent = async () => { throw new Error("audit unavailable"); };

    await expect(transition === "approve"
      ? failingService.approveProfileVersion("org-1", "version-1", approver)
      : failingService.publishProfileVersion("org-1", "version-1", approver)).rejects.toThrow("audit unavailable");
    expect((await failingRepository.findProfileVersionById("org-1", "version-1"))?.status)
      .toBe(transition === "approve" ? "ready" : "approved");
  });

  it("exige simulação e snapshot para cada conta bancária ativa mapeada", async () => {
    const { version } = await service.createProfile(profileInput(), editor);
    await repository.saveAccountMapping(mappingFor(version.id));
    await repository.saveAccountMapping({ ...mappingFor(version.id), id: "mapping-2", bankAccountId: "bank-account-2" });
    await service.startProfileVersionValidation("org-1", version.id, editor);
    await service.validateProfileVersion("org-1", version.id, [], editor);
    await service.approveProfileVersion("org-1", version.id, approver);
    await repository.saveSimulation({
      id: "simulation-1", organizationId: "org-1", profileVersionId: version.id,
      bankAccountId: "bank-account-1", status: "SUCCEEDED", result: {}, createdAt: fixedNow.toISOString(),
      createdBy: "actor-1", approvedAt: fixedNow.toISOString(), approvedBy: "actor-1",
    });

    await expect(service.publishProfileVersion("org-1", version.id, approver))
      .rejects.toMatchObject({ code: "SIMULATION_APPROVAL_REQUIRED" });
    await repository.saveSimulation({
      id: "simulation-2", organizationId: "org-1", profileVersionId: version.id,
      bankAccountId: "bank-account-2", status: "SUCCEEDED", result: {}, createdAt: fixedNow.toISOString(),
      createdBy: "actor-1", approvedAt: fixedNow.toISOString(), approvedBy: "actor-1",
    });
    const snapshot = reconciliationSnapshotFixture();
    await repository.savePublishedSnapshot({
      id: "snapshot-1", organizationId: "org-1", profileId: "profile-1", profileVersionId: version.id,
      bankAccountId: "bank-account-1", requestedEffectiveAt: "2026-06-01", effectiveFrom: "2026-01-01",
      snapshot, configurationHash: snapshot.configurationHash, createdAt: fixedNow.toISOString(), createdBy: "actor-1",
    });
    await expect(service.publishProfileVersion("org-1", version.id, approver))
      .rejects.toMatchObject({ code: "SNAPSHOT_REQUIRED" });
  });

  async function publish(versionId: string): Promise<void> {
    await saveMappedAccount(versionId);
    await service.startProfileVersionValidation("org-1", versionId, editor);
    await service.validateProfileVersion("org-1", versionId, [], editor);
    await service.approveProfileVersion("org-1", versionId, approver);
    await repository.saveSimulation({
      id: `simulation-${versionId}`,
      organizationId: "org-1",
      profileVersionId: versionId,
      bankAccountId: "bank-account-1",
      status: "SUCCEEDED",
      result: {},
      createdAt: fixedNow.toISOString(),
      createdBy: "actor-1",
      approvedAt: fixedNow.toISOString(),
      approvedBy: "actor-1",
    });
    const snapshot = reconciliationSnapshotFixture();
    await repository.savePublishedSnapshot({
      id: `snapshot-${versionId}`,
      organizationId: "org-1",
      profileId: "profile-1",
      profileVersionId: versionId,
      bankAccountId: "bank-account-1",
      requestedEffectiveAt: "2026-06-01",
      effectiveFrom: "2026-01-01",
      snapshot,
      configurationHash: snapshot.configurationHash,
      createdAt: fixedNow.toISOString(),
      createdBy: "actor-1",
    });
    await service.publishProfileVersion("org-1", versionId, approver);
  }

  async function saveMappedAccount(versionId: string): Promise<void> {
    await repository.saveAccountMapping(mappingFor(versionId));
  }
});

function mappingFor(profileVersionId: string) {
  return {
    id: `mapping-${profileVersionId}`,
    organizationId: "org-1",
    profileVersionId,
    bankAccountId: "bank-account-1",
    ledgerAccountId: "ledger-1",
    priority: 0,
    fallback: true,
    conditions: [],
    status: "ACTIVE" as const,
    effectiveFrom: "2026-01-01",
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  };
}

function context(organizationId: string, roles: ConfigurationCommandContext["actor"]["organizationRoles"][string]): ConfigurationCommandContext {
  return {
    actor: { actorId: "actor-1", organizationRoles: { [organizationId]: roles } },
    reason: "configuração de teste",
    correlationId: "correlation-1",
  };
}

async function seedOrganization(repository: InMemoryConfigurationRepository, organizationId: string): Promise<void> {
  const at = fixedNow.toISOString();
  const organization: Organization = {
    id: organizationId,
    name: `Organization ${organizationId}`,
    timezone: "America/Sao_Paulo",
    defaultCurrency: "BRL",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  };
  const legalEntity: LegalEntity = {
    id: "entity-1",
    organizationId,
    legalName: "Generic Legal Entity",
    taxId: "00000000000100",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  };
  const bank: Bank = {
    id: "bank-1",
    organizationId,
    directoryId: "directory-1",
    code: "000",
    name: "Generic Bank",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  };
  await repository.saveOrganization(organization);
  await repository.saveLegalEntity(legalEntity);
  await repository.saveBankDirectory({
    id: "directory-1",
    organizationId,
    name: "Bank Directory",
    status: "ACTIVE",
    createdAt: at,
    updatedAt: at,
  });
  await repository.saveBank(bank);
}

function bankAccountInput() {
  return {
    id: "bank-account-1",
    organizationId: "org-1",
    legalEntityId: "entity-1",
    bankId: "bank-1",
    agency: "001.234",
    account: "12.345-x",
    currency: "brl",
    accountType: "CHECKING" as const,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01",
  };
}

function profileInput() {
  return {
    id: "profile-1",
    versionId: "profile-version-1",
    organizationId: "org-1",
    legalEntityId: "entity-1",
    name: "Generic Profile",
    effectiveFrom: "2026-01-01",
    configuration: { nested: { enabled: true } },
  };
}
