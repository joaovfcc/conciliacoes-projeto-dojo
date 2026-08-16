import { randomUUID } from "node:crypto";

import type { ConfigurationRepository } from "./ConfigurationRepository.js";
import { EffectiveConfigurationResolver } from "./EffectiveConfigurationResolver.js";
import {
  ConfigurationError,
  assertEffectivePeriod,
  assertIsoDate,
  effectivePeriodsOverlap,
  isEffectiveAt,
  normalizeAccount,
  normalizeAgency,
  type AccountMapping,
  type AdministrativeAuditAction,
  type AdministrativeAuditEvent,
  type Bank,
  type BankDirectory,
  type ConfigBankAccount,
  type ConfigLedgerAccount,
  type ConfigurationCommandContext,
  type ConfigurationJsonObject,
  type ConfigurationJsonValue,
  type ConfigurationRole,
  type ImportMappingVersion,
  type InheritanceConfigurationNode,
  type InheritanceConfigurationOverride,
  type LegalEntity,
  type Organization,
  type ProfileVersion,
  type ProfileVersionStatus,
  type ReconciliationProfile,
  type Simulation,
  type WizardDraft,
} from "./models.js";

export interface CreateBankAccountInput {
  id: string;
  organizationId: string;
  legalEntityId: string;
  bankId: string;
  agency: string;
  account: string;
  currency: string;
  accountType: ConfigBankAccount["accountType"];
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface CreateProfileInput {
  id: string;
  versionId: string;
  organizationId: string;
  legalEntityId: string;
  name: string;
  description?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  configuration?: ConfigurationJsonObject;
}

export interface CloneProfileInput {
  profileId: string;
  versionId: string;
  sourceProfileId: string;
  sourceVersionId: string;
  organizationId: string;
  name: string;
  legalEntityId?: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface NewProfileVersionInput {
  id: string;
  organizationId: string;
  profileId: string;
  sourceVersionId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  configuration?: ConfigurationJsonObject;
}

export interface SaveWizardDraftInput {
  id: string;
  organizationId: string;
  profileId?: string;
  step: string;
  data: ConfigurationJsonObject;
}

export interface SimulateInput {
  id: string;
  organizationId: string;
  profileVersionId: string;
  bankAccountId: string;
  status: Simulation["status"];
  result: ConfigurationJsonObject;
}

export type CreateRecordInput<T extends { createdAt: string; updatedAt: string; status: "ACTIVE" | "INACTIVE" }> = Omit<
  T,
  "createdAt" | "updatedAt" | "status"
>;

export class ConfigurationService {
  public constructor(
    private readonly repository: ConfigurationRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) { }

  public async createOrganization(
    input: CreateRecordInput<Organization>,
    context: ConfigurationCommandContext,
  ): Promise<Organization> {
    this.authorize(context, input.id, ["ADMIN"]);
    if (await this.repository.findOrganizationById(input.id)) {
      throw new ConfigurationError("DUPLICATE_ORGANIZATION", "Organização já cadastrada.");
    }
    const value = this.activeRecord(input);
    await this.repository.saveOrganization(value);
    await this.audit("create", "ORGANIZATION", value.id, null, value, context, value.id);
    return structuredClone(value);
  }

  public async createLegalEntity(
    input: CreateRecordInput<LegalEntity>,
    context: ConfigurationCommandContext,
  ): Promise<LegalEntity> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    await this.requireOrganization(input.organizationId);
    if (await this.repository.findLegalEntityById(input.organizationId, input.id)) {
      throw new ConfigurationError("DUPLICATE_LEGAL_ENTITY", "Entidade legal já cadastrada.");
    }
    const value = this.activeRecord(input);
    await this.repository.saveLegalEntity(value);
    await this.audit("create", "LEGAL_ENTITY", value.id, null, value, context);
    return structuredClone(value);
  }

  public async createBankDirectory(
    input: CreateRecordInput<BankDirectory>,
    context: ConfigurationCommandContext,
  ): Promise<BankDirectory> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    await this.requireOrganization(input.organizationId);
    if (await this.repository.findBankDirectoryById(input.organizationId, input.id)) {
      throw new ConfigurationError("DUPLICATE_BANK_DIRECTORY", "Diretório bancário já cadastrado.");
    }
    const value = this.activeRecord(input);
    await this.repository.saveBankDirectory(value);
    await this.audit("create", "BANK_DIRECTORY", value.id, null, value, context);
    return structuredClone(value);
  }

