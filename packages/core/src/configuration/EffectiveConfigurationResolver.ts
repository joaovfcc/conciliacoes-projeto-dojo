import type { ConfigurationRepository } from "./ConfigurationRepository.js";
import {
  ConfigurationError,
  isEffectiveAt,
  type ConfigurationJsonObject,
  type ConfigurationJsonValue,
  type EffectiveInheritanceLevel,
  type InheritanceConfigurationNode,
} from "./models.js";

export interface ConfigurationProvenance {
  effective: ConfigurationJsonValue;
  origin: { nodeId: string; level: EffectiveInheritanceLevel; scopeId: string };
  inherited: boolean;
  override: boolean;
  sourceVersion?: string;
}

export interface EffectiveConfigurationResolution {
  values: ConfigurationJsonObject;
  provenance: Readonly<Record<string, ConfigurationProvenance>>;
  chain: readonly string[];
}

export interface EffectiveConfigurationScope {
  globalId?: string;
  bankLayoutId?: string;
  legalEntityId?: string;
  profileId?: string;
  profileVersionId?: string;
}

const LEVELS: readonly EffectiveInheritanceLevel[] = ["GLOBAL", "BANK_LAYOUT", "LEGAL_ENTITY", "PROFILE", "PROFILE_VERSION"];

export class EffectiveConfigurationResolver {
  public constructor(private readonly repository: ConfigurationRepository) {}

  public async resolveNode(organizationId: string, nodeId: string, date: string): Promise<EffectiveConfigurationResolution> {
    const nodes = await this.repository.listInheritanceNodes(organizationId);
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) throw new ConfigurationError("NOT_FOUND", "Nó de herança não encontrado na organização.");
    return this.resolveChain(organizationId, target, nodes, date);
  }

  public async resolveEffective(
    organizationId: string,
    scope: EffectiveConfigurationScope,
    date: string,
  ): Promise<EffectiveConfigurationResolution> {
    const nodes = await this.repository.listInheritanceNodes(organizationId);
    const scopeByLevel: Partial<Record<EffectiveInheritanceLevel, string | undefined>> = {
      GLOBAL: scope.globalId,
      BANK_LAYOUT: scope.bankLayoutId,
      LEGAL_ENTITY: scope.legalEntityId,
      PROFILE: scope.profileId,
      PROFILE_VERSION: scope.profileVersionId,
    };
    const candidates = nodes.filter(
      (node) => node.status === "ACTIVE" && isEffectiveAt(node, date) && scopeByLevel[levelOf(node)] === node.scopeId,
    );
    const target = candidates.sort((left, right) => LEVELS.indexOf(levelOf(right)) - LEVELS.indexOf(levelOf(left)))[0];
    if (!target) throw new ConfigurationError("NOT_FOUND", "Configuração efetiva não encontrada para o escopo.");
    return this.resolveChain(organizationId, target, nodes, date);
  }

  private async resolveChain(
    organizationId: string,
    target: InheritanceConfigurationNode,
    nodes: readonly InheritanceConfigurationNode[],
    date: string,
  ): Promise<EffectiveConfigurationResolution> {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const chain: InheritanceConfigurationNode[] = [];
    const visited = new Set<string>();
    let current: InheritanceConfigurationNode | undefined = target;
    while (current) {
      if (visited.has(current.id)) throw new ConfigurationError("INHERITANCE_CYCLE", "Ciclo na configuração herdada.");
      visited.add(current.id);
      if (current.status !== "ACTIVE" || !isEffectiveAt(current, date)) {
        throw new ConfigurationError("INHERITANCE_NOT_EFFECTIVE", "A cadeia contém configuração inativa ou fora da vigência.");
      }
      chain.unshift(current);
      current = current.parentNodeId ? byId.get(current.parentNodeId) : undefined;
      if (!current && chain[0]?.parentNodeId) {
        throw new ConfigurationError("NOT_FOUND", "Nó pai de herança não encontrado na organização.");
      }
    }

    for (let index = 1; index < chain.length; index += 1) {
      if (LEVELS.indexOf(levelOf(chain[index]!)) <= LEVELS.indexOf(levelOf(chain[index - 1]!))) {
        throw new ConfigurationError("INVALID_INHERITANCE_ORDER", "A herança deve avançar do nível geral ao específico.");
      }
    }

    const values: ConfigurationJsonObject = {};
    const provenance: Record<string, ConfigurationProvenance> = {};
    for (const [index, node] of chain.entries()) {
      for (const [key, value] of Object.entries(node.values)) {
        values[key] = structuredClone(value);
        provenance[key] = {
          effective: structuredClone(value),
          origin: { nodeId: node.id, level: levelOf(node), scopeId: node.scopeId },
          inherited: index < chain.length - 1,
          override: provenance[key] !== undefined,
          ...(node.sourceVersion === undefined ? {} : { sourceVersion: node.sourceVersion }),
        };
      }
      for (const override of await this.repository.listInheritanceOverrides(organizationId, node.id)) {
        values[override.key] = structuredClone(override.value);
        provenance[override.key] = {
          effective: structuredClone(override.value),
          origin: { nodeId: node.id, level: levelOf(node), scopeId: node.scopeId },
          inherited: index < chain.length - 1,
          override: true,
          ...(node.sourceVersion === undefined ? {} : { sourceVersion: node.sourceVersion }),
        };
      }
    }
    return { values, provenance, chain: chain.map((node) => node.id) };
  }
}

function levelOf(node: InheritanceConfigurationNode): EffectiveInheritanceLevel {
  return node.hierarchyLevel ?? (node.level === "ORGANIZATION" ? "GLOBAL" : node.level);
}
