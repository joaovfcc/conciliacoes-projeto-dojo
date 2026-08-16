import type { ConfigurationRepository } from "./ConfigurationRepository.js";
import type {
  AccountMapping,
  AdministrativeAuditEvent,
  Bank,
  BankDirectory,
  ConfigBankAccount,
  ConfigLedgerAccount,
  ImportMappingVersion,
  InheritanceConfigurationNode,
  InheritanceConfigurationOverride,
  LegalEntity,
  Organization,
  ProfileVersion,
  PublishedSnapshot,
  ReconciliationProfile,
  RunRecord,
  Simulation,
  WizardDraft,
} from "./models.js";
import { ConfigurationError } from "./models.js";

const copy = <T>(value: T): T => structuredClone(value);
const key = (organizationId: string, id: string): string => `${organizationId}\0${id}`;

export class InMemoryConfigurationRepository implements ConfigurationRepository {
  private readonly organizations = new Map<string, Organization>();
  private readonly legalEntities = new Map<string, LegalEntity>();
  private readonly bankDirectories = new Map<string, BankDirectory>();
  private readonly banks = new Map<string, Bank>();
  private readonly bankAccounts = new Map<string, ConfigBankAccount>();
  private readonly ledgerAccounts = new Map<string, ConfigLedgerAccount>();
  private readonly profiles = new Map<string, ReconciliationProfile>();
  private readonly profileVersions = new Map<string, ProfileVersion>();
  private readonly accountMappings = new Map<string, AccountMapping>();
  private readonly importMappingVersions = new Map<string, ImportMappingVersion>();
  private readonly inheritanceNodes = new Map<string, InheritanceConfigurationNode>();
  private readonly inheritanceOverrides = new Map<string, InheritanceConfigurationOverride>();
  private readonly simulations = new Map<string, Simulation>();
  private readonly publishedSnapshots = new Map<string, PublishedSnapshot>();
  private readonly runRecords = new Map<string, RunRecord>();
  private readonly wizardDrafts = new Map<string, WizardDraft>();
  private readonly auditEvents: AdministrativeAuditEvent[] = [];

  async withTransaction<T>(operation: (repository: ConfigurationRepository) => Promise<T>): Promise<T> {
    const snapshot = this.snapshotState();
    try {
      return await operation(this);
    } catch (error) {
      this.restoreState(snapshot);
      throw error;
    }
  }

  async saveOrganization(value: Organization): Promise<void> {
    this.organizations.set(value.id, copy(value));
  }

  async findOrganizationById(organizationId: string): Promise<Organization | null> {
    return this.fromMap(this.organizations, organizationId);
  }

  async saveLegalEntity(value: LegalEntity): Promise<void> {
    this.legalEntities.set(key(value.organizationId, value.id), copy(value));
  }

  async findLegalEntityById(organizationId: string, id: string): Promise<LegalEntity | null> {
    return this.fromMap(this.legalEntities, key(organizationId, id));
  }

  async saveBankDirectory(value: BankDirectory): Promise<void> {
    this.bankDirectories.set(key(value.organizationId, value.id), copy(value));
  }

  async findBankDirectoryById(organizationId: string, id: string): Promise<BankDirectory | null> {
    return this.fromMap(this.bankDirectories, key(organizationId, id));
  }

  async saveBank(value: Bank): Promise<void> {
    this.banks.set(key(value.organizationId, value.id), copy(value));
  }

  async findBankById(organizationId: string, id: string): Promise<Bank | null> {
    return this.fromMap(this.banks, key(organizationId, id));
  }

  async saveBankAccount(value: ConfigBankAccount): Promise<void> {
    this.bankAccounts.set(key(value.organizationId, value.id), copy(value));
  }

  async findBankAccountById(organizationId: string, id: string): Promise<ConfigBankAccount | null> {
    return this.fromMap(this.bankAccounts, key(organizationId, id));
  }

  async listBankAccounts(organizationId: string): Promise<ConfigBankAccount[]> {
    return this.byOrganization(this.bankAccounts, organizationId);
  }

  async saveLedgerAccount(value: ConfigLedgerAccount): Promise<void> {
    this.ledgerAccounts.set(key(value.organizationId, value.id), copy(value));
  }

  async findLedgerAccountById(organizationId: string, id: string): Promise<ConfigLedgerAccount | null> {
    return this.fromMap(this.ledgerAccounts, key(organizationId, id));
  }

  async saveProfile(value: ReconciliationProfile): Promise<void> {
    this.profiles.set(key(value.organizationId, value.id), copy(value));
  }

  async findProfileById(organizationId: string, id: string): Promise<ReconciliationProfile | null> {
    return this.fromMap(this.profiles, key(organizationId, id));
  }

  async listProfiles(organizationId: string): Promise<ReconciliationProfile[]> {
    return this.byOrganization(this.profiles, organizationId);
  }

  async saveProfileVersion(value: ProfileVersion): Promise<void> {
    const storageKey = key(value.organizationId, value.id);
    const existing = this.profileVersions.get(storageKey);
    if (existing) assertPublishedVersionUpdate(existing, value);
    this.profileVersions.set(storageKey, copy(value));
  }

