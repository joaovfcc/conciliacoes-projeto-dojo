import type { NextRequest } from "next/server";
import {
  ConfigurationError,
  type CanonicalTransactionV1,
  type ActorContext,
  type CompanyRole,
  type ConfigurationAccountMapping,
  type ConfigurationJsonObject,
  type ConfigurationJsonValue,
  type ImportMappingVersion,
  type InheritanceConfigurationNode,
  type RoutingConditionV1,
} from "@conciliacao/core";
import { z } from "zod";
import type { ConfigurationRuntime } from "./configuration-runtime";
import {
  toConfigurationCommandContext,
  V2HttpError,
  v2RouteError,
} from "./v2-auth";

type RouteContext = { params: Promise<Record<string, string>> };
export type ConfigurationRouteHandler = (request: NextRequest, context?: RouteContext) => Promise<Response>;

const idSchema = z.string().trim().min(1).max(160);
const textSchema = z.string().trim().min(1).max(2_000);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isActualIsoDate, "Data ISO inválida");
const isoDateTimeSchema = z.iso.datetime({ offset: false });
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const centsSchema = z.string().regex(/^(?:0|-[1-9]\d*|[1-9]\d*)$/);
const tenantSchema = z.object({ orgId: idSchema, companyId: idSchema });
const commandSchema = z.object({ reason: textSchema.optional(), correlationId: idSchema.optional() });
const effectivePeriodSchema = z.object({ effectiveFrom: isoDateSchema, effectiveTo: isoDateSchema.optional() });
const statusSchema = z.enum(["ACTIVE", "INACTIVE"]);

const jsonValueSchema: z.ZodType<ConfigurationJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(100_000),
  z.array(jsonValueSchema),
  z.record(z.string().trim().min(1).max(500), jsonValueSchema),
]));
const jsonObjectSchema: z.ZodType<ConfigurationJsonObject> = z.record(
  z.string().trim().min(1).max(500),
  jsonValueSchema,
);

const routingConditionSchema = z.object({
  schemaVersion: z.literal("1"),
  field: z.enum([
    "DESCRIPTION", "DOCUMENT_ID", "ORIGIN_CODE", "TRANSACTION_TYPE", "SIGN", "AMOUNT_CENTS",
    "COUNTERPARTY", "TAX_ID", "LEDGER_COUNTERPART_ACCOUNT", "UNIT", "BRANCH", "POSTING_DATE", "METADATA",
  ]),
  operator: z.enum([
    "EQUALS", "CONTAINS", "STARTS_WITH", "MATCHES_REGEX", "IN", "GREATER_THAN_OR_EQUAL", "LESS_THAN", "BETWEEN",
  ]),
  value: z.union([z.string().max(2_000), z.array(z.string().max(2_000)).max(100)]),
  metadataKey: idSchema.optional(),
  caseSensitive: z.boolean().optional(),
}).strict();

const canonicalTransactionSchema = z.object({
  schemaVersion: z.literal("1"),
  id: idSchema,
  importBatchId: idSchema,
  source: z.enum(["BANK", "LEDGER"]),
  scopeId: idSchema,
  organizationId: idSchema,
  legalEntityId: idSchema,
  profileId: idSchema,
  profileVersion: idSchema,
  bankAccountId: idSchema,
  ledgerAccountId: idSchema.optional(),
  currency: currencySchema,
  sourceRow: z.number().int().positive(),
  postingDate: isoDateSchema,
  amountCents: centsSchema,
  description: z.string().max(10_000),
  documentId: z.string().max(500).optional(),
  originCode: z.string().max(500).optional(),
  counterparty: z.string().max(2_000).optional(),
  counterpart: z.string().max(2_000).optional(),
  taxId: z.string().max(100).optional(),
  ledgerCounterpartAccount: z.string().max(500).optional(),
  evidence: z.object({
    fileId: idSchema,
    originalName: z.string().max(500).optional(),
    line: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    sourceText: z.string().max(50_000).optional(),
  }).catchall(jsonValueSchema),
  metadata: jsonObjectSchema.optional(),
}).strict();

