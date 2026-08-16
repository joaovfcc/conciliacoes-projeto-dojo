import {
  RECONCILIATION_CONFIGURATION_V1,
  RECONCILIATION_CONTRACT_VERSION_V1,
  createEffectiveProfileSnapshotV1,
  type CanonicalTransactionV1,
  type EffectiveProfileSnapshotV1,
  type ReconciliationRequestV1,
} from "../../src/index.js";

const V1 = RECONCILIATION_CONTRACT_VERSION_V1;

export function reconciliationSnapshotFixture(): Readonly<EffectiveProfileSnapshotV1> {
  return createEffectiveProfileSnapshotV1({
    schemaVersion: V1,
    profileId: "profile-1",
    profileVersion: "7",
    organizationId: "organization-1",
    legalEntityId: "legal-entity-1",
    bankAccountId: "bank-account-1",
    ledgerAccountIds: ["ledger-account-payments", "ledger-account-receipts"],
    currency: "BRL",
    timezone: "America/Sao_Paulo",
    ruleset: {
      schemaVersion: V1,
      id: "ruleset-standard",
      version: "1",
      configuration: {
        schemaVersion: V1,
        engineRuleVersion: RECONCILIATION_CONFIGURATION_V1.version,
        ruleOrder: ["RF-01", "RF-02", "RF-03", "RF-04", "RF-05", "RF-07", "RF-08", "RF-09"],
        genericWords: [...RECONCILIATION_CONFIGURATION_V1.genericWords],
        dateWindowDays: RECONCILIATION_CONFIGURATION_V1.dateWindowDays,
        rf03: { ...RECONCILIATION_CONFIGURATION_V1.rf03 },
        rf06: { ...RECONCILIATION_CONFIGURATION_V1.rf06 },
        maxCombinationsPerAnchor: RECONCILIATION_CONFIGURATION_V1.maxCombinationsPerAnchor,
        automaticApplicationPattern: RECONCILIATION_CONFIGURATION_V1.automaticApplicationPattern,
      },
    },
    importMappings: [
      {
        schemaVersion: V1,
        id: "mapping-bank-generic",
        version: "1",
        source: "BANK",
        fieldMap: { amount: "amountCents", date: "postingDate", text: "description" },
      },
      {
        schemaVersion: V1,
        id: "mapping-ledger-generic",
        version: "1",
        source: "LEDGER",
        fieldMap: { amount: "amountCents", date: "postingDate", text: "description" },
      },
    ],
    signConvention: {
      schemaVersion: V1,
      canonicalDebitSign: "NEGATIVE",
      bankDebitSign: "NEGATIVE",
      ledgerDebitSign: "NEGATIVE",
    },
    routing: {
      schemaVersion: V1,
      strategy: "FIRST_MATCH",
      rules: [
        {
          schemaVersion: V1,
          id: "route-payments",
          priority: 10,
          enabled: true,
          match: "ALL",
          conditions: [
            {
              schemaVersion: V1,
              field: "DESCRIPTION",
              operator: "CONTAINS",
              value: "PAYMENT",
              caseSensitive: false,
            },
          ],
          ledgerAccountId: "ledger-account-payments",
        },
      ],
      defaultLedgerAccountId: "ledger-account-receipts",
    },
    exclusions: {
      schemaVersion: V1,
      rules: [
        {
          schemaVersion: V1,
          id: "exclude-internal-marker",
          enabled: true,
          source: "ANY",
          match: "ALL",
          conditions: [
            {
              schemaVersion: V1,
              field: "ORIGIN_CODE",
              operator: "EQUALS",
              value: "INTERNAL",
            },
          ],
          reason: "Internal movement",
        },
      ],
    },
    tolerances: {
      schemaVersion: V1,
      amountCents: "0",
      dateWindowDays: 3,
      descriptionSimilarity: 0.85,
      maxGroupSize: 3,
    },
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
  });
}

export function canonicalTransactionFixture(
  id: string,
  source: "BANK" | "LEDGER",
  overrides: Partial<CanonicalTransactionV1> = {},
): CanonicalTransactionV1 {
  return {
    schemaVersion: V1,
    id,
    importBatchId: `${source.toLowerCase()}-batch-1`,
    source,
    scopeId: "scope-1",
    organizationId: "organization-1",
    legalEntityId: "legal-entity-1",
    profileId: "profile-1",
    profileVersion: "7",
    bankAccountId: "bank-account-1",
    ...(source === "LEDGER" ? { ledgerAccountId: "ledger-account-payments" } : {}),
    currency: "BRL",
    sourceRow: source === "BANK" ? 1 : 2,
    postingDate: "2026-06-15",
    amountCents: "-12500",
    description: "Generic supplier payment",
    evidence: { fileId: `${source.toLowerCase()}-file-1`, line: source === "BANK" ? 1 : 2 },
    ...overrides,
  };
}

export function reconciliationRequestFixture(
  overrides: Partial<ReconciliationRequestV1> = {},
): ReconciliationRequestV1 {
  return {
    schemaVersion: V1,
    requestId: "request-1",
    runId: "run-1",
    idempotencyKey: "idempotency-1",
    requestedAt: "2026-06-16T12:00:00.000Z",
    scope: {
      schemaVersion: V1,
      id: "scope-1",
      organizationId: "organization-1",
      legalEntityId: "legal-entity-1",
      profileId: "profile-1",
      profileVersion: "7",
      bankAccountId: "bank-account-1",
      ledgerAccountIds: ["ledger-account-payments", "ledger-account-receipts"],
      currency: "BRL",
      timezone: "America/Sao_Paulo",
      period: { startDate: "2026-06-01", endDate: "2026-06-30" },
    },
    snapshot: reconciliationSnapshotFixture(),
    bankTransactions: [canonicalTransactionFixture("bank-transaction-1", "BANK")],
    ledgerTransactions: [canonicalTransactionFixture("ledger-transaction-1", "LEDGER")],
    ...overrides,
  };
}