  async findProfileVersionById(organizationId: string, id: string): Promise<ProfileVersion | null> {
    return this.fromMap(this.profileVersions, key(organizationId, id));
  }

  async listProfileVersions(organizationId: string, profileId: string): Promise<ProfileVersion[]> {
    return this.byOrganization(this.profileVersions, organizationId)
      .filter((value) => value.profileId === profileId)
      .sort((left, right) => left.version - right.version);
  }

  async saveAccountMapping(value: AccountMapping): Promise<void> {
    this.accountMappings.set(key(value.organizationId, value.id), copy(value));
  }

  async findAccountMappingById(organizationId: string, id: string): Promise<AccountMapping | null> {
    return this.fromMap(this.accountMappings, key(organizationId, id));
  }

  async listAccountMappings(organizationId: string, profileVersionId: string): Promise<AccountMapping[]> {
    return this.byOrganization(this.accountMappings, organizationId).filter(
      (value) => value.profileVersionId === profileVersionId,
    );
  }

  async saveImportMappingVersion(value: ImportMappingVersion): Promise<void> {
    this.importMappingVersions.set(key(value.organizationId, value.id), copy(value));
  }

  async findImportMappingVersionById(organizationId: string, id: string): Promise<ImportMappingVersion | null> {
    return this.fromMap(this.importMappingVersions, key(organizationId, id));
  }

  async listImportMappingVersions(organizationId: string, profileVersionId: string): Promise<ImportMappingVersion[]> {
    return this.byOrganization(this.importMappingVersions, organizationId).filter(
      (value) => value.profileVersionId === profileVersionId,
    );
  }

  async saveInheritanceNode(value: InheritanceConfigurationNode): Promise<void> {
    this.inheritanceNodes.set(key(value.organizationId, value.id), copy(value));
  }

  async findInheritanceNodeById(organizationId: string, id: string): Promise<InheritanceConfigurationNode | null> {
    return this.fromMap(this.inheritanceNodes, key(organizationId, id));
  }

  async listInheritanceNodes(organizationId: string): Promise<InheritanceConfigurationNode[]> {
    return this.byOrganization(this.inheritanceNodes, organizationId);
  }

  async saveInheritanceOverride(value: InheritanceConfigurationOverride): Promise<void> {
    this.inheritanceOverrides.set(key(value.organizationId, value.id), copy(value));
  }

  async listInheritanceOverrides(organizationId: string, nodeId: string): Promise<InheritanceConfigurationOverride[]> {
    return this.byOrganization(this.inheritanceOverrides, organizationId).filter((value) => value.nodeId === nodeId);
  }

  async saveSimulation(value: Simulation): Promise<void> {
    this.simulations.set(key(value.organizationId, value.id), copy(value));
  }

  async findSimulationById(organizationId: string, id: string): Promise<Simulation | null> {
    return this.fromMap(this.simulations, key(organizationId, id));
  }

  async listSimulations(organizationId: string, profileVersionId: string): Promise<Simulation[]> {
    return this.byOrganization(this.simulations, organizationId).filter(
      (value) => value.profileVersionId === profileVersionId,
    );
  }