const bankAccountSchema = tenantSchema.extend({
  id: idSchema,
  legalEntityId: idSchema,
  bankId: idSchema,
  agency: idSchema,
  account: idSchema,
  currency: currencySchema,
  accountType: z.enum(["CHECKING", "SAVINGS", "INVESTMENT", "OTHER"]),
}).extend(effectivePeriodSchema.shape).extend(commandSchema.shape).strict();

const ledgerAccountSchema = tenantSchema.extend({
  id: idSchema,
  legalEntityId: idSchema,
  code: idSchema,
  name: textSchema,
  currency: currencySchema,
  sourceSystem: idSchema,
}).extend(effectivePeriodSchema.shape).extend(commandSchema.shape).strict();

const profileSchema = tenantSchema.extend({
  id: idSchema,
  versionId: idSchema,
  legalEntityId: idSchema,
  name: textSchema,
  description: z.string().trim().max(2_000).optional(),
  configuration: jsonObjectSchema.optional(),
}).extend(effectivePeriodSchema.shape).extend(commandSchema.shape).strict();

const profileVersionSchema = tenantSchema.extend({
  id: idSchema,
  profileId: idSchema,
  sourceVersionId: idSchema,
  configuration: jsonObjectSchema.optional(),
}).extend(effectivePeriodSchema.shape).extend(commandSchema.shape).strict();

const lifecycleSchema = tenantSchema.extend({
  action: z.enum(["start-validation", "validate", "approve", "publish", "inactivate"]),
  issues: z.array(z.string().trim().min(1).max(2_000)).max(500).optional(),
}).extend(commandSchema.shape).strict();

const accountMappingSchema = tenantSchema.extend({
  id: idSchema,
  profileVersionId: idSchema,
  bankAccountId: idSchema,
  ledgerAccountId: idSchema,
  priority: z.number().int().nonnegative(),
  match: z.enum(["ALL", "ANY"]).optional(),
  conditions: z.array(routingConditionSchema).max(100).optional(),
  fallback: z.boolean().optional(),
  status: statusSchema,
}).extend(effectivePeriodSchema.shape).extend(commandSchema.shape).strict();

const importMappingSchema = tenantSchema.extend({
  id: idSchema,
  profileVersionId: idSchema,
  source: z.enum(["BANK", "LEDGER"]),
  version: z.number().int().positive(),
  fieldMap: z.record(z.string().trim().min(1).max(200), z.string().trim().min(1).max(500)),
  status: statusSchema,
}).extend(effectivePeriodSchema.shape).extend(commandSchema.shape).strict();

const importMappingPublicationSchema = tenantSchema.extend({
  profileVersionId: idSchema,
}).extend(commandSchema.shape).strict();

const inheritanceNodeSchema = tenantSchema.extend({
  id: idSchema,
  level: z.enum(["ORGANIZATION", "LEGAL_ENTITY", "PROFILE", "PROFILE_VERSION"]),
  hierarchyLevel: z.enum(["GLOBAL", "BANK_LAYOUT", "LEGAL_ENTITY", "PROFILE", "PROFILE_VERSION"]).optional(),
  scopeId: idSchema,
  parentNodeId: idSchema.optional(),
  sourceVersion: idSchema.optional(),
  values: jsonObjectSchema,
  status: statusSchema,
}).extend(effectivePeriodSchema.shape).extend(commandSchema.shape).strict();

const approvalSchema = tenantSchema.extend(commandSchema.shape).strict();

const snapshotSchema = tenantSchema.extend({
  id: idSchema,
  profileVersionId: idSchema,
  bankAccountId: idSchema,
  effectiveAt: isoDateSchema,
  inheritanceNodeId: idSchema.optional(),
}).extend(commandSchema.shape).strict();

