import {
  Prisma,
  type ConfigAccountMapping as PrismaAccountMapping,
  type ConfigAuditEvent as PrismaAuditEvent,
  type ConfigBank as PrismaBank,
  type ConfigBankAccount as PrismaBankAccount,
  type ConfigBankDirectory as PrismaBankDirectory,
  type ConfigImportMappingVersion as PrismaImportMappingVersion,
  type ConfigInheritanceNode as PrismaInheritanceNode,
  type ConfigInheritanceOverride as PrismaInheritanceOverride,
  type ConfigLegalEntity as PrismaLegalEntity,
  type ConfigLedgerAccount as PrismaLedgerAccount,
  type ConfigOrganization as PrismaOrganization,
  type ConfigProfile as PrismaProfile,
  type ConfigProfileVersionStatus as PrismaProfileStatus,
  type ConfigProfileVersion as PrismaProfileVersion,
  type ConfigPublishedSnapshot as PrismaPublishedSnapshot,
  type ConfigRunRecord as PrismaRunRecord,
  type ConfigSimulation as PrismaSimulation,
  type ConfigWizardDraft as PrismaWizardDraft,
  type PrismaClient,
} from "@prisma/client";

import type { ConfigurationRepository } from "./ConfigurationRepository.js";
import {
  ConfigurationError,
  type AccountMapping,
  type AdministrativeAuditAction,
  type AdministrativeAuditEvent,
  type Bank,
  type BankDirectory,
  type ConfigBankAccount,
  type ConfigLedgerAccount,
  type ConfigurationJsonObject,
  type ConfigurationJsonValue,
  type ImportMappingVersion,
  type InheritanceConfigurationNode,
  type InheritanceConfigurationOverride,
  type LegalEntity,
  type Organization,
  type ProfileVersion,
  type ProfileVersionStatus,
  type PublishedSnapshot,
  type ReconciliationProfile,
  type RunMode,
  type RunRecord,
  type Simulation,
  type WizardDraft,
} from "./models.js";

export type ConfigurationPrismaClient = Pick<
  PrismaClient,
  | "$transaction"
  | "configOrganization"
  | "configLegalEntity"
  | "configBankDirectory"
  | "configBank"
  | "configBankAccount"
  | "configLedgerAccount"
  | "configProfile"
  | "configProfileVersion"
  | "configAccountMapping"
  | "configImportMappingVersion"
  | "configInheritanceNode"
  | "configInheritanceOverride"
  | "configSimulation"
  | "configPublishedSnapshot"
  | "configRunRecord"
  | "configWizardDraft"
  | "configAuditEvent"
>;

const profileStatusToPrisma: Record<ProfileVersionStatus, PrismaProfileStatus> = {
  draft: "DRAFT",
  validating: "VALIDATING",
  ready: "READY",
  approved: "APPROVED",
  published: "PUBLISHED",
  superseded: "SUPERSEDED",
  inactive: "INACTIVE",
};

const profileStatusFromPrisma: Record<PrismaProfileStatus, ProfileVersionStatus> = {
  DRAFT: "draft",
  VALIDATING: "validating",
  READY: "ready",
  APPROVED: "approved",
  PUBLISHED: "published",
  SUPERSEDED: "superseded",
  INACTIVE: "inactive",
};

export class PrismaConfigurationRepository implements ConfigurationRepository {
  public constructor(private readonly prisma: ConfigurationPrismaClient) {}

  public async withTransaction<T>(operation: (repository: ConfigurationRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (transaction) => operation(
      new PrismaConfigurationRepository(transaction as unknown as ConfigurationPrismaClient),
    ));
  }

  public async saveOrganization(value: Organization): Promise<void> {
    const data = {
      id: value.id,
      name: value.name,
      timezone: value.timezone,
      defaultCurrency: value.defaultCurrency,
      status: value.status,
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configOrganization.upsert({ where: { id: value.id }, create: data, update: data });
  }

  public async findOrganizationById(organizationId: string): Promise<Organization | null> {
    const row = await this.prisma.configOrganization.findUnique({ where: { id: organizationId } });
    return row === null ? null : organizationFromPrisma(row);
  }

  public async saveLegalEntity(value: LegalEntity): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      legalName: value.legalName,
      taxId: value.taxId,
      status: value.status,
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configLegalEntity.upsert({
      where: tenantId(value),
      create: data,
      update: data,
    });
  }