  public async createBank(input: CreateRecordInput<Bank>, context: ConfigurationCommandContext): Promise<Bank> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    if (!await this.repository.findBankDirectoryById(input.organizationId, input.directoryId)) {
      throw new ConfigurationError("NOT_FOUND", "Diretório bancário não encontrado na organização.");
    }
    if (await this.repository.findBankById(input.organizationId, input.id)) {
      throw new ConfigurationError("DUPLICATE_BANK", "Banco já cadastrado.");
    }
    const value = this.activeRecord(input);
    await this.repository.saveBank(value);
    await this.audit("create", "BANK", value.id, null, value, context);
    return structuredClone(value);
  }

  public async createLedgerAccount(
    input: CreateRecordInput<ConfigLedgerAccount>,
    context: ConfigurationCommandContext,
  ): Promise<ConfigLedgerAccount> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    assertEffectivePeriod(input);
    await this.assertReference(input.organizationId, input.legalEntityId, "LEGAL_ENTITY");
    if (await this.repository.findLedgerAccountById(input.organizationId, input.id)) {
      throw new ConfigurationError("DUPLICATE_LEDGER_ACCOUNT", "Conta contábil já cadastrada.");
    }
    const value = this.activeRecord({ ...input, currency: input.currency.toUpperCase() });
    await this.repository.saveLedgerAccount(value);
    await this.audit("create", "LEDGER_ACCOUNT", value.id, null, value, context);
    return structuredClone(value);
  }

  public async registerBankAccount(
    input: CreateBankAccountInput,
    context: ConfigurationCommandContext,
  ): Promise<ConfigBankAccount> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    this.assertContext(context);
    assertEffectivePeriod(input);
    await this.assertReference(input.organizationId, input.legalEntityId, "LEGAL_ENTITY");
    await this.assertReference(input.organizationId, input.bankId, "BANK");
    if (await this.repository.findBankAccountById(input.organizationId, input.id)) {
      throw new ConfigurationError("DUPLICATE_ID", "Identificador de conta bancária já cadastrado.");
    }

    const agency = normalizeAgency(input.agency);
    const account = normalizeAccount(input.account);
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ConfigurationError("INVALID_CURRENCY", "Moeda deve usar código ISO de três letras.");
    }
    const duplicate = (await this.repository.listBankAccounts(input.organizationId)).find(
      (candidate) =>
        candidate.legalEntityId === input.legalEntityId
        && candidate.bankId === input.bankId
        && candidate.agency === agency
        && candidate.account === account
        && candidate.currency === currency
        && effectivePeriodsOverlap(candidate, input),
    );
    if (duplicate) {
      throw new ConfigurationError("DUPLICATE_BANK_ACCOUNT", "Conta bancária duplicada para a vigência informada.");
    }

    const at = this.at();
    const value: ConfigBankAccount = {
      ...input,
      agency,
      account,
      currency,
      status: "ACTIVE",
      createdAt: at,
      updatedAt: at,
    };
    await this.repository.saveBankAccount(value);
    await this.audit("create", "BANK_ACCOUNT", value.id, null, value, context);
    return structuredClone(value);
  }

  public async findEffectiveBankAccount(
    organizationId: string,
    bankAccountId: string,
    at: string,
  ): Promise<ConfigBankAccount | null> {
    assertIsoDate(at, "at");
    const account = await this.repository.findBankAccountById(organizationId, bankAccountId);
    if (!account || !isEffectiveAt(account, at)) return null;
    if (account.status === "ACTIVE") return account;
    return account.inactivatedAt && at < account.inactivatedAt.slice(0, 10) ? account : null;
  }

  public async createProfile(
    input: CreateProfileInput,
    context: ConfigurationCommandContext,
  ): Promise<{ profile: ReconciliationProfile; version: ProfileVersion }> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    this.assertContext(context);
    assertEffectivePeriod(input);
    await this.assertReference(input.organizationId, input.legalEntityId, "LEGAL_ENTITY");
    if (await this.repository.findProfileById(input.organizationId, input.id)) {
      throw new ConfigurationError("DUPLICATE_PROFILE", "Perfil já cadastrado.");
    }
    if (await this.repository.findProfileVersionById(input.organizationId, input.versionId)) {
      throw new ConfigurationError("DUPLICATE_PROFILE_VERSION", "Identificador de versão já cadastrado.");
    }

    const at = this.at();
    const profile: ReconciliationProfile = {
      id: input.id,
      organizationId: input.organizationId,
      legalEntityId: input.legalEntityId,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      status: "ACTIVE",
      createdAt: at,
      updatedAt: at,
    };
    const version = this.buildVersion({
      id: input.versionId,
      organizationId: input.organizationId,
      profileId: input.id,
      version: 1,
      effectiveFrom: input.effectiveFrom,
      ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
      configuration: input.configuration ?? {},
      actorId: context.actor.actorId,
    });
    await this.inTransaction(async (repository) => {
      await repository.saveProfile(profile);
      await repository.saveProfileVersion(version);
      await this.audit("create", "PROFILE", profile.id, null, { profile, version }, context, undefined, repository);
    });
    return structuredClone({ profile, version });
  }

  public async cloneProfile(
    input: CloneProfileInput,
    context: ConfigurationCommandContext,
  ): Promise<{ profile: ReconciliationProfile; version: ProfileVersion }> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    const sourceProfile = await this.requireProfile(input.organizationId, input.sourceProfileId);
    const sourceVersion = await this.requireVersion(input.organizationId, input.sourceVersionId);
    if (sourceVersion.profileId !== sourceProfile.id) {
      throw new ConfigurationError("PROFILE_VERSION_MISMATCH", "Versão de origem não pertence ao perfil informado.");
    }
    const created = await this.createProfile(
      {
        id: input.profileId,
        versionId: input.versionId,
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId ?? sourceProfile.legalEntityId,
        name: input.name,
        ...(sourceProfile.description === undefined ? {} : { description: sourceProfile.description }),
        effectiveFrom: input.effectiveFrom,
        ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
        configuration: structuredClone(sourceVersion.configuration),
      },
      context,
    );
    const clonedVersion = { ...created.version, sourceVersionId: sourceVersion.id };
    await this.repository.saveProfileVersion(clonedVersion);
    await this.audit("edit", "PROFILE_VERSION", clonedVersion.id, created.version, clonedVersion, context);

    const sourceMappings = await this.repository.listAccountMappings(input.organizationId, sourceVersion.id);
    for (const mapping of sourceMappings) {
      const clonedMapping: AccountMapping = {
        ...mapping,
        id: this.newId(),
        profileVersionId: clonedVersion.id,
        effectiveFrom: input.effectiveFrom,
        createdAt: this.at(),
        updatedAt: this.at(),
      };
      if (input.effectiveTo === undefined) delete clonedMapping.effectiveTo;
      else clonedMapping.effectiveTo = input.effectiveTo;
      await this.repository.saveAccountMapping(clonedMapping);
    }
    const sourceImportMappings = await this.repository.listImportMappingVersions(input.organizationId, sourceVersion.id);
    for (const mapping of sourceImportMappings) {
      const clonedMapping: ImportMappingVersion = {
        ...mapping,
        id: this.newId(),
        profileVersionId: clonedVersion.id,
        effectiveFrom: input.effectiveFrom,
        createdAt: this.at(),
        updatedAt: this.at(),
      };
      if (input.effectiveTo === undefined) delete clonedMapping.effectiveTo;
      else clonedMapping.effectiveTo = input.effectiveTo;
      await this.repository.saveImportMappingVersion(clonedMapping);
    }
    return structuredClone({ profile: created.profile, version: clonedVersion });
  }

  public async createNewProfileVersion(
    input: NewProfileVersionInput,
    context: ConfigurationCommandContext,
  ): Promise<ProfileVersion> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    this.assertContext(context);
    assertEffectivePeriod(input);
    await this.requireProfile(input.organizationId, input.profileId);
    const source = await this.requireVersion(input.organizationId, input.sourceVersionId);
    if (source.profileId !== input.profileId) {
      throw new ConfigurationError("PROFILE_VERSION_MISMATCH", "Versão de origem não pertence ao perfil informado.");
    }
    if (await this.repository.findProfileVersionById(input.organizationId, input.id)) {
      throw new ConfigurationError("DUPLICATE_PROFILE_VERSION", "Identificador de versão já cadastrado.");
    }
    const versions = await this.repository.listProfileVersions(input.organizationId, input.profileId);
    const value = this.buildVersion({
      id: input.id,
      organizationId: input.organizationId,
      profileId: input.profileId,
      version: Math.max(0, ...versions.map((version) => version.version)) + 1,
      effectiveFrom: input.effectiveFrom,
      ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
      configuration: structuredClone(input.configuration ?? source.configuration),
      sourceVersionId: source.id,
      actorId: context.actor.actorId,
    });
    await this.repository.saveProfileVersion(value);
    await this.audit("edit", "PROFILE_VERSION", value.id, source, value, context);
    return structuredClone(value);
  }

  public async updateProfileVersionConfiguration(
    organizationId: string,
    versionId: string,
    configuration: ConfigurationJsonObject,
    context: ConfigurationCommandContext,
  ): Promise<ProfileVersion> {
    this.authorize(context, organizationId, ["EDITOR", "ADMIN"]);
    this.assertContext(context);
    const version = await this.requireVersion(organizationId, versionId);
    this.assertMutable(version);
    const updated = {
      ...version,
      configuration: structuredClone(configuration),
      validationIssues: [],
      updatedAt: this.at(),
    };
    await this.repository.saveProfileVersion(updated);
    await this.audit("edit", "PROFILE_VERSION", version.id, version, updated, context);
    return structuredClone(updated);
  }

  public async validateProfileVersion(
    organizationId: string,
    versionId: string,
    issues: readonly string[],
    context: ConfigurationCommandContext,
  ): Promise<ProfileVersion> {
    this.authorize(context, organizationId, ["EDITOR", "ADMIN"]);
    const version = await this.requireVersion(organizationId, versionId);
    this.assertStatus(version, ["validating"]);
    const updated: ProfileVersion = {
      ...version,
      status: issues.length === 0 ? "ready" : "validating",
      validationIssues: [...issues],
      updatedAt: this.at(),
    };
    await this.persistAudited("validate", "PROFILE_VERSION", version, updated, context);
    return structuredClone(updated);
  }

  public async startProfileVersionValidation(
    organizationId: string,
    versionId: string,
    context: ConfigurationCommandContext,
  ): Promise<ProfileVersion> {
    this.authorize(context, organizationId, ["EDITOR", "ADMIN"]);
    const version = await this.requireVersion(organizationId, versionId);
    this.assertStatus(version, ["draft"]);
    const updated: ProfileVersion = { ...version, status: "validating", updatedAt: this.at() };
    await this.persistAudited("validate", "PROFILE_VERSION", version, updated, context);
    return structuredClone(updated);
  }

  public async approveProfileVersion(
    organizationId: string,
    versionId: string,
    context: ConfigurationCommandContext,
  ): Promise<ProfileVersion> {
    this.authorize(context, organizationId, ["APPROVER", "ADMIN"]);
    const version = await this.requireVersion(organizationId, versionId);
    this.assertStatus(version, ["ready"]);
    const at = this.at();
    const updated: ProfileVersion = {
      ...version,
      status: "approved",
      approvedAt: at,
      approvedBy: context.actor.actorId,
      updatedAt: at,
    };
    await this.persistAudited("approve", "PROFILE_VERSION", version, updated, context);
    return structuredClone(updated);
  }

  public async publishProfileVersion(
    organizationId: string,
    versionId: string,
    context: ConfigurationCommandContext,
  ): Promise<ProfileVersion> {
    this.authorize(context, organizationId, ["APPROVER", "ADMIN"]);
    const version = await this.requireVersion(organizationId, versionId);
    this.assertStatus(version, ["approved"]);
    if (version.validationIssues.length > 0) {
      throw new ConfigurationError("VALIDATION_BLOCKERS", "Versão possui bloqueios de validação.");
    }
    const mappedBankAccountIds = [...new Set(
      (await this.repository.listAccountMappings(organizationId, version.id))
        .filter((mapping) => mapping.status === "ACTIVE")
        .map((mapping) => mapping.bankAccountId),
    )].sort();
    if (mappedBankAccountIds.length === 0) {
      throw new ConfigurationError("SNAPSHOT_REQUIRED", "Publicação exige ao menos uma conta bancária ativa mapeada.");
    }
    const simulations = await this.repository.listSimulations(organizationId, version.id);
    const approvedSimulationAccounts = new Set(simulations
      .filter((simulation) => simulation.status === "SUCCEEDED" && simulation.approvedAt && simulation.approvedBy)
      .map((simulation) => simulation.bankAccountId));
    if (mappedBankAccountIds.some((bankAccountId) => !approvedSimulationAccounts.has(bankAccountId))) {
      throw new ConfigurationError(
        "SIMULATION_APPROVAL_REQUIRED",
        "Publicação exige simulação concluída e aprovada para cada conta bancária mapeada.",
      );
    }
    const snapshots = this.repository.listPublishedSnapshots
      ? await this.repository.listPublishedSnapshots(organizationId, version.id)
      : [];
    const snapshotAccountIds = [...new Set(snapshots.map((snapshot) => snapshot.bankAccountId))].sort();
    if (JSON.stringify(snapshotAccountIds) !== JSON.stringify(mappedBankAccountIds)) {
      throw new ConfigurationError("SNAPSHOT_REQUIRED", "Publicação exige exatamente um conjunto completo de contas em snapshots.");
    }
    const versions = await this.repository.listProfileVersions(organizationId, version.profileId);
    for (const current of versions.filter(
      (candidate) => ["published", "superseded"].includes(candidate.status) && candidate.id !== version.id,
    )) {
      if (effectivePeriodsOverlap(current, version)) {
        throw new ConfigurationError("PROFILE_VERSION_OVERLAP", "Versões publicadas não podem ter vigências sobrepostas.");
      }
    }
    const at = this.at();
    const updated: ProfileVersion = {
      ...version,
      status: "published",
      publishedAt: at,
      publishedBy: context.actor.actorId,
      updatedAt: at,
    };
    await this.persistAudited("publish", "PROFILE_VERSION", version, updated, context);
    return structuredClone(updated);
  }

  public async inactivateProfileVersion(
    organizationId: string,
    versionId: string,
    context: ConfigurationCommandContext,
  ): Promise<ProfileVersion> {
    this.authorize(context, organizationId, ["APPROVER", "ADMIN"]);
    const version = await this.requireVersion(organizationId, versionId);
    this.assertStatus(version, ["published", "superseded"]);
    const updated: ProfileVersion = { ...version, status: "inactive", updatedAt: this.at() };
    await this.persistAudited("inactivate", "PROFILE_VERSION", version, updated, context);
    return structuredClone(updated);
  }

  public async findEffectiveProfileVersion(
    organizationId: string,
    profileId: string,
    date: string,
  ): Promise<ProfileVersion | null> {
    assertIsoDate(date, "date");
    const candidates = (await this.repository.listProfileVersions(organizationId, profileId))
      .filter((version) => ["published", "superseded"].includes(version.status) && isEffectiveAt(version, date))
      .sort((left, right) => right.version - left.version);
    return candidates[0] ?? null;
  }

  public async inactivateBankAccount(
    organizationId: string,
    bankAccountId: string,
    reason: string,
    context: ConfigurationCommandContext,
  ): Promise<ConfigBankAccount> {
    this.authorize(context, organizationId, ["EDITOR", "ADMIN"]);
    if (!reason.trim()) throw new ConfigurationError("REASON_REQUIRED", "Motivo de inativação é obrigatório.");
    const account = await this.repository.findBankAccountById(organizationId, bankAccountId);
    if (!account) throw new ConfigurationError("NOT_FOUND", "Conta bancária não encontrada.");
    const at = this.at();
    const updated: ConfigBankAccount = {
      ...account,
      status: "INACTIVE",
      inactivationReason: reason,
      inactivatedAt: at,
      updatedAt: at,
    };
    await this.inTransaction(async (repository) => {
      await repository.saveBankAccount(updated);
      await this.audit("inactivate", "BANK_ACCOUNT", account.id, account, updated, { ...context, reason }, undefined, repository);
    });
    return structuredClone(updated);
  }

  public async saveWizardDraft(
    input: SaveWizardDraftInput,
    context: ConfigurationCommandContext,
  ): Promise<WizardDraft> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    const existing = await this.repository.findWizardDraftById(input.organizationId, input.id);
    if (existing && existing.actorId !== context.actor.actorId) {
      throw new ConfigurationError("FORBIDDEN", "Rascunho pertence a outro ator.");
    }
    const at = this.at();
    const value: WizardDraft = {
      id: input.id,
      organizationId: input.organizationId,
      actorId: context.actor.actorId,
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
      step: input.step,
      data: structuredClone(input.data),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await this.repository.saveWizardDraft(value);
    await this.audit(existing ? "edit" : "create", "WIZARD_DRAFT", value.id, existing, value, context);
    return structuredClone(value);
  }

  public async resumeWizardDraft(
    organizationId: string,
    draftId: string,
    context: ConfigurationCommandContext,
  ): Promise<WizardDraft | null> {
    this.authorize(context, organizationId, ["EDITOR", "ADMIN"]);
    const draft = await this.repository.findWizardDraftById(organizationId, draftId);
    if (draft && draft.actorId !== context.actor.actorId && !this.hasRole(context, organizationId, "ADMIN")) {
      throw new ConfigurationError("FORBIDDEN", "Rascunho pertence a outro ator.");
    }
    return draft;
  }

  public async recordSimulation(
    input: SimulateInput,
    context: ConfigurationCommandContext,
  ): Promise<Simulation> {
    this.authorize(context, input.organizationId, ["EDITOR", "ADMIN"]);
    await this.requireVersion(input.organizationId, input.profileVersionId);
    const value: Simulation = {
      ...input,
      result: structuredClone(input.result),
      createdAt: this.at(),
      createdBy: context.actor.actorId,
    };
    await this.repository.saveSimulation(value);
    await this.audit("simulate", "SIMULATION", value.id, null, value, context);
    return structuredClone(value);
  }

  public async approveSimulation(
    organizationId: string,
    simulationId: string,
    context: ConfigurationCommandContext,
  ): Promise<Simulation> {
    this.authorize(context, organizationId, ["APPROVER", "ADMIN"]);
    const simulation = await this.repository.findSimulationById(organizationId, simulationId);
    if (!simulation) throw new ConfigurationError("NOT_FOUND", "Simulação não encontrada.");
    if (simulation.status !== "SUCCEEDED") {
      throw new ConfigurationError("SIMULATION_NOT_SUCCESSFUL", "Somente simulação concluída pode ser aprovada.");
    }
    const updated: Simulation = {
      ...simulation,
      approvedAt: this.at(),
      approvedBy: context.actor.actorId,
    };
    await this.inTransaction(async (repository) => {
      await repository.saveSimulation(updated);
      await this.audit("approve", "SIMULATION", updated.id, simulation, updated, context, undefined, repository);
    });
    return structuredClone(updated);
  }

  public async reprocessSimulation(
    organizationId: string,
    simulationId: string,
    replacement: Omit<SimulateInput, "organizationId" | "profileVersionId" | "bankAccountId">,
    context: ConfigurationCommandContext,
  ): Promise<Simulation> {
    this.authorize(context, organizationId, ["ADMIN"]);
    const source = await this.repository.findSimulationById(organizationId, simulationId);
    if (!source) throw new ConfigurationError("NOT_FOUND", "Simulação não encontrada.");
    const value: Simulation = {
      id: replacement.id,
      organizationId,
      profileVersionId: source.profileVersionId,
      bankAccountId: source.bankAccountId,
      status: replacement.status,
      result: structuredClone(replacement.result),
      reprocessOfSimulationId: source.id,
      createdAt: this.at(),
      createdBy: context.actor.actorId,
    };
    await this.repository.saveSimulation(value);
    await this.audit("reprocess", "SIMULATION", value.id, source, value, context);
    return structuredClone(value);
  }

  public async getHistory(
    organizationId: string,
    entityType?: string,
    entityId?: string,
  ): Promise<AdministrativeAuditEvent[]> {
    return this.repository.listAuditEvents(organizationId, entityType, entityId);
  }

  public async saveAccountMapping(mapping: AccountMapping, context: ConfigurationCommandContext): Promise<void> {
    this.authorize(context, mapping.organizationId, ["EDITOR", "ADMIN"]);
    assertEffectivePeriod(mapping);
    const version = await this.requireVersion(mapping.organizationId, mapping.profileVersionId);
    this.assertMutable(version);
    const existing = await this.repository.findAccountMappingById(mapping.organizationId, mapping.id);
    if (existing && existing.profileVersionId !== mapping.profileVersionId) {
      throw new ConfigurationError("DUPLICATE_ACCOUNT_MAPPING", "Identificador de mapeamento já cadastrado.");
    }
    if (!Number.isInteger(mapping.priority) || (mapping.priority ?? -1) < 0) {
      throw new ConfigurationError("INVALID_ROUTING_PRIORITY", "Prioridade deve ser um inteiro não negativo.");
    }
    if (mapping.fallback && (mapping.conditions?.length ?? 0) > 0) {
      throw new ConfigurationError("INVALID_ROUTING_FALLBACK", "Fallback não pode possuir condições.");
    }
    if (!mapping.fallback && (mapping.conditions?.length ?? 0) === 0) {
      throw new ConfigurationError("INVALID_ROUTING_CONDITIONS", "Roteamento sem fallback exige condições.");
    }
    const bank = await this.repository.findBankAccountById(mapping.organizationId, mapping.bankAccountId);
    const ledger = await this.repository.findLedgerAccountById(mapping.organizationId, mapping.ledgerAccountId);
    if (!bank || !ledger) throw new ConfigurationError("NOT_FOUND", "Conta bancária ou contábil não encontrada.");
    if (bank.legalEntityId !== ledger.legalEntityId || bank.currency !== ledger.currency) {
      throw new ConfigurationError("ACCOUNT_MAPPING_MISMATCH", "Contas mapeadas devem possuir entidade e moeda iguais.");
    }
    const currentMappings = await this.repository.listAccountMappings(mapping.organizationId, mapping.profileVersionId);
    const conflict = currentMappings.find((candidate) => candidate.id !== mapping.id
      && candidate.bankAccountId === mapping.bankAccountId
      && candidate.status === "ACTIVE" && mapping.status === "ACTIVE"
      && effectivePeriodsOverlap(candidate, mapping)
      && (candidate.fallback && mapping.fallback
        || candidate.priority === mapping.priority && candidate.ledgerAccountId !== mapping.ledgerAccountId));
    if (conflict) throw new ConfigurationError("ACCOUNT_MAPPING_OVERLAP", "Mapeamentos incompatíveis possuem vigência sobreposta.");
    const invalidated = { ...version, validationIssues: [], updatedAt: this.at() };
    await this.inTransaction(async (repository) => {
      await repository.saveAccountMapping(mapping);
      await repository.saveProfileVersion(invalidated);
      await this.audit(
        "edit", "PROFILE_VERSION", version.id, version, { ...invalidated, accountMapping: mapping }, context,
        undefined, repository,
      );
    });
  }

  public async saveImportMappingVersion(
    mapping: ImportMappingVersion,
    context: ConfigurationCommandContext,
  ): Promise<void> {
    this.authorize(context, mapping.organizationId, ["EDITOR", "ADMIN"]);
    if (mapping.publishedAt !== undefined || mapping.publishedBy !== undefined) {
      throw new ConfigurationError("FORGED_PUBLICATION_METADATA", "Metadados de publicação são definidos pelo servidor.");
    }
    assertEffectivePeriod(mapping);
    const version = await this.requireVersion(mapping.organizationId, mapping.profileVersionId);
    this.assertMutable(version);
    const existing = await this.repository.findImportMappingVersionById(mapping.organizationId, mapping.id);
    if (existing && existing.profileVersionId !== mapping.profileVersionId) {
      throw new ConfigurationError("DUPLICATE_IMPORT_MAPPING", "Identificador de mapeamento já cadastrado.");
    }
    if (existing?.publishedAt || existing?.publishedBy) {
      throw new ConfigurationError("IMMUTABLE_IMPORT_MAPPING", "Mapeamento publicado não pode ser alterado.");
    }
    const invalidated = { ...version, validationIssues: [], updatedAt: this.at() };
    await this.inTransaction(async (repository) => {
      await repository.saveImportMappingVersion(structuredClone(mapping));
      await repository.saveProfileVersion(invalidated);
      await this.audit(
        "edit", "PROFILE_VERSION", version.id, version, { ...invalidated, importMapping: mapping }, context,
        undefined, repository,
      );
    });
  }

  public async publishImportMappingVersion(
    organizationId: string,
    mappingId: string,
    profileVersionId: string,
    context: ConfigurationCommandContext,
  ): Promise<ImportMappingVersion> {
    this.authorize(context, organizationId, ["APPROVER", "ADMIN"]);
    const mapping = await this.repository.findImportMappingVersionById(organizationId, mappingId);
    if (!mapping) throw new ConfigurationError("NOT_FOUND", "Mapeamento de importação não encontrado.");
    if (mapping.profileVersionId !== profileVersionId) {
      throw new ConfigurationError("PROFILE_VERSION_MISMATCH", "Mapeamento não pertence à versão informada.");
    }
    const version = await this.requireVersion(organizationId, profileVersionId);
    this.assertMutable(version);
    if (mapping.status !== "ACTIVE") {
      throw new ConfigurationError("INVALID_IMPORT_MAPPING_STATUS", "Somente mapeamento ativo pode ser publicado.");
    }
    if (mapping.publishedAt || mapping.publishedBy) return mapping;
    const at = this.at();
    const published: ImportMappingVersion = {
      ...mapping,
      publishedAt: at,
      publishedBy: context.actor.actorId,
      updatedAt: at,
    };
    await this.inTransaction(async (repository) => {
      await repository.saveImportMappingVersion(published);
      await this.audit("publish", "IMPORT_MAPPING", mapping.id, mapping, published, context, undefined, repository);
    });
    return structuredClone(published);
  }

  public async saveInheritanceNode(
    node: InheritanceConfigurationNode,
    context: ConfigurationCommandContext,
  ): Promise<void> {
    this.authorize(context, node.organizationId, ["EDITOR", "ADMIN"]);
    assertEffectivePeriod(node);
    await this.assertInheritanceMutable(node.organizationId, node.id, node);
    if (node.parentNodeId) {
      const parent = await this.repository.findInheritanceNodeById(node.organizationId, node.parentNodeId);
      if (!parent) throw new ConfigurationError("NOT_FOUND", "Nó pai de herança não encontrado na organização.");
      const visited = new Set([node.id]);
      let current: InheritanceConfigurationNode | null = parent;
      while (current) {
        if (visited.has(current.id)) throw new ConfigurationError("INHERITANCE_CYCLE", "Ciclo na configuração herdada.");
        visited.add(current.id);
        current = current.parentNodeId
          ? await this.repository.findInheritanceNodeById(node.organizationId, current.parentNodeId)
          : null;
      }
    }
    await this.repository.saveInheritanceNode(structuredClone(node));
    await this.audit("edit", "INHERITANCE_NODE", node.id, null, node, context);
  }

  public async saveInheritanceOverride(
    override: InheritanceConfigurationOverride,
    context: ConfigurationCommandContext,
  ): Promise<void> {
    this.authorize(context, override.organizationId, ["EDITOR", "ADMIN"]);
    if (!await this.repository.findInheritanceNodeById(override.organizationId, override.nodeId)) {
      throw new ConfigurationError("NOT_FOUND", "Nó de herança não encontrado na organização.");
    }
    await this.assertInheritanceMutable(override.organizationId, override.nodeId);
    await this.repository.saveInheritanceOverride(structuredClone(override));
    await this.audit("edit", "INHERITANCE_OVERRIDE", override.id, null, override, context);
  }

  public async resolveInheritedConfiguration(
    organizationId: string,
    nodeId: string,
    date: string,
  ): Promise<ConfigurationJsonObject> {
    return (await new EffectiveConfigurationResolver(this.repository).resolveNode(organizationId, nodeId, date)).values;
  }

  private buildVersion(input: {
    id: string;
    organizationId: string;
    profileId: string;
    version: number;
    effectiveFrom: string;
    effectiveTo?: string;
    configuration: ConfigurationJsonObject;
    sourceVersionId?: string;
    actorId: string;
  }): ProfileVersion {
    const at = this.at();
    return {
      id: input.id,
      organizationId: input.organizationId,
      profileId: input.profileId,
      version: input.version,
      status: "draft",
      configuration: structuredClone(input.configuration),
      ...(input.sourceVersionId === undefined ? {} : { sourceVersionId: input.sourceVersionId }),
      validationIssues: [],
      effectiveFrom: input.effectiveFrom,
      ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
      createdAt: at,
      createdBy: input.actorId,
      updatedAt: at,
    };
  }

  private async requireProfile(organizationId: string, profileId: string): Promise<ReconciliationProfile> {
    const profile = await this.repository.findProfileById(organizationId, profileId);
    if (!profile) throw new ConfigurationError("NOT_FOUND", "Perfil não encontrado.");
    return profile;
  }

  private async requireOrganization(organizationId: string): Promise<Organization> {
    const organization = await this.repository.findOrganizationById(organizationId);
    if (!organization) throw new ConfigurationError("NOT_FOUND", "Organização não encontrada.");
    return organization;
  }

  private async requireVersion(organizationId: string, versionId: string): Promise<ProfileVersion> {
    const version = await this.repository.findProfileVersionById(organizationId, versionId);
    if (!version) throw new ConfigurationError("NOT_FOUND", "Versão de perfil não encontrada.");
    return version;
  }

  private assertMutable(version: ProfileVersion): void {
    if (!["draft", "validating"].includes(version.status)) {
      throw new ConfigurationError(
        "IMMUTABLE_PROFILE_VERSION",
        "Somente versões em rascunho ou validação podem ser editadas; crie uma nova versão.",
      );
    }
  }

  private async assertInheritanceMutable(
    organizationId: string,
    nodeId: string,
    pendingNode?: InheritanceConfigurationNode,
  ): Promise<void> {
    const persistedNodes = await this.repository.listInheritanceNodes(organizationId);
    const nodes = pendingNode
      ? [...persistedNodes.filter((node) => node.id !== pendingNode.id), pendingNode]
      : persistedNodes;
    const affectedNodeIds = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (node.parentNodeId && affectedNodeIds.has(node.parentNodeId) && !affectedNodeIds.has(node.id)) {
          affectedNodeIds.add(node.id);
          changed = true;
        }
      }
    }
    const profiles = await this.repository.listProfiles(organizationId);
    const affectedVersionIds = new Set<string>();
    const affectedProfileIds = new Set<string>();
    let affectsOrganization = false;
    for (const node of nodes.filter((candidate) => affectedNodeIds.has(candidate.id))) {
      const level = node.hierarchyLevel ?? (node.level === "ORGANIZATION" ? "GLOBAL" : node.level);
      if (level === "PROFILE_VERSION") affectedVersionIds.add(node.scopeId);
      else if (level === "PROFILE") affectedProfileIds.add(node.scopeId);
      else if (level === "LEGAL_ENTITY") {
        for (const profile of profiles.filter((candidate) => candidate.legalEntityId === node.scopeId)) {
          affectedProfileIds.add(profile.id);
        }
      } else affectsOrganization = true;
    }
    for (const profile of profiles) {
      if (!affectsOrganization && !affectedProfileIds.has(profile.id)) continue;
      for (const version of await this.repository.listProfileVersions(organizationId, profile.id)) {
        affectedVersionIds.add(version.id);
      }
    }
    for (const versionId of affectedVersionIds) {
      const version = await this.repository.findProfileVersionById(organizationId, versionId);
      if (version) this.assertMutable(version);
    }
  }

  private assertStatus(version: ProfileVersion, accepted: readonly ProfileVersionStatus[]): void {
    if (!accepted.includes(version.status)) {
      throw new ConfigurationError("INVALID_LIFECYCLE_TRANSITION", `Estado ${version.status} não permite esta transição.`);
    }
  }

  private async assertReference(organizationId: string, id: string, type: string): Promise<void> {
    const found = type === "LEGAL_ENTITY"
      ? await this.repository.findLegalEntityById(organizationId, id)
      : type === "BANK"
        ? await this.repository.findBankById(organizationId, id)
        : type === "BANK_ACCOUNT"
          ? await this.repository.findBankAccountById(organizationId, id)
          : await this.repository.findLedgerAccountById(organizationId, id);
    if (!found) throw new ConfigurationError("NOT_FOUND", `${type} não encontrado na organização.`);
  }

  private authorize(
    context: ConfigurationCommandContext,
    organizationId: string,
    accepted: readonly ConfigurationRole[],
  ): void {
    this.assertContext(context);
    if (!accepted.some((role) => this.hasRole(context, organizationId, role))) {
      throw new ConfigurationError("FORBIDDEN", "Ator não autorizado para esta operação.");
    }
  }

  private hasRole(context: ConfigurationCommandContext, organizationId: string, role: ConfigurationRole): boolean {
    return (context.actor.organizationRoles[organizationId] ?? []).includes(role);
  }

  private assertContext(context: ConfigurationCommandContext): void {
    if (!context.reason.trim()) throw new ConfigurationError("REASON_REQUIRED", "Motivo é obrigatório.");
    if (!context.correlationId.trim()) {
      throw new ConfigurationError("CORRELATION_ID_REQUIRED", "correlationId é obrigatório.");
    }
  }

  private async audit(
    action: AdministrativeAuditAction,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    context: ConfigurationCommandContext,
    explicitOrganizationId?: string,
    repository: ConfigurationRepository = this.repository,
  ): Promise<void> {
    this.assertContext(context);
    const organizationId = explicitOrganizationId ?? this.organizationIdOf(after) ?? this.organizationIdOf(before);
    if (!organizationId) throw new ConfigurationError("ORGANIZATION_REQUIRED", "Evento auditado exige organização.");
    await repository.appendAuditEvent({
      id: this.newId(),
      organizationId,
      entityType,
      entityId,
      action,
      before: toJsonSafe(before),
      after: toJsonSafe(after),
      actor: context.actor.actorId,
      at: this.at(),
      reason: context.reason,
      correlationId: context.correlationId,
    });
  }

  private organizationIdOf(value: unknown): string | undefined {
    if (value && typeof value === "object" && "organizationId" in value) {
      const organizationId = (value as { organizationId?: unknown }).organizationId;
      return typeof organizationId === "string" ? organizationId : undefined;
    }
    if (value && typeof value === "object" && "profile" in value) {
      return this.organizationIdOf((value as { profile: unknown }).profile);
    }
    return undefined;
  }

  private at(): string {
    return this.now().toISOString();
  }

  private async inTransaction<T>(operation: (repository: ConfigurationRepository) => Promise<T>): Promise<T> {
    return this.repository.withTransaction ? this.repository.withTransaction(operation) : operation(this.repository);
  }

  private async persistAudited(
    action: AdministrativeAuditAction,
    entityType: string,
    before: ProfileVersion,
    after: ProfileVersion,
    context: ConfigurationCommandContext,
  ): Promise<void> {
    await this.inTransaction(async (repository) => {
      await repository.saveProfileVersion(after);
      await this.audit(action, entityType, after.id, before, after, context, undefined, repository);
    });
  }

  private activeRecord<T extends object>(input: T): T & {
    status: "ACTIVE";
    createdAt: string;
    updatedAt: string;
  } {
    const at = this.at();
    return { ...input, status: "ACTIVE", createdAt: at, updatedAt: at };
  }
}

function toJsonSafe(value: unknown): ConfigurationJsonValue {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as ConfigurationJsonValue;
}