const runSchema = tenantSchema.extend({
  snapshotId: idSchema,
  requestId: idSchema,
  runId: idSchema,
  idempotencyKey: idSchema,
  requestedAt: isoDateTimeSchema,
  period: z.object({ startDate: isoDateSchema, endDate: isoDateSchema }).strict(),
  bankTransactions: z.array(canonicalTransactionSchema).max(100_000),
  ledgerTransactions: z.array(canonicalTransactionSchema).max(100_000),
  fileHashes: z.array(hashSchema).min(1).max(1_000),
  fileNames: z.array(z.string().trim().min(1).max(500)).max(1_000).optional(),
  mode: z.enum(["draft", "simulation", "official"]),
  allowReprocess: z.boolean().optional(),
  reprocessOfRunId: idSchema.optional(),
  fakeScenario: z.enum(["success", "pending", "blocked", "failure", "timeout", "cancel"]).optional(),
}).extend(commandSchema.shape).strict();

const simulationSchema = runSchema.omit({ mode: true, allowReprocess: true, reprocessOfRunId: true }).extend({
  id: idSchema,
  profileVersionId: idSchema,
  fakeScenario: z.enum(["success", "failure"]).optional(),
}).strict();

const draftSchema = tenantSchema.extend({
  id: idSchema,
  profileId: idSchema.optional(),
  step: idSchema,
  data: jsonObjectSchema,
}).extend(commandSchema.shape).strict();

const listSchema = tenantSchema.strict();
const effectiveSchema = tenantSchema.extend({ at: isoDateSchema }).strict();
const draftResumeSchema = tenantSchema.extend(commandSchema.shape).strict();
const auditSchema = tenantSchema.extend({ entityType: idSchema.optional(), entityId: idSchema.optional() }).strict();

