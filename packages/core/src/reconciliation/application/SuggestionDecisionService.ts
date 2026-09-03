import { randomUUID } from "node:crypto";
import type { AuditRepository } from "../../audit/domain/AuditEvent.js";
import { assertCompanyRole, type ActorContext } from "../../shared/domain/Authorization.js";
import type { MatchGroup } from "../domain/ReconciliationRun.js";
import type { ReconciliationRunRepository } from "../domain/ReconciliationRunRepository.js";
import { WorkflowRuleError } from "./WorkflowService.js";

export type SuggestionDecision = "APPROVE" | "REJECT";

export interface SuggestionDecisionCommand {
  comment?: string;
}

export class SuggestionDecisionService {
  constructor(
    private readonly runs: ReconciliationRunRepository,
    private readonly audit?: AuditRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    runId: string,
    groupId: string,
    decision: SuggestionDecision,
    command: SuggestionDecisionCommand,
    actor: ActorContext,
  ): Promise<MatchGroup> {
    const run = await this.runs.findById(runId);
    if (!run) throw new WorkflowRuleError("Conciliação não encontrada");
    if (run.status === "CLOSED") throw new WorkflowRuleError("Uma conciliação fechada é imutável");

    assertCompanyRole(actor, run.companyId, ["REVIEWER", "ADMIN"]);
    if (actor.actorId === run.preparerId && !this.isAdmin(actor, run.companyId)) {
      throw new WorkflowRuleError("O preparador não pode decidir as próprias sugestões");
    }

    const index = run.matchGroups.findIndex((group) => group.id === groupId);
    if (index < 0) throw new WorkflowRuleError("Sugestão de agrupamento não encontrada");

    const current = run.matchGroups[index]!;
    if (current.status !== "SUGGESTED") {
      throw new WorkflowRuleError("Somente sugestões pendentes podem receber uma decisão");
    }
    if (!["ONE_TO_MANY", "MANY_TO_ONE"].includes(current.cardinality)) {
      throw new WorkflowRuleError("A decisão manual é permitida somente para sugestões 1:N ou N:1");
    }
    if (decision === "REJECT" && !command.comment?.trim()) {
      throw new WorkflowRuleError("A rejeição da sugestão exige uma justificativa");
    }

    const now = this.clock();
    const updated: MatchGroup = {
      ...current,
      status: decision === "APPROVE" ? "MANUALLY_CONFIRMED" : "REJECTED",
      actorId: actor.actorId,
    };
    run.matchGroups[index] = updated;
    run.updatedAt = now;
    await this.runs.save(run);
    await this.audit?.append({
      id: randomUUID(),
      companyId: run.companyId,
      entityType: "MATCH_GROUP",
      entityId: current.id,
      action: `MATCH_GROUP_${decision}`,
      actorId: actor.actorId,
      occurredAt: now,
      before: { status: current.status, actorId: current.actorId },
      after: { status: updated.status, actorId: updated.actorId },
      ...(command.comment?.trim() ? { metadata: { comment: command.comment.trim() } } : {}),
    });
    return updated;
  }

  private isAdmin(actor: ActorContext, companyId: string): boolean {
    return (actor.companyRoles[companyId] ?? []).includes("ADMIN");
  }
}