  public async findLegalEntityById(organizationId: string, id: string): Promise<LegalEntity | null> {
    const row = await this.prisma.configLegalEntity.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : legalEntityFromPrisma(row);
  }

  public async saveBankDirectory(value: BankDirectory): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      name: value.name,
      status: value.status,
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configBankDirectory.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findBankDirectoryById(organizationId: string, id: string): Promise<BankDirectory | null> {
    const row = await this.prisma.configBankDirectory.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : bankDirectoryFromPrisma(row);
  }

  public async saveBank(value: Bank): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      directoryId: value.directoryId,
      code: value.code,
      name: value.name,
      status: value.status,
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configBank.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findBankById(organizationId: string, id: string): Promise<Bank | null> {
    const row = await this.prisma.configBank.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : bankFromPrisma(row);
  }

  public async saveBankAccount(value: ConfigBankAccount): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      legalEntityId: value.legalEntityId,
      bankId: value.bankId,
      agency: value.agency,
      account: value.account,
      currency: value.currency,
      accountType: value.accountType,
      status: value.status,
      inactivationReason: value.inactivationReason ?? null,
      inactivatedAt: optionalDateTime(value.inactivatedAt),
      effectiveFrom: dateOnly(value.effectiveFrom),
      effectiveTo: optionalDateOnly(value.effectiveTo),
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configBankAccount.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findBankAccountById(organizationId: string, id: string): Promise<ConfigBankAccount | null> {
    const row = await this.prisma.configBankAccount.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : bankAccountFromPrisma(row);
  }

  public async listBankAccounts(organizationId: string): Promise<ConfigBankAccount[]> {
    const rows = await this.prisma.configBankAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    return rows.map(bankAccountFromPrisma);
  }

  public async saveLedgerAccount(value: ConfigLedgerAccount): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      legalEntityId: value.legalEntityId,
      code: value.code,
      name: value.name,
      currency: value.currency,
      sourceSystem: value.sourceSystem,
      status: value.status,
      effectiveFrom: dateOnly(value.effectiveFrom),
      effectiveTo: optionalDateOnly(value.effectiveTo),
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configLedgerAccount.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findLedgerAccountById(organizationId: string, id: string): Promise<ConfigLedgerAccount | null> {
    const row = await this.prisma.configLedgerAccount.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : ledgerAccountFromPrisma(row);
  }

  public async saveProfile(value: ReconciliationProfile): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      legalEntityId: value.legalEntityId,
      name: value.name,
      description: value.description ?? null,
      status: value.status,
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configProfile.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findProfileById(organizationId: string, id: string): Promise<ReconciliationProfile | null> {
    const row = await this.prisma.configProfile.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : profileFromPrisma(row);
  }

  public async listProfiles(organizationId: string): Promise<ReconciliationProfile[]> {
    const rows = await this.prisma.configProfile.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    return rows.map(profileFromPrisma);
  }