export function createConfigurationHandlers(runtime: ConfigurationRuntime) {
  const runtimeCommand = <T extends z.ZodType>(
    schema: T,
    execute: (data: z.output<T> & CommandData, actor: ActorContext, context: ReturnType<typeof toConfigurationCommandContext>) => Promise<unknown>,
    roles?: readonly CompanyRole[] | ((data: z.output<T> & CommandData) => readonly CompanyRole[]),
  ) => command(runtime, schema, execute, roles);
  const runtimeCommandWithId = <T extends z.ZodType>(
    schema: T,
    execute: (id: string, data: z.output<T> & CommandData, actor: ActorContext, context: ReturnType<typeof toConfigurationCommandContext>) => Promise<unknown>,
    roles?: readonly CompanyRole[],
  ) => commandWithId(runtime, schema, execute, roles);
  const runtimeGet = <T extends z.ZodType>(
    schema: T,
    execute: (data: z.output<T> & TenantData) => Promise<unknown>,
  ) => get(runtime, schema, execute);
  const runtimeGetWithId = <T extends z.ZodType>(
    schema: T,
    execute: (id: string, data: z.output<T> & TenantData) => Promise<unknown>,
  ) => getWithId(runtime, schema, execute);
  const runtimeCommandQueryWithId = <T extends z.ZodType>(
    schema: T,
    execute: (id: string, data: z.output<T> & CommandData, actor: ActorContext, context: ReturnType<typeof toConfigurationCommandContext>) => Promise<unknown>,
  ) => commandQueryWithId(runtime, schema, execute);
  return {
    listBankAccounts: runtimeGet(listSchema, async ({ orgId }) => runtime.repository.listBankAccounts(orgId)),
    registerBankAccount: runtimeCommand(bankAccountSchema, async (data, actor, context) => runtime.configuration.registerBankAccount({
      id: data.id,
      organizationId: data.orgId,
      legalEntityId: data.legalEntityId,
      bankId: data.bankId,
      agency: data.agency,
      account: data.account,
      currency: data.currency,
      accountType: data.accountType,
      effectiveFrom: data.effectiveFrom,
      ...(data.effectiveTo === undefined ? {} : { effectiveTo: data.effectiveTo }),
    }, context)),
    createLedgerAccount: runtimeCommand(ledgerAccountSchema, async (data, actor, context) => runtime.configuration.createLedgerAccount({
      id: data.id,
      organizationId: data.orgId,
      legalEntityId: data.legalEntityId,
      code: data.code,
      name: data.name,
      currency: data.currency,
      sourceSystem: data.sourceSystem,
      effectiveFrom: data.effectiveFrom,
      ...(data.effectiveTo === undefined ? {} : { effectiveTo: data.effectiveTo }),
    }, context)),
    listProfiles: runtimeGet(listSchema, async ({ orgId }) => runtime.repository.listProfiles(orgId)),
    createProfile: runtimeCommand(profileSchema, async (data, actor, context) => runtime.configuration.createProfile({
      id: data.id,
      versionId: data.versionId,
      organizationId: data.orgId,
      legalEntityId: data.legalEntityId,
      name: data.name,
      effectiveFrom: data.effectiveFrom,
      ...(data.description === undefined ? {} : { description: data.description }),
      ...(data.effectiveTo === undefined ? {} : { effectiveTo: data.effectiveTo }),
      ...(data.configuration === undefined ? {} : { configuration: data.configuration }),
    }, context)),
    createProfileVersion: runtimeCommand(profileVersionSchema, async (data, actor, context) => runtime.configuration.createNewProfileVersion({
      id: data.id,
      organizationId: data.orgId,
      profileId: data.profileId,
      sourceVersionId: data.sourceVersionId,
      effectiveFrom: data.effectiveFrom,
      ...(data.effectiveTo === undefined ? {} : { effectiveTo: data.effectiveTo }),
      ...(data.configuration === undefined ? {} : { configuration: data.configuration }),
    }, context)),
    transitionProfileVersion: runtimeCommandWithId(lifecycleSchema, async (id, data, actor, context) => {
      if (data.action === "start-validation") return runtime.configuration.startProfileVersionValidation(data.orgId, id, context);
      if (data.action === "validate") return runtime.configuration.validateProfileVersion(data.orgId, id, data.issues ?? [], context);
      if (data.action === "approve") return runtime.configuration.approveProfileVersion(data.orgId, id, context);
      if (data.action === "publish") return runtime.configuration.publishProfileVersion(data.orgId, id, context);
      return runtime.configuration.inactivateProfileVersion(data.orgId, id, context);
    }),
    saveAccountMapping: runtimeCommand(accountMappingSchema, async (data, actor, context) => {
      const at = new Date().toISOString();
      const mapping: ConfigurationAccountMapping = {
        id: data.id,
        organizationId: data.orgId,
        profileVersionId: data.profileVersionId,
        bankAccountId: data.bankAccountId,
        ledgerAccountId: data.ledgerAccountId,
        priority: data.priority,
        status: data.status,
        effectiveFrom: data.effectiveFrom,
        createdAt: at,
        updatedAt: at,
        ...(data.match === undefined ? {} : { match: data.match }),
        ...(data.conditions === undefined ? {} : { conditions: data.conditions as readonly RoutingConditionV1[] }),
        ...(data.fallback === undefined ? {} : { fallback: data.fallback }),
        ...(data.effectiveTo === undefined ? {} : { effectiveTo: data.effectiveTo }),
      };
      await runtime.configuration.saveAccountMapping(mapping, context);
      return mapping;
    }),
    saveImportMapping: runtimeCommand(importMappingSchema, async (data, actor, context) => {
      const at = new Date().toISOString();
      const mapping: ImportMappingVersion = {
        id: data.id,
        organizationId: data.orgId,
        profileVersionId: data.profileVersionId,
        source: data.source,
        version: data.version,
        fieldMap: data.fieldMap,
        status: data.status,
        effectiveFrom: data.effectiveFrom,
        createdAt: at,
        updatedAt: at,
        ...(data.effectiveTo === undefined ? {} : { effectiveTo: data.effectiveTo }),
      };
      await runtime.configuration.saveImportMappingVersion(mapping, context);
      return mapping;
    }),
    publishImportMapping: runtimeCommandWithId(
      importMappingPublicationSchema,
      async (id, data, actor, context) => runtime.configuration.publishImportMappingVersion(
        data.orgId,
        id,
        data.profileVersionId,
        context,
      ),
      ["REVIEWER", "ADMIN"],
    ),
    saveInheritanceNode: runtimeCommand(inheritanceNodeSchema, async (data, actor, context) => {
      const at = new Date().toISOString();
      const node: InheritanceConfigurationNode = {
        id: data.id,
        organizationId: data.orgId,
        level: data.level,
        scopeId: data.scopeId,
        values: data.values,
        status: data.status,
        effectiveFrom: data.effectiveFrom,
        createdAt: at,
        updatedAt: at,
        ...(data.hierarchyLevel === undefined ? {} : { hierarchyLevel: data.hierarchyLevel }),
        ...(data.parentNodeId === undefined ? {} : { parentNodeId: data.parentNodeId }),
        ...(data.sourceVersion === undefined ? {} : { sourceVersion: data.sourceVersion }),
        ...(data.effectiveTo === undefined ? {} : { effectiveTo: data.effectiveTo }),
      };
      await runtime.configuration.saveInheritanceNode(node, context);
      return node;
    }),
    getEffectiveInheritance: runtimeGetWithId(effectiveSchema, async (id, { orgId, at }) => ({
      values: await runtime.configuration.resolveInheritedConfiguration(orgId, id, at),
    })),
    recordSimulation: runtimeCommand(simulationSchema, async (data, actor, context) => {
      if (data.fakeScenario !== undefined && process.env.NODE_ENV !== "test") {
        throw new V2HttpError(400, "FAKE_SCENARIO_FORBIDDEN", "fakeScenario só é permitido em testes");
      }
      const snapshot = await runtime.repository.findPublishedSnapshotById?.(data.orgId, data.snapshotId);
      if (!snapshot) throw new ConfigurationError("SNAPSHOT_NOT_FOUND", "Snapshot publicado não encontrado.");
      if (snapshot.profileVersionId !== data.profileVersionId) {
        throw new ConfigurationError("PROFILE_VERSION_MISMATCH", "Snapshot não pertence à versão informada.");
      }
      const orchestrator = data.fakeScenario === undefined
        ? runtime.orchestrator
        : runtime.orchestratorForScenario(data.fakeScenario);
      const run = await orchestrator.execute({
        organizationId: data.orgId,
        snapshotId: data.snapshotId,
        requestId: data.requestId,
        runId: data.runId,
        idempotencyKey: data.idempotencyKey,
        requestedAt: data.requestedAt,
        period: data.period,
        bankTransactions: data.bankTransactions as CanonicalTransactionV1[],
        ledgerTransactions: data.ledgerTransactions as CanonicalTransactionV1[],
        fileHashes: data.fileHashes,
        mode: "simulation",
        actorId: actor.actorId,
        ...(data.fileNames === undefined ? {} : { fileNames: data.fileNames }),
      });
      return runtime.configuration.recordSimulation({
        id: data.id,
        organizationId: data.orgId,
        profileVersionId: run.profileVersionId,
        bankAccountId: run.bankAccountId,
        status: run.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
        result: JSON.parse(JSON.stringify({ runId: run.id, status: run.status, result: run.result ?? null })),
      }, context);
    }, ["PREPARER", "ADMIN"]),
    approveSimulation: runtimeCommandWithId(approvalSchema, async (id, data, actor, context) => (
      runtime.configuration.approveSimulation(data.orgId, id, context)
    )),
    generateSnapshot: runtimeCommand(snapshotSchema, async (data, actor, context) => runtime.snapshots.create({
      id: data.id,
      organizationId: data.orgId,
      profileVersionId: data.profileVersionId,
      bankAccountId: data.bankAccountId,
      effectiveAt: data.effectiveAt,
      createdBy: actor.actorId,
      reason: context.reason,
      correlationId: context.correlationId,
      ...(data.inheritanceNodeId === undefined ? {} : { inheritanceNodeId: data.inheritanceNodeId }),
    }), ["REVIEWER", "ADMIN"]),
    executeRun: runtimeCommand(runSchema, async (data, actor) => {
      if (data.fakeScenario !== undefined && process.env.NODE_ENV !== "test") {
        throw new V2HttpError(400, "FAKE_SCENARIO_FORBIDDEN", "fakeScenario só é permitido em testes");
      }
      const orchestrator = data.fakeScenario === undefined
        ? runtime.orchestrator
        : runtime.orchestratorForScenario(data.fakeScenario);
      return orchestrator.execute({
        organizationId: data.orgId,
        snapshotId: data.snapshotId,
        requestId: data.requestId,
        runId: data.runId,
        idempotencyKey: data.idempotencyKey,
        requestedAt: data.requestedAt,
        period: data.period,
        bankTransactions: data.bankTransactions as CanonicalTransactionV1[],
        ledgerTransactions: data.ledgerTransactions as CanonicalTransactionV1[],
        fileHashes: data.fileHashes,
        mode: data.mode,
        actorId: actor.actorId,
        ...(data.fileNames === undefined ? {} : { fileNames: data.fileNames }),
        ...(data.allowReprocess === undefined ? {} : { allowReprocess: data.allowReprocess }),
        ...(data.allowReprocess ? { reprocessAuthorized: true } : {}),
        ...(data.reprocessOfRunId === undefined ? {} : { reprocessOfRunId: data.reprocessOfRunId }),
      });
    }, (data) => data.allowReprocess ? ["ADMIN"] : ["PREPARER", "ADMIN"]),
    saveDraft: runtimeCommand(draftSchema, async (data, actor, context) => runtime.configuration.saveWizardDraft({
      id: data.id,
      organizationId: data.orgId,
      step: data.step,
      data: data.data,
      ...(data.profileId === undefined ? {} : { profileId: data.profileId }),
    }, context)),
    resumeDraft: runtimeCommandQueryWithId(draftResumeSchema, async (id, data, actor, context) => {
      const draft = await runtime.configuration.resumeWizardDraft(data.orgId, id, context);
      if (!draft) throw new ConfigurationError("NOT_FOUND", "Rascunho não encontrado.");
      return draft;
    }),
    audit: runtimeGet(auditSchema, async ({ orgId, entityType, entityId }) => (
      runtime.configuration.getHistory(orgId, entityType, entityId)
    )),
  };
}

