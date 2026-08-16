import {
  ConfigurationService,
  FakeReconciliationEngineAdapter,
  PrismaConfigurationRepository,
  ProfileSnapshotService,
  RealReconciliationEngineAdapter,
  ReconciliationOrchestrator,
  prisma,
  type ConfigurationRepository,
  type ActorContext,
  type CompanyRole,
  type EnginePort,
  type FakeEngineScenario,
} from "@conciliacao/core";
import type { NextRequest } from "next/server";
import { requireV2Actor } from "./v2-auth";

export interface ConfigurationRuntime {
  repository: ConfigurationRepository;
  configuration: ConfigurationService;
  snapshots: ProfileSnapshotService;
  orchestrator: ReconciliationOrchestrator;
  orchestratorForScenario(scenario?: FakeEngineScenario): ReconciliationOrchestrator;
  authorizeActor(request: NextRequest, companyId?: string, roles?: readonly CompanyRole[]): Promise<ActorContext>;
}

export interface ConfigurationRuntimeDependencies {
  repository?: ConfigurationRepository;
  engine?: EnginePort;
}

export function createConfigurationRuntime(
  dependencies: ConfigurationRuntimeDependencies = {},
): ConfigurationRuntime {
  const repository = dependencies.repository ?? new PrismaConfigurationRepository(prisma);
  const engine = dependencies.engine ?? new RealReconciliationEngineAdapter();
  return {
    repository,
    configuration: new ConfigurationService(repository),
    snapshots: new ProfileSnapshotService(repository),
    orchestrator: new ReconciliationOrchestrator(repository, engine),
    orchestratorForScenario: (scenario) => new ReconciliationOrchestrator(
      repository,
      scenario === undefined ? engine : new FakeReconciliationEngineAdapter(scenario),
    ),
    authorizeActor: requireV2Actor,
  };
}