  async savePublishedSnapshot(value: PublishedSnapshot): Promise<void> {
    const storageKey = key(value.organizationId, value.id);
    const existing = this.publishedSnapshots.get(storageKey);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error("Published snapshots are immutable.");
    }
    this.publishedSnapshots.set(storageKey, copy(value));
  }

  async findPublishedSnapshotById(organizationId: string, id: string): Promise<PublishedSnapshot | null> {
    return this.fromMap(this.publishedSnapshots, key(organizationId, id));
  }

  async listPublishedSnapshots(organizationId: string, profileVersionId?: string): Promise<PublishedSnapshot[]> {
    return this.byOrganization(this.publishedSnapshots, organizationId).filter(
      (value) => profileVersionId === undefined || value.profileVersionId === profileVersionId,
    );
  }

  async saveRunRecord(value: RunRecord): Promise<void> {
    const storageKey = key(value.organizationId, value.id);
    const byIdempotencyKey = [...this.runRecords.values()].find(
      (record) => record.organizationId === value.organizationId && record.idempotencyKey === value.idempotencyKey,
    );
    if (byIdempotencyKey && byIdempotencyKey.id !== value.id) {
      throw new ConfigurationError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outra requisição.");
    }
    const existing = this.runRecords.get(storageKey);
    if (existing && JSON.stringify(withoutRunOutcome(existing)) !== JSON.stringify(withoutRunOutcome(value))) {
      throw new ConfigurationError("IMMUTABLE_RUN_INPUT", "Os dados de entrada e hashes de uma execução são imutáveis.");
    }
    this.runRecords.set(storageKey, copy(value));
  }

  async findRunRecordById(organizationId: string, id: string): Promise<RunRecord | null> {
    return this.fromMap(this.runRecords, key(organizationId, id));
  }

  async findRunRecordByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<RunRecord | null> {
    return this.byOrganization(this.runRecords, organizationId).find((value) => value.idempotencyKey === idempotencyKey) ?? null;
  }

  async listRunRecords(organizationId: string): Promise<RunRecord[]> {
    return this.byOrganization(this.runRecords, organizationId);
  }

  async saveWizardDraft(value: WizardDraft): Promise<void> {
    this.wizardDrafts.set(key(value.organizationId, value.id), copy(value));
  }

  async findWizardDraftById(organizationId: string, id: string): Promise<WizardDraft | null> {
    return this.fromMap(this.wizardDrafts, key(organizationId, id));
  }

  async appendAuditEvent(value: AdministrativeAuditEvent): Promise<void> {
    this.auditEvents.push(copy(value));
  }

  async listAuditEvents(
    organizationId: string,
    entityType?: string,
    entityId?: string,
  ): Promise<AdministrativeAuditEvent[]> {
    return this.auditEvents
      .filter((event) => event.organizationId === organizationId)
      .filter((event) => entityType === undefined || event.entityType === entityType)
      .filter((event) => entityId === undefined || event.entityId === entityId)
      .map(copy);
  }

  private fromMap<T>(values: Map<string, T>, id: string): T | null {
    const value = values.get(id);
    return value === undefined ? null : copy(value);
  }

  private byOrganization<T extends { organizationId: string }>(values: Map<string, T>, organizationId: string): T[] {
    return [...values.values()].filter((value) => value.organizationId === organizationId).map(copy);
  }

  private snapshotState(): RepositoryState {
    return {
      organizations: copy(this.organizations),
      legalEntities: copy(this.legalEntities),
      bankDirectories: copy(this.bankDirectories),
      banks: copy(this.banks),
      bankAccounts: copy(this.bankAccounts),
      ledgerAccounts: copy(this.ledgerAccounts),
      profiles: copy(this.profiles),
      profileVersions: copy(this.profileVersions),
      accountMappings: copy(this.accountMappings),
      importMappingVersions: copy(this.importMappingVersions),
      inheritanceNodes: copy(this.inheritanceNodes),
      inheritanceOverrides: copy(this.inheritanceOverrides),
      simulations: copy(this.simulations),
      publishedSnapshots: copy(this.publishedSnapshots),
      runRecords: copy(this.runRecords),
      wizardDrafts: copy(this.wizardDrafts),
      auditEvents: copy(this.auditEvents),
    };
  }

  private restoreState(state: RepositoryState): void {
    for (const [target, source] of [
      [this.organizations, state.organizations],
      [this.legalEntities, state.legalEntities],
      [this.bankDirectories, state.bankDirectories],
      [this.banks, state.banks],
      [this.bankAccounts, state.bankAccounts],
      [this.ledgerAccounts, state.ledgerAccounts],
      [this.profiles, state.profiles],
      [this.profileVersions, state.profileVersions],
      [this.accountMappings, state.accountMappings],
      [this.importMappingVersions, state.importMappingVersions],
      [this.inheritanceNodes, state.inheritanceNodes],
      [this.inheritanceOverrides, state.inheritanceOverrides],
      [this.simulations, state.simulations],
      [this.publishedSnapshots, state.publishedSnapshots],
      [this.runRecords, state.runRecords],
      [this.wizardDrafts, state.wizardDrafts],
    ] as Array<[Map<string, unknown>, Map<string, unknown>]>) {
      target.clear();
      for (const [entryKey, value] of source) target.set(entryKey, copy(value));
    }
    this.auditEvents.splice(0, this.auditEvents.length, ...copy(state.auditEvents));
  }
}

interface RepositoryState {
  organizations: Map<string, Organization>;
  legalEntities: Map<string, LegalEntity>;
  bankDirectories: Map<string, BankDirectory>;
  banks: Map<string, Bank>;
  bankAccounts: Map<string, ConfigBankAccount>;
  ledgerAccounts: Map<string, ConfigLedgerAccount>;
  profiles: Map<string, ReconciliationProfile>;
  profileVersions: Map<string, ProfileVersion>;
  accountMappings: Map<string, AccountMapping>;
  importMappingVersions: Map<string, ImportMappingVersion>;
  inheritanceNodes: Map<string, InheritanceConfigurationNode>;
  inheritanceOverrides: Map<string, InheritanceConfigurationOverride>;
  simulations: Map<string, Simulation>;
  publishedSnapshots: Map<string, PublishedSnapshot>;
  runRecords: Map<string, RunRecord>;
  wizardDrafts: Map<string, WizardDraft>;
  auditEvents: AdministrativeAuditEvent[];
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
  if (!allowed.includes(next.status) || JSON.stringify(existingImmutable) !== JSON.stringify(nextImmutable)) {
    throw new ConfigurationError("IMMUTABLE_PROFILE_VERSION", "Versões publicadas não podem ser alteradas.");
  }
}

function withoutRunOutcome(value: RunRecord): Omit<RunRecord, "result" | "status" | "updatedAt"> {
  const { result: _result, status: _status, updatedAt: _updatedAt, ...immutable } = value;
  return immutable;
}