type TenantData = { orgId: string; companyId: string };
type CommandData = TenantData & { reason?: string | undefined; correlationId?: string | undefined };

function command<T extends z.ZodType>(
  runtime: ConfigurationRuntime,
  schema: T,
  execute: (
    data: z.output<T> & CommandData,
    actor: ActorContext,
    context: ReturnType<typeof toConfigurationCommandContext>,
  ) => Promise<unknown>,
  roles: readonly CompanyRole[] | ((data: z.output<T> & CommandData) => readonly CompanyRole[]) = [
    "PREPARER", "REVIEWER", "ADMIN", "AUDITOR",
  ],
): ConfigurationRouteHandler {
  return async (request) => route(async () => {
    const raw = await request.json() as unknown;
    const tenant = tenantSchema.parse(raw);
    const data = schema.parse(raw) as z.output<T> & CommandData;
    const actor = await authorizeTenant(runtime, request, tenant, typeof roles === "function" ? roles(data) : roles);
    const context = toConfigurationCommandContext(request, actor, data.orgId, data.companyId, commandMetadata(data));
    return success(await execute(data, actor, context));
  });
}

function commandWithId<T extends z.ZodType>(
  runtime: ConfigurationRuntime,
  schema: T,
  execute: (
    id: string,
    data: z.output<T> & CommandData,
    actor: ActorContext,
    context: ReturnType<typeof toConfigurationCommandContext>,
  ) => Promise<unknown>,
  roles?: readonly CompanyRole[],
): ConfigurationRouteHandler {
  return async (request, routeContext) => route(async () => {
    const id = await routeId(routeContext);
    const raw = await request.json() as unknown;
    const tenant = tenantSchema.parse(raw);
    const actor = await authorizeTenant(runtime, request, tenant, roles);
    const data = schema.parse(raw) as z.output<T> & CommandData;
    const context = toConfigurationCommandContext(request, actor, data.orgId, data.companyId, commandMetadata(data));
    return success(await execute(id, data, actor, context));
  });
}

