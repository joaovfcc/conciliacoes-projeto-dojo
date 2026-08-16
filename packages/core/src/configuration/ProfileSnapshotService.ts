import { randomUUID } from "node:crypto";

import {
  RECONCILIATION_CONTRACT_VERSION_V1,
  createEffectiveProfileSnapshotV1,
  type EffectiveProfileSnapshotInputV1,
  type ExclusionPolicyV1,
  type RulesetV1,
  type SignConventionV1,
  type ControlTolerancesV1,
} from "../contracts/reconciliation-v1.js";
import type { ConfigurationRepository } from "./ConfigurationRepository.js";
import { EffectiveConfigurationResolver } from "./EffectiveConfigurationResolver.js";
import {
  ConfigurationError,
  effectivePeriodsOverlap,
  isEffectiveAt,
  type ConfigurationJsonObject,
  type PublishedSnapshot,
} from "./models.js";

export interface CreateProfileSnapshotInput {
  id: string;
  organizationId: string;
  profileVersionId: string;
  bankAccountId: string;
  effectiveAt: string;
  createdBy: string;
  reason?: string;
  correlationId?: string;
  inheritanceNodeId?: string;
}

export class ProfileSnapshotService {
  public constructor(
    private readonly repository: ConfigurationRepository,
    private readonly resolver = new EffectiveConfigurationResolver(repository),
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  public async create(input: CreateProfileSnapshotInput): Promise<PublishedSnapshot> {
    const existing = await this.repository.findPublishedSnapshotById?.(input.organizationId, input.id);
    if (existing) {
      if (existing.profileVersionId === input.profileVersionId
        && existing.bankAccountId === input.bankAccountId
        && existing.inheritanceNodeId === input.inheritanceNodeId
        && existing.requestedEffectiveAt === input.effectiveAt) {
        return existing;
      }
      throw new ConfigurationError("IDEMPOTENCY_CONFLICT", "O identificador do snapshot já foi usado com parâmetros diferentes.");
    }
    const organization = await this.repository.findOrganizationById(input.organizationId);
    const version = await this.repository.findProfileVersionById(input.organizationId, input.profileVersionId);
    if (!organization || organization.status !== "ACTIVE") throw blocker("Organização ativa é obrigatória.");
    if (!version || version.status !== "approved" || !version.approvedAt) throw blocker("Versão aprovada é obrigatória.");
    if (!isEffectiveAt(version, input.effectiveAt)) throw blocker("Versão não está vigente na data do snapshot.");
    const profile = await this.repository.findProfileById(input.organizationId, version.profileId);
    if (!profile || profile.status !== "ACTIVE") throw blocker("Perfil ativo é obrigatório.");
    const entity = await this.repository.findLegalEntityById(input.organizationId, profile.legalEntityId);
    if (!entity || entity.status !== "ACTIVE") throw blocker("Entidade legal ativa é obrigatória.");
    const bank = await this.repository.findBankAccountById(input.organizationId, input.bankAccountId);
    if (!bank || bank.status !== "ACTIVE" || !isEffectiveAt(bank, input.effectiveAt)) {
      throw blocker("Conta bancária ativa e vigente é obrigatória.");
    }
    if (bank.legalEntityId !== profile.legalEntityId) throw blocker("Conta bancária não pertence à entidade do perfil.");

    const mappings = (await this.repository.listAccountMappings(input.organizationId, version.id)).filter(
      (mapping) => mapping.bankAccountId === bank.id && mapping.status === "ACTIVE" && isEffectiveAt(mapping, input.effectiveAt),
    );
    if (mappings.length === 0) throw blocker("Ao menos um roteamento ativo e vigente é obrigatório.");
    if (mappings.filter((mapping) => mapping.fallback).length > 1) throw blocker("Somente um fallback é permitido por conta bancária.");
    const ledgers = [];
    for (const mapping of mappings) {
      const ledger = await this.repository.findLedgerAccountById(input.organizationId, mapping.ledgerAccountId);
      if (!ledger || ledger.status !== "ACTIVE" || !isEffectiveAt(ledger, input.effectiveAt)) {
        throw blocker("Conta contábil ativa e vigente é obrigatória.");
      }
      if (ledger.legalEntityId !== profile.legalEntityId || ledger.currency !== bank.currency) {
        throw blocker("Contas roteadas devem pertencer à entidade e moeda do perfil.");
      }
      ledgers.push(ledger);
    }
    assertNoRoutingConflicts(mappings);

    const imports = (await this.repository.listImportMappingVersions(input.organizationId, version.id)).filter(
      (mapping) => mapping.status === "ACTIVE" && mapping.publishedAt !== undefined && isEffectiveAt(mapping, input.effectiveAt),
    );
    if (!imports.some((mapping) => mapping.source === "BANK") || !imports.some((mapping) => mapping.source === "LEDGER")) {
      throw blocker("Mapeamentos de importação BANK e LEDGER publicados e ativos são obrigatórios.");
    }
    const resolution = input.inheritanceNodeId
      ? await this.resolver.resolveNode(input.organizationId, input.inheritanceNodeId, input.effectiveAt)
      : undefined;
    const inheritanceNodes = await Promise.all(
      (resolution?.chain ?? []).map(async (nodeId) => {
        const node = await this.repository.findInheritanceNodeById(input.organizationId, nodeId);
        if (!node) throw blocker("Nó da cadeia de herança não foi encontrado.");
        return node;
      }),
    );
    const inherited = resolution?.values ?? {};
    const configuration = deepMerge(inherited, version.configuration);
    const signConvention = required<SignConventionV1>(configuration, "signConvention");
    if (configuration.signConfirmed !== true) throw blocker("Convenção de sinais deve estar confirmada.");
    const snapshotInput: EffectiveProfileSnapshotInputV1 = {
      schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1,
      profileId: profile.id,
      profileVersion: String(version.version),
      organizationId: input.organizationId,
      legalEntityId: profile.legalEntityId,
      bankAccountId: bank.id,
      ledgerAccountIds: [...new Set(mappings.map((mapping) => mapping.ledgerAccountId))].sort(),
      currency: bank.currency,
      timezone: organization.timezone,
      ruleset: required<RulesetV1>(configuration, "ruleset"),
      importMappings: imports
        .sort((left, right) => left.source.localeCompare(right.source) || left.version - right.version)
        .map((mapping) => ({
          schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1,
          id: mapping.id,
          version: String(mapping.version),
          source: mapping.source,
          fieldMap: mapping.fieldMap,
        })),
      signConvention,
      routing: {
        schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1,
        strategy: "FIRST_MATCH",
        rules: mappings
          .filter((mapping) => !mapping.fallback)
          .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id))
          .map((mapping) => ({
            schemaVersion: RECONCILIATION_CONTRACT_VERSION_V1,
            id: mapping.id,
            priority: mapping.priority ?? 0,
            enabled: true,
            match: mapping.match ?? "ALL",
            conditions: mapping.conditions ?? [],
            ledgerAccountId: mapping.ledgerAccountId,
          })),
        ...(mappings.find((mapping) => mapping.fallback)?.ledgerAccountId
          ? { defaultLedgerAccountId: mappings.find((mapping) => mapping.fallback)!.ledgerAccountId }
          : {}),
      },
      exclusions: required<ExclusionPolicyV1>(configuration, "exclusions"),
      tolerances: required<ControlTolerancesV1>(configuration, "tolerances"),
      effectiveFrom: maxDate(
        version.effectiveFrom,
        bank.effectiveFrom,
        ...mappings.map((mapping) => mapping.effectiveFrom),
        ...ledgers.map((ledger) => ledger.effectiveFrom),
        ...imports.map((mapping) => mapping.effectiveFrom),
        ...inheritanceNodes.map((node) => node.effectiveFrom),
      ),
      ...minOptionalDate(
        version.effectiveTo,
        bank.effectiveTo,
        ...mappings.map((mapping) => mapping.effectiveTo),
        ...ledgers.map((ledger) => ledger.effectiveTo),
        ...imports.map((mapping) => mapping.effectiveTo),
        ...inheritanceNodes.map((node) => node.effectiveTo),
      ),
    };
    const snapshot = createEffectiveProfileSnapshotV1(snapshotInput);
    const record: PublishedSnapshot = {
      id: input.id,
      organizationId: input.organizationId,
      profileId: profile.id,
      profileVersionId: version.id,
      bankAccountId: bank.id,
      ...(input.inheritanceNodeId === undefined ? {} : { inheritanceNodeId: input.inheritanceNodeId }),
      requestedEffectiveAt: input.effectiveAt,
      effectiveFrom: snapshot.effectiveFrom,
      ...(snapshot.effectiveTo === undefined ? {} : { effectiveTo: snapshot.effectiveTo }),
      snapshot,
      configurationHash: snapshot.configurationHash,
      createdAt: this.now().toISOString(),
      createdBy: input.createdBy,
    };
    if (!this.repository.savePublishedSnapshot) {
      throw new ConfigurationError("SNAPSHOT_REPOSITORY_UNSUPPORTED", "Repositório não suporta snapshots publicados.");
    }
    const persist = async (repository: ConfigurationRepository): Promise<void> => {
      await repository.savePublishedSnapshot!(record);
      await repository.appendAuditEvent({
        id: this.newId(),
        organizationId: record.organizationId,
        entityType: "PUBLISHED_SNAPSHOT",
        entityId: record.id,
        action: "publish",
        before: null,
        after: {
          profileVersionId: record.profileVersionId,
          bankAccountId: record.bankAccountId,
          configurationHash: record.configurationHash,
        },
        actor: input.createdBy,
        at: record.createdAt,
        reason: input.reason ?? "effective profile snapshot generated",
        correlationId: input.correlationId ?? record.id,
      });
    };
    if (this.repository.withTransaction) await this.repository.withTransaction(persist);
    else await persist(this.repository);
    return structuredClone(record);
  }
}

