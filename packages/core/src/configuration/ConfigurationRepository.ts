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

export interface ConfigurationRepository {
  withTransaction?<T>(operation: (repository: ConfigurationRepository) => Promise<T>): Promise<T>;
  saveOrganization(value: Organization): Promise<void>;
  findOrganizationById(organizationId: string): Promise<Organization | null>;
  saveLegalEntity(value: LegalEntity): Promise<void>;
  findLegalEntityById(organizationId: string, id: string): Promise<LegalEntity | null>;
  saveBankDirectory(value: BankDirectory): Promise<void>;
  findBankDirectoryById(organizationId: string, id: string): Promise<BankDirectory | null>;
  saveBank(value: Bank): Promise<void>;
  findBankById(organizationId: string, id: string): Promise<Bank | null>;
  saveBankAccount(value: ConfigBankAccount): Promise<void>;
  findBankAccountById(organizationId: string, id: string): Promise<ConfigBankAccount | null>;
  listBankAccounts(organizationId: string): Promise<ConfigBankAccount[]>;
  saveLedgerAccount(value: ConfigLedgerAccount): Promise<void>;
  findLedgerAccountById(organizationId: string, id: string): Promise<ConfigLedgerAccount | null>;
  saveProfile(value: ReconciliationProfile): Promise<void>;
  findProfileById(organizationId: string, id: string): Promise<ReconciliationProfile | null>;
  listProfiles(organizationId: string): Promise<ReconciliationProfile[]>;
  saveProfileVersion(value: ProfileVersion): Promise<void>;
  findProfileVersionById(organizationId: string, id: string): Promise<ProfileVersion | null>;
  listProfileVersions(organizationId: string, profileId: string): Promise<ProfileVersion[]>;
  saveAccountMapping(value: AccountMapping): Promise<void>;
  findAccountMappingById(organizationId: string, id: string): Promise<AccountMapping | null>;
  listAccountMappings(organizationId: string, profileVersionId: string): Promise<AccountMapping[]>;
  saveImportMappingVersion(value: ImportMappingVersion): Promise<void>;
  findImportMappingVersionById(organizationId: string, id: string): Promise<ImportMappingVersion | null>;
  listImportMappingVersions(organizationId: string, profileVersionId: string): Promise<ImportMappingVersion[]>;
  saveInheritanceNode(value: InheritanceConfigurationNode): Promise<void>;
  findInheritanceNodeById(organizationId: string, id: string): Promise<InheritanceConfigurationNode | null>;
  listInheritanceNodes(organizationId: string): Promise<InheritanceConfigurationNode[]>;
  saveInheritanceOverride(value: InheritanceConfigurationOverride): Promise<void>;
  listInheritanceOverrides(organizationId: string, nodeId: string): Promise<InheritanceConfigurationOverride[]>;
  saveSimulation(value: Simulation): Promise<void>;
  findSimulationById(organizationId: string, id: string): Promise<Simulation | null>;
  listSimulations(organizationId: string, profileVersionId: string): Promise<Simulation[]>;
  savePublishedSnapshot?(value: PublishedSnapshot): Promise<void>;
  findPublishedSnapshotById?(organizationId: string, id: string): Promise<PublishedSnapshot | null>;
  listPublishedSnapshots?(organizationId: string, profileVersionId?: string): Promise<PublishedSnapshot[]>;
  saveRunRecord?(value: RunRecord): Promise<void>;
  findRunRecordById?(organizationId: string, id: string): Promise<RunRecord | null>;
  findRunRecordByIdempotencyKey?(organizationId: string, idempotencyKey: string): Promise<RunRecord | null>;
  listRunRecords?(organizationId: string): Promise<RunRecord[]>;
  saveWizardDraft(value: WizardDraft): Promise<void>;
  findWizardDraftById(organizationId: string, id: string): Promise<WizardDraft | null>;
  appendAuditEvent(value: AdministrativeAuditEvent): Promise<void>;
  listAuditEvents(organizationId: string, entityType?: string, entityId?: string): Promise<AdministrativeAuditEvent[]>;
}