function get<T extends z.ZodType>(
  runtime: ConfigurationRuntime,
  schema: T,
  execute: (data: z.output<T> & TenantData) => Promise<unknown>,
): ConfigurationRouteHandler {
  return async (request) => route(async () => {
    const data = schema.parse(Object.fromEntries(request.nextUrl.searchParams)) as z.output<T> & TenantData;
    await authorizeTenant(runtime, request, data);
    return success(await execute(data));
  });
}

function getWithId<T extends z.ZodType>(
  runtime: ConfigurationRuntime,
  schema: T,
  execute: (id: string, data: z.output<T> & TenantData) => Promise<unknown>,
): ConfigurationRouteHandler {
  return async (request, routeContext) => route(async () => {
    const data = schema.parse(Object.fromEntries(request.nextUrl.searchParams)) as z.output<T> & TenantData;
    await authorizeTenant(runtime, request, data);
    return success(await execute(await routeId(routeContext), data));
  });
}

function commandQueryWithId<T extends z.ZodType>(
  runtime: ConfigurationRuntime,
  schema: T,
  execute: (
    id: string,
    data: z.output<T> & CommandData,
    actor: ActorContext,
    context: ReturnType<typeof toConfigurationCommandContext>,
  ) => Promise<unknown>,
): ConfigurationRouteHandler {
  return async (request, routeContext) => route(async () => {
    const data = schema.parse(Object.fromEntries(request.nextUrl.searchParams)) as z.output<T> & CommandData;
    const actor = await authorizeTenant(runtime, request, data);
    const context = toConfigurationCommandContext(request, actor, data.orgId, data.companyId, commandMetadata(data));
    return success(await execute(await routeId(routeContext), data, actor, context));
  });
}

async function route(execute: () => Promise<Response>): Promise<Response> {
  try {
    return await execute();
  } catch (error) {
    return v2RouteError(error);
  }
}

function success(data: unknown): Response {
  return Response.json({ success: true, data });
}

async function routeId(context?: RouteContext): Promise<string> {
  const id = context ? (await context.params).id : undefined;
  return idSchema.parse(id);
}

function isActualIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function commandMetadata(data: CommandData): { reason?: string; correlationId?: string } {
  return {
    ...(data.reason === undefined ? {} : { reason: data.reason }),
    ...(data.correlationId === undefined ? {} : { correlationId: data.correlationId }),
  };
}

async function authorizeTenant(
  runtime: ConfigurationRuntime,
  request: NextRequest,
  tenant: TenantData,
  roles?: readonly CompanyRole[],
): Promise<ActorContext> {
  if (tenant.orgId !== tenant.companyId) {
    throw new V2HttpError(403, "FORBIDDEN", "A organização deve corresponder à empresa autorizada");
  }
  return runtime.authorizeActor(request, tenant.companyId, roles);
}
