export type ConfigurationJsonPrimitive = boolean | number | string | null;
export type ConfigurationJsonValue =
  | ConfigurationJsonPrimitive
  | ConfigurationJsonValue[]
  | { [key: string]: ConfigurationJsonValue };
export type ConfigurationJsonObject = { [key: string]: ConfigurationJsonValue };

import type {
  EffectiveProfileSnapshotV1,
  ReconciliationRequestV1,
  ReconciliationResultV1,
  RoutingConditionV1,
} from "../contracts/reconciliation-v1.js";

export type RecordStatus = "ACTIVE" | "INACTIVE";
export type ProfileVersionStatus =
  | "draft"
  | "validating"
  | "ready"
  | "approved"
  | "published"
  | "superseded"
  | "inactive";

export interface EffectivePeriod {
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  defaultCurrency: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LegalEntity {
  id: string;
  organizationId: string;
  legalName: string;
  taxId: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BankDirectory {
  id: string;
  organizationId: string;
  name: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Bank {
  id: string;
  organizationId: string;
  directoryId: string;
  code: string;
  name: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigBankAccount extends EffectivePeriod {
  id: string;
  organizationId: string;
  legalEntityId: string;
  bankId: string;
  agency: string;
  account: string;
  currency: string;
  accountType: "CHECKING" | "SAVINGS" | "INVESTMENT" | "OTHER";
  status: RecordStatus;
  inactivationReason?: string;
  inactivatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigLedgerAccount extends EffectivePeriod {
  id: string;
  organizationId: string;
  legalEntityId: string;
  code: string;
  name: string;
  currency: string;
  sourceSystem: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationProfile {
  id: string;
  organizationId: string;
  legalEntityId: string;
  name: string;
  description?: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileVersion extends EffectivePeriod {
  id: string;
  organizationId: string;
  profileId: string;
  version: number;
  status: ProfileVersionStatus;
  configuration: ConfigurationJsonObject;
  sourceVersionId?: string;
  validationIssues: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
}

export interface AccountMapping extends EffectivePeriod {
  id: string;
  organizationId: string;
  profileVersionId: string;
  bankAccountId: string;
  ledgerAccountId: string;
  priority?: number;
  match?: "ALL" | "ANY";
  conditions?: readonly RoutingConditionV1[];
  fallback?: boolean;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ImportMappingVersion extends EffectivePeriod {
  id: string;
  organizationId: string;
  profileVersionId: string;
  source: "BANK" | "LEDGER";
  version: number;
  fieldMap: Record<string, string>;
  status: RecordStatus;
  publishedAt?: string;
  publishedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type InheritanceLevel = "ORGANIZATION" | "LEGAL_ENTITY" | "PROFILE" | "PROFILE_VERSION";
export type EffectiveInheritanceLevel = "GLOBAL" | "BANK_LAYOUT" | "LEGAL_ENTITY" | "PROFILE" | "PROFILE_VERSION";

export interface InheritanceConfigurationNode extends EffectivePeriod {
  id: string;
  organizationId: string;
  level: InheritanceLevel;
  hierarchyLevel?: EffectiveInheritanceLevel;
  scopeId: string;
  parentNodeId?: string;
  sourceVersion?: string;
  values: ConfigurationJsonObject;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InheritanceConfigurationOverride {
  id: string;
  organizationId: string;
  nodeId: string;
  key: string;
  value: ConfigurationJsonValue;
  reason: string;
  createdAt: string;
  createdBy: string;
}

export interface Simulation {
  id: string;
  organizationId: string;
  profileVersionId: string;
  bankAccountId: string;
  status: "SUCCEEDED" | "FAILED";
  result: ConfigurationJsonObject;
  reprocessOfSimulationId?: string;
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface PublishedSnapshot {
  id: string;
  organizationId: string;
  profileId: string;
  profileVersionId: string;
  bankAccountId: string;
  inheritanceNodeId?: string;
  requestedEffectiveAt: string;
  effectiveFrom: string;
  effectiveTo?: string;
  snapshot: Readonly<EffectiveProfileSnapshotV1>;
  configurationHash: string;
  createdAt: string;
  createdBy: string;
}

export type RunMode = "draft" | "simulation" | "official";
export type RunStatus = "PREPARED" | "RUNNING" | "SUCCEEDED" | "PENDING" | "BLOCKED" | "FAILED" | "TIMED_OUT" | "CANCELLED";

export interface RunRecord {
  id: string;
  organizationId: string;
  profileId: string;
  profileVersionId: string;
  bankAccountId: string;
  snapshotId: string;
  mode: RunMode;
  idempotencyKey: string;
  fileHashes: readonly string[];
  fileNames: readonly string[];
  configurationHash: string;
  snapshot: Readonly<EffectiveProfileSnapshotV1>;
  request: Readonly<ReconciliationRequestV1>;
  result?: Readonly<ReconciliationResultV1>;
  status: RunStatus;
  reprocessOfRunId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface WizardDraft {
  id: string;
  organizationId: string;
  actorId: string;
  profileId?: string;
  step: string;
  data: ConfigurationJsonObject;
  createdAt: string;
  updatedAt: string;
}

export type AdministrativeAuditAction =
  | "create"
  | "edit"
  | "validate"
  | "simulate"
  | "approve"
  | "publish"
  | "inactivate"
  | "reprocess"
  | "execute";

export interface AdministrativeAuditEvent {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  action: AdministrativeAuditAction;
  before: ConfigurationJsonValue;
  after: ConfigurationJsonValue;
  actor: string;
  at: string;
  reason: string;
  correlationId: string;
}

export type ConfigurationRole = "EDITOR" | "APPROVER" | "ADMIN" | "AUDITOR";

export interface ConfigurationActor {
  actorId: string;
  organizationRoles: Readonly<Record<string, readonly ConfigurationRole[]>>;
}

export interface ConfigurationCommandContext {
  actor: ConfigurationActor;
  reason: string;
  correlationId: string;
}

export class ConfigurationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function normalizeAgency(value: string): string {
  return normalizeAccountIdentifier(value, "Agência");
}

export function normalizeAccount(value: string): string {
  return normalizeAccountIdentifier(value, "Conta");
}

export function isEffectiveAt(period: EffectivePeriod, date: string): boolean {
  return period.effectiveFrom <= date && (period.effectiveTo === undefined || date < period.effectiveTo);
}

export function effectivePeriodsOverlap(left: EffectivePeriod, right: EffectivePeriod): boolean {
  return (right.effectiveTo === undefined || left.effectiveFrom < right.effectiveTo)
    && (left.effectiveTo === undefined || right.effectiveFrom < left.effectiveTo);
}

export function assertEffectivePeriod(period: EffectivePeriod): void {
  assertIsoDate(period.effectiveFrom, "effectiveFrom");
  if (period.effectiveTo !== undefined) {
    assertIsoDate(period.effectiveTo, "effectiveTo");
    if (period.effectiveTo <= period.effectiveFrom) {
      throw new ConfigurationError("INVALID_EFFECTIVE_PERIOD", "effectiveTo deve ser posterior a effectiveFrom.");
    }
  }
}

export function assertIsoDate(value: string, field: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ConfigurationError("INVALID_DATE", `${field} deve ser uma data ISO válida.`);
  }
}

function normalizeAccountIdentifier(value: string, label: string): string {
  const compact = value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) throw new ConfigurationError("INVALID_ACCOUNT_IDENTITY", `${label} não pode ser vazia.`);
  return /^\d+$/.test(compact) ? compact.replace(/^0+(?=\d)/, "") : compact;
}