  public async saveProfileVersion(value: ProfileVersion): Promise<void> {
    const where = tenantId(value);
    const existing = await this.prisma.configProfileVersion.findUnique({ where });
    if (existing !== null) assertPublishedVersionUpdate(profileVersionFromPrisma(existing), value);
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      profileId: value.profileId,
      version: value.version,
      status: profileStatusToPrisma[value.status],
      configuration: jsonInput(value.configuration),
      sourceVersionId: value.sourceVersionId ?? null,
      validationIssues: [...value.validationIssues],
      effectiveFrom: dateOnly(value.effectiveFrom),
      effectiveTo: optionalDateOnly(value.effectiveTo),
      createdAt: dateTime(value.createdAt),
      createdBy: value.createdBy,
      updatedAt: dateTime(value.updatedAt),
      approvedAt: optionalDateTime(value.approvedAt),
      approvedBy: value.approvedBy ?? null,
      publishedAt: optionalDateTime(value.publishedAt),
      publishedBy: value.publishedBy ?? null,
    };
    await this.prisma.configProfileVersion.upsert({ where, create: data, update: data });
  }

  public async findProfileVersionById(organizationId: string, id: string): Promise<ProfileVersion | null> {
    const row = await this.prisma.configProfileVersion.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : profileVersionFromPrisma(row);
  }

  public async listProfileVersions(organizationId: string, profileId: string): Promise<ProfileVersion[]> {
    const rows = await this.prisma.configProfileVersion.findMany({
      where: { organizationId, profileId },
      orderBy: { version: "asc" },
    });
    return rows.map(profileVersionFromPrisma);
  }

  public async saveAccountMapping(value: AccountMapping): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      profileVersionId: value.profileVersionId,
      bankAccountId: value.bankAccountId,
      ledgerAccountId: value.ledgerAccountId,
      priority: value.priority ?? null,
      match: value.match ?? null,
      conditions: value.conditions === undefined ? Prisma.DbNull : jsonInput(value.conditions),
      fallback: value.fallback ?? null,
      status: value.status,
      effectiveFrom: dateOnly(value.effectiveFrom),
      effectiveTo: optionalDateOnly(value.effectiveTo),
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configAccountMapping.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findAccountMappingById(organizationId: string, id: string): Promise<AccountMapping | null> {
    const row = await this.prisma.configAccountMapping.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : accountMappingFromPrisma(row);
  }

  public async listAccountMappings(organizationId: string, profileVersionId: string): Promise<AccountMapping[]> {
    const rows = await this.prisma.configAccountMapping.findMany({
      where: { organizationId, profileVersionId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(accountMappingFromPrisma);
  }

  public async saveImportMappingVersion(value: ImportMappingVersion): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      profileVersionId: value.profileVersionId,
      source: value.source,
      version: value.version,
      fieldMap: jsonInput(value.fieldMap),
      status: value.status,
      publishedAt: optionalDateTime(value.publishedAt),
      publishedBy: value.publishedBy ?? null,
      effectiveFrom: dateOnly(value.effectiveFrom),
      effectiveTo: optionalDateOnly(value.effectiveTo),
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configImportMappingVersion.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findImportMappingVersionById(
    organizationId: string,
    id: string,
  ): Promise<ImportMappingVersion | null> {
    const row = await this.prisma.configImportMappingVersion.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : importMappingVersionFromPrisma(row);
  }

  public async listImportMappingVersions(
    organizationId: string,
    profileVersionId: string,
  ): Promise<ImportMappingVersion[]> {
    const rows = await this.prisma.configImportMappingVersion.findMany({
      where: { organizationId, profileVersionId },
      orderBy: { version: "asc" },
    });
    return rows.map(importMappingVersionFromPrisma);
  }

  public async saveInheritanceNode(value: InheritanceConfigurationNode): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      level: value.level,
      hierarchyLevel: value.hierarchyLevel ?? null,
      scopeId: value.scopeId,
      parentNodeId: value.parentNodeId ?? null,
      sourceVersion: value.sourceVersion ?? null,
      values: jsonInput(value.values),
      status: value.status,
      effectiveFrom: dateOnly(value.effectiveFrom),
      effectiveTo: optionalDateOnly(value.effectiveTo),
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configInheritanceNode.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findInheritanceNodeById(
    organizationId: string,
    id: string,
  ): Promise<InheritanceConfigurationNode | null> {
    const row = await this.prisma.configInheritanceNode.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : inheritanceNodeFromPrisma(row);
  }

  public async listInheritanceNodes(organizationId: string): Promise<InheritanceConfigurationNode[]> {
    const rows = await this.prisma.configInheritanceNode.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(inheritanceNodeFromPrisma);
  }

  public async saveInheritanceOverride(value: InheritanceConfigurationOverride): Promise<void> {
    await this.prisma.configInheritanceOverride.create({
      data: {
        id: value.id,
        organizationId: value.organizationId,
        nodeId: value.nodeId,
        key: value.key,
        value: jsonInput(value.value),
        reason: value.reason,
        createdAt: dateTime(value.createdAt),
        createdBy: value.createdBy,
      },
    });
  }

  public async listInheritanceOverrides(
    organizationId: string,
    nodeId: string,
  ): Promise<InheritanceConfigurationOverride[]> {
    const rows = await this.prisma.configInheritanceOverride.findMany({
      where: { organizationId, nodeId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(inheritanceOverrideFromPrisma);
  }

  public async saveSimulation(value: Simulation): Promise<void> {
    const where = tenantId(value);
    const existing = await this.prisma.configSimulation.findUnique({ where });
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      profileVersionId: value.profileVersionId,
      bankAccountId: value.bankAccountId,
      status: value.status,
      result: jsonInput(value.result),
      reprocessOfSimulationId: value.reprocessOfSimulationId ?? null,
      createdAt: dateTime(value.createdAt),
      createdBy: value.createdBy,
      approvedAt: optionalDateTime(value.approvedAt),
      approvedBy: value.approvedBy ?? null,
    };
    if (existing === null) {
      await this.prisma.configSimulation.create({ data });
      return;
    }
    const persisted = simulationFromPrisma(existing);
    if (!sameJson(withoutSimulationApproval(persisted), withoutSimulationApproval(value))) {
      throw new ConfigurationError("IMMUTABLE_SIMULATION", "O conteúdo de uma simulação registrada não pode ser alterado.");
    }
    await this.prisma.configSimulation.update({
      where,
      data: { approvedAt: data.approvedAt, approvedBy: data.approvedBy },
    });
  }

  public async findSimulationById(organizationId: string, id: string): Promise<Simulation | null> {
    const row = await this.prisma.configSimulation.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : simulationFromPrisma(row);
  }

  public async listSimulations(organizationId: string, profileVersionId: string): Promise<Simulation[]> {
    const rows = await this.prisma.configSimulation.findMany({
      where: { organizationId, profileVersionId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(simulationFromPrisma);
  }

  public async savePublishedSnapshot(value: PublishedSnapshot): Promise<void> {
    const where = tenantId(value);
    const existing = await this.prisma.configPublishedSnapshot.findUnique({ where });
    if (existing !== null) {
      if (!sameJson(publishedSnapshotFromPrisma(existing), value)) {
        throw new ConfigurationError("IMMUTABLE_PUBLISHED_SNAPSHOT", "Snapshots publicados são imutáveis.");
      }
      return;
    }
    await this.prisma.configPublishedSnapshot.create({
      data: {
        id: value.id,
        organizationId: value.organizationId,
        profileId: value.profileId,
        profileVersionId: value.profileVersionId,
        bankAccountId: value.bankAccountId,
        inheritanceNodeId: value.inheritanceNodeId ?? null,
        requestedEffectiveAt: dateOnly(value.requestedEffectiveAt),
        effectiveFrom: dateOnly(value.effectiveFrom),
        effectiveTo: optionalDateOnly(value.effectiveTo),
        snapshot: jsonInput(value.snapshot),
        configurationHash: value.configurationHash,
        createdAt: dateTime(value.createdAt),
        createdBy: value.createdBy,
      },
    });
  }

  public async findPublishedSnapshotById(organizationId: string, id: string): Promise<PublishedSnapshot | null> {
    const row = await this.prisma.configPublishedSnapshot.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : publishedSnapshotFromPrisma(row);
  }

  public async listPublishedSnapshots(
    organizationId: string,
    profileVersionId?: string,
  ): Promise<PublishedSnapshot[]> {
    const rows = await this.prisma.configPublishedSnapshot.findMany({
      where: { organizationId, ...(profileVersionId === undefined ? {} : { profileVersionId }) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(publishedSnapshotFromPrisma);
  }

  public async saveRunRecord(value: RunRecord): Promise<void> {
    const where = tenantId(value);
    const existing = await this.prisma.configRunRecord.findUnique({ where });
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      profileId: value.profileId,
      profileVersionId: value.profileVersionId,
      bankAccountId: value.bankAccountId,
      snapshotId: value.snapshotId,
      mode: runModeToPrisma(value.mode),
      idempotencyKey: value.idempotencyKey,
      fileHashes: [...value.fileHashes],
      fileNames: [...value.fileNames],
      configurationHash: value.configurationHash,
      snapshot: jsonInput(value.snapshot),
      request: jsonInput(value.request),
      result: value.result === undefined ? Prisma.DbNull : jsonInput(value.result),
      status: value.status,
      reprocessOfRunId: value.reprocessOfRunId ?? null,
      createdAt: dateTime(value.createdAt),
      createdBy: value.createdBy,
      updatedAt: dateTime(value.updatedAt),
    };
    if (existing === null) {
      try {
        await this.prisma.configRunRecord.create({ data });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        throw new ConfigurationError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outra requisição.");
      }
      return;
    }
    const persisted = runRecordFromPrisma(existing);
    if (!sameJson(withoutRunOutcome(persisted), withoutRunOutcome(value))) {
      throw new ConfigurationError("IMMUTABLE_RUN_INPUT", "Os dados de entrada e hashes de uma execução são imutáveis.");
    }
    await this.prisma.configRunRecord.update({
      where,
      data: { status: data.status, result: data.result, updatedAt: data.updatedAt },
    });
  }

  public async findRunRecordById(organizationId: string, id: string): Promise<RunRecord | null> {
    const row = await this.prisma.configRunRecord.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : runRecordFromPrisma(row);
  }

  public async findRunRecordByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<RunRecord | null> {
    const row = await this.prisma.configRunRecord.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    return row === null ? null : runRecordFromPrisma(row);
  }

  public async listRunRecords(organizationId: string): Promise<RunRecord[]> {
    const rows = await this.prisma.configRunRecord.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(runRecordFromPrisma);
  }

  public async saveWizardDraft(value: WizardDraft): Promise<void> {
    const data = {
      id: value.id,
      organizationId: value.organizationId,
      actorId: value.actorId,
      profileId: value.profileId ?? null,
      step: value.step,
      data: jsonInput(value.data),
      createdAt: dateTime(value.createdAt),
      updatedAt: dateTime(value.updatedAt),
    };
    await this.prisma.configWizardDraft.upsert({ where: tenantId(value), create: data, update: data });
  }

  public async findWizardDraftById(organizationId: string, id: string): Promise<WizardDraft | null> {
    const row = await this.prisma.configWizardDraft.findUnique({ where: tenantId({ organizationId, id }) });
    return row === null ? null : wizardDraftFromPrisma(row);
  }

  public async appendAuditEvent(value: AdministrativeAuditEvent): Promise<void> {
    await this.prisma.configAuditEvent.create({
      data: {
        id: value.id,
        organizationId: value.organizationId,
        entityType: value.entityType,
        entityId: value.entityId,
        action: value.action,
        before: jsonInput(value.before),
        after: jsonInput(value.after),
        actor: value.actor,
        at: dateTime(value.at),
        reason: value.reason,
        correlationId: value.correlationId,
      },
    });
  }

  public async listAuditEvents(
    organizationId: string,
    entityType?: string,
    entityId?: string,
  ): Promise<AdministrativeAuditEvent[]> {
    const rows = await this.prisma.configAuditEvent.findMany({
      where: {
        organizationId,
        ...(entityType === undefined ? {} : { entityType }),
        ...(entityId === undefined ? {} : { entityId }),
      },
      orderBy: { at: "asc" },
    });
    return rows.map(auditEventFromPrisma);
  }
}

function tenantId(value: { organizationId: string; id: string }) {
  return { organizationId_id: { organizationId: value.organizationId, id: value.id } };
}

function dateTime(value: string): Date {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new ConfigurationError("INVALID_DATE", `Data inválida: ${value}`);
  return result;
}

function optionalDateTime(value: string | undefined): Date | null {
  return value === undefined ? null : dateTime(value);
}

function dateOnly(value: string): Date {
  return dateTime(`${value}T00:00:00.000Z`);
}

function optionalDateOnly(value: string | undefined): Date | null {
  return value === undefined ? null : dateOnly(value);
}

function iso(value: Date): string {
  return value.toISOString();
}

function isoDate(value: Date): string {
  return iso(value).slice(0, 10);
}

function jsonInput(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonValue(value: Prisma.JsonValue): ConfigurationJsonValue {
  return JSON.parse(JSON.stringify(value)) as ConfigurationJsonValue;
}

function jsonObject(value: Prisma.JsonValue): ConfigurationJsonObject {
  const result = jsonValue(value);
  if (result === null || Array.isArray(result) || typeof result !== "object") {
    throw new ConfigurationError("INVALID_PERSISTED_JSON", "Era esperado um objeto JSON persistido.");
  }
  return result;
}

function organizationFromPrisma(row: PrismaOrganization): Organization {
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

function legalEntityFromPrisma(row: PrismaLegalEntity): LegalEntity {
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

function bankDirectoryFromPrisma(row: PrismaBankDirectory): BankDirectory {
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

function bankFromPrisma(row: PrismaBank): Bank {
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

function bankAccountFromPrisma(row: PrismaBankAccount): ConfigBankAccount {
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    bankId: row.bankId,
    agency: row.agency,
    account: row.account,
    currency: row.currency,
    accountType: row.accountType,
    status: row.status,
    ...(row.inactivationReason === null ? {} : { inactivationReason: row.inactivationReason }),
    ...(row.inactivatedAt === null ? {} : { inactivatedAt: iso(row.inactivatedAt) }),
    effectiveFrom: isoDate(row.effectiveFrom),
    ...(row.effectiveTo === null ? {} : { effectiveTo: isoDate(row.effectiveTo) }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function ledgerAccountFromPrisma(row: PrismaLedgerAccount): ConfigLedgerAccount {
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    code: row.code,
    name: row.name,
    currency: row.currency,
    sourceSystem: row.sourceSystem,
    status: row.status,
    effectiveFrom: isoDate(row.effectiveFrom),
    ...(row.effectiveTo === null ? {} : { effectiveTo: isoDate(row.effectiveTo) }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function profileFromPrisma(row: PrismaProfile): ReconciliationProfile {
  return {
    id: row.id,
    organizationId: row.organizationId,
    legalEntityId: row.legalEntityId,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function profileVersionFromPrisma(row: PrismaProfileVersion): ProfileVersion {
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileId: row.profileId,
    version: row.version,
    status: profileStatusFromPrisma[row.status],
    configuration: jsonObject(row.configuration),
    ...(row.sourceVersionId === null ? {} : { sourceVersionId: row.sourceVersionId }),
    validationIssues: [...row.validationIssues],
    effectiveFrom: isoDate(row.effectiveFrom),
    ...(row.effectiveTo === null ? {} : { effectiveTo: isoDate(row.effectiveTo) }),
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: iso(row.updatedAt),
    ...(row.approvedAt === null ? {} : { approvedAt: iso(row.approvedAt) }),
    ...(row.approvedBy === null ? {} : { approvedBy: row.approvedBy }),
    ...(row.publishedAt === null ? {} : { publishedAt: iso(row.publishedAt) }),
    ...(row.publishedBy === null ? {} : { publishedBy: row.publishedBy }),
  };
}

function accountMappingFromPrisma(row: PrismaAccountMapping): AccountMapping {
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileVersionId: row.profileVersionId,
    bankAccountId: row.bankAccountId,
    ledgerAccountId: row.ledgerAccountId,
    ...(row.priority === null ? {} : { priority: row.priority }),
    ...(row.match === null ? {} : { match: row.match }),
    ...(row.conditions === null ? {} : { conditions: jsonTyped(row.conditions) }),
    ...(row.fallback === null ? {} : { fallback: row.fallback }),
    status: row.status,
    effectiveFrom: isoDate(row.effectiveFrom),
    ...(row.effectiveTo === null ? {} : { effectiveTo: isoDate(row.effectiveTo) }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function importMappingVersionFromPrisma(row: PrismaImportMappingVersion): ImportMappingVersion {
  const fieldMap = jsonObject(row.fieldMap);
  if (Object.values(fieldMap).some((value) => typeof value !== "string")) {
    throw new ConfigurationError("INVALID_PERSISTED_JSON", "fieldMap persistido contém valor não textual.");
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileVersionId: row.profileVersionId,
    source: row.source,
    version: row.version,
    fieldMap: fieldMap as Record<string, string>,
    status: row.status,
    ...(row.publishedAt === null ? {} : { publishedAt: iso(row.publishedAt) }),
    ...(row.publishedBy === null ? {} : { publishedBy: row.publishedBy }),
    effectiveFrom: isoDate(row.effectiveFrom),
    ...(row.effectiveTo === null ? {} : { effectiveTo: isoDate(row.effectiveTo) }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function inheritanceNodeFromPrisma(row: PrismaInheritanceNode): InheritanceConfigurationNode {
  return {
    id: row.id,
    organizationId: row.organizationId,
    level: row.level,
    ...(row.hierarchyLevel === null ? {} : { hierarchyLevel: row.hierarchyLevel }),
    scopeId: row.scopeId,
    ...(row.parentNodeId === null ? {} : { parentNodeId: row.parentNodeId }),
    ...(row.sourceVersion === null ? {} : { sourceVersion: row.sourceVersion }),
    values: jsonObject(row.values),
    status: row.status,
    effectiveFrom: isoDate(row.effectiveFrom),
    ...(row.effectiveTo === null ? {} : { effectiveTo: isoDate(row.effectiveTo) }),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function inheritanceOverrideFromPrisma(row: PrismaInheritanceOverride): InheritanceConfigurationOverride {
  return { ...row, value: jsonValue(row.value), createdAt: iso(row.createdAt) };
}

function simulationFromPrisma(row: PrismaSimulation): Simulation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileVersionId: row.profileVersionId,
    bankAccountId: row.bankAccountId,
    status: row.status as Simulation["status"],
    result: jsonObject(row.result),
    ...(row.reprocessOfSimulationId === null ? {} : { reprocessOfSimulationId: row.reprocessOfSimulationId }),
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    ...(row.approvedAt === null ? {} : { approvedAt: iso(row.approvedAt) }),
    ...(row.approvedBy === null ? {} : { approvedBy: row.approvedBy }),
  };
}

function wizardDraftFromPrisma(row: PrismaWizardDraft): WizardDraft {
  return {
    id: row.id,
    organizationId: row.organizationId,
    actorId: row.actorId,
    ...(row.profileId === null ? {} : { profileId: row.profileId }),
    step: row.step,
    data: jsonObject(row.data),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function publishedSnapshotFromPrisma(row: PrismaPublishedSnapshot): PublishedSnapshot {
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileId: row.profileId,
    profileVersionId: row.profileVersionId,
    bankAccountId: row.bankAccountId,
    ...(row.inheritanceNodeId === null ? {} : { inheritanceNodeId: row.inheritanceNodeId }),
    requestedEffectiveAt: isoDate(row.requestedEffectiveAt),
    effectiveFrom: isoDate(row.effectiveFrom),
    ...(row.effectiveTo === null ? {} : { effectiveTo: isoDate(row.effectiveTo) }),
    snapshot: jsonTyped(row.snapshot),
    configurationHash: row.configurationHash,
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
  };
}

function runRecordFromPrisma(row: PrismaRunRecord): RunRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    profileId: row.profileId,
    profileVersionId: row.profileVersionId,
    bankAccountId: row.bankAccountId,
    snapshotId: row.snapshotId,
    mode: row.mode.toLowerCase() as RunMode,
    idempotencyKey: row.idempotencyKey,
    fileHashes: [...row.fileHashes],
    fileNames: [...row.fileNames],
    configurationHash: row.configurationHash,
    snapshot: jsonTyped(row.snapshot),
    request: jsonTyped(row.request),
    ...(row.result === null ? {} : { result: jsonTyped(row.result) }),
    status: row.status,
    ...(row.reprocessOfRunId === null ? {} : { reprocessOfRunId: row.reprocessOfRunId }),
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: iso(row.updatedAt),
  };
}

function jsonTyped<T>(value: Prisma.JsonValue): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runModeToPrisma(value: RunMode): "DRAFT" | "SIMULATION" | "OFFICIAL" {
  return value.toUpperCase() as "DRAFT" | "SIMULATION" | "OFFICIAL";
}

function withoutSimulationApproval(value: Simulation): Omit<Simulation, "approvedAt" | "approvedBy"> {
  const { approvedAt: _approvedAt, approvedBy: _approvedBy, ...immutable } = value;
  return immutable;
}

function withoutRunOutcome(value: RunRecord): Omit<RunRecord, "result" | "status" | "updatedAt"> {
  const { result: _result, status: _status, updatedAt: _updatedAt, ...immutable } = value;
  return immutable;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function assertPublishedVersionUpdate(existing: ProfileVersion, next: ProfileVersion): void {
  if (!["published", "superseded", "inactive"].includes(existing.status)) return;
  const { status: _existingStatus, updatedAt: _existingUpdatedAt, ...existingImmutable } = existing;
  const { status: _nextStatus, updatedAt: _nextUpdatedAt, ...nextImmutable } = next;
  const allowed = existing.status === "published"
    ? ["published", "superseded", "inactive"]
    : existing.status === "superseded"
      ? ["superseded", "inactive"]
      : ["inactive"];
  if (!allowed.includes(next.status) || !sameJson(existingImmutable, nextImmutable)) {
    throw new ConfigurationError("IMMUTABLE_PROFILE_VERSION", "Versões publicadas não podem ser alteradas.");
  }
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

function auditEventFromPrisma(row: PrismaAuditEvent): AdministrativeAuditEvent {
  return {
    ...row,
    action: row.action as AdministrativeAuditAction,
    before: jsonValue(row.before),
    after: jsonValue(row.after),
    at: iso(row.at),
  };
}