function required<T>(configuration: ConfigurationJsonObject, key: string): T {
  const value = configuration[key];
  if (!value || typeof value !== "object") throw blocker(`Configuração ${key} é obrigatória.`);
  return structuredClone(value) as T;
}

function blocker(message: string): ConfigurationError {
  return new ConfigurationError("SNAPSHOT_BLOCKED", message);
}

function assertNoRoutingConflicts(mappings: readonly {
  id: string;
  priority?: number;
  fallback?: boolean;
  ledgerAccountId: string;
  effectiveFrom: string;
  effectiveTo?: string;
}[]): void {
  for (let left = 0; left < mappings.length; left += 1) {
    for (let right = left + 1; right < mappings.length; right += 1) {
      const first = mappings[left]!;
      const second = mappings[right]!;
      if (effectivePeriodsOverlap(first, second)
        && (first.fallback && second.fallback
          || !first.fallback && !second.fallback && (first.priority ?? 0) === (second.priority ?? 0))) {
        throw blocker("Roteamentos incompatíveis possuem vigência e prioridade sobrepostas.");
      }
    }
  }
}

function deepMerge(parent: ConfigurationJsonObject, child: ConfigurationJsonObject): ConfigurationJsonObject {
  const result = structuredClone(parent);
  for (const [key, value] of Object.entries(child)) {
    const current = result[key];
    result[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : structuredClone(value);
  }
  return result;
}

function isObject(value: unknown): value is ConfigurationJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maxDate(...dates: string[]): string {
  return [...dates].sort().at(-1)!;
}

function minOptionalDate(...dates: Array<string | undefined>): { effectiveTo?: string } {
  const defined = dates.filter((date): date is string => date !== undefined).sort();
  return defined[0] ? { effectiveTo: defined[0] } : {};
}
