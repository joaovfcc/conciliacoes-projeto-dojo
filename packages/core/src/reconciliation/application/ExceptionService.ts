import { randomUUID } from "node:crypto";
import type { AuditRepository } from "../../audit/domain/AuditEvent.js";
import { assertCompanyRole, type ActorContext } from "../../shared/domain/Authorization.js";
import type { ReconciliationException, ExceptionStatus } from "../domain/ReconciliationRun.js";
import type { ReconciliationRunRepository } from "../domain/ReconciliationRunRepository.js";
import { WorkflowRuleError } from "./WorkflowService.js";

export type ExceptionAction = "ASSIGN" | "START_REVIEW" | "RESOLVE" | "ACCEPT_TIMING_DIFFERENCE" | "REJECT";

export interface ExceptionCommand {
  assignedTo?: string;
  dueDate?: Date;
  resolutionCode?: string;
  explanation?: string;
}

export class ExceptionService {
  constructor(
    private readonly runs: ReconciliationRunRepository,
    private readonly audit?: AuditRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    runId: string,
    exceptionId: string,
    action: ExceptionAction,
    command: ExceptionCommand,
    actor: ActorContext,
  ): Promise<ReconciliationException> {
    const run = await this.runs.findById(runId);
    if (!run) throw new WorkflowRuleError("Conciliação não encontrada");
    if (run.status === "CLOSED") throw new WorkflowRuleError("Uma conciliação fechada é imutável");
    assertCompanyRole(actor, run.companyId, ["PREPARER", "REVIEWER", "ADMIN"]);
    const index = run.exceptions.findIndex((exception) => exception.id === exceptionId);
    if (index < 0) throw new WorkflowRuleError("Exceção não encontrada");

    const current = run.exceptions[index]!;
    const updated = this.apply(current, action, command, actor.actorId);
    run.exceptions[index] = updated;
    run.updatedAt = this.clock();
    await this.runs.save(run);
    await this.audit?.append({
      id: randomUUID(),
      companyId: run.companyId,
      entityType: "RECONCILIATION_EXCEPTION",
      entityId: exceptionId,
      action: `EXCEPTION_${action}`,
      actorId: actor.actorId,
      occurredAt: run.updatedAt,
      before: current,
      after: updated,
    });
    return updated;
  }

  private apply(
    current: ReconciliationException,
    action: ExceptionAction,
    command: ExceptionCommand,
    actorId: string,
  ): ReconciliationException {
    const transitions: Record<ExceptionAction, readonly ExceptionStatus[]> = {
      ASSIGN: ["OPEN", "ASSIGNED"],
      START_REVIEW: ["ASSIGNED"],
      RESOLVE: ["ASSIGNED", "UNDER_REVIEW"],
      ACCEPT_TIMING_DIFFERENCE: ["ASSIGNED", "UNDER_REVIEW"],
      REJECT: ["ASSIGNED", "UNDER_REVIEW"],
    };
    if (!transitions[action].includes(current.status)) {
      throw new WorkflowRuleError(`A ação ${action} não é permitida para uma exceção ${current.status}`);
    }
    if (action === "ASSIGN" && !command.assignedTo?.trim()) {
      throw new WorkflowRuleError("A atribuição exige um responsável");
    }
    if (action === "START_REVIEW" && current.assignedTo !== actorId) {
      throw new WorkflowRuleError("Somente o responsável atribuído pode iniciar a revisão");
    }
    if (["RESOLVE", "ACCEPT_TIMING_DIFFERENCE", "REJECT"].includes(action)
      && (!command.resolutionCode?.trim() || !command.explanation?.trim())) {
      throw new WorkflowRuleError("A conclusão da exceção exige código de resolução e explicação");
    }

    const status: ExceptionStatus = action === "ASSIGN"
      ? "ASSIGNED"
      : action === "START_REVIEW"
        ? "UNDER_REVIEW"
        : action === "RESOLVE"
          ? "RESOLVED"
          : action === "ACCEPT_TIMING_DIFFERENCE"
            ? "ACCEPTED_TIMING_DIFFERENCE"
            : "REJECTED";
    return {
      ...current,
      status,
      ...(command.assignedTo ? { assignedTo: command.assignedTo } : {}),
      ...(command.dueDate ? { dueDate: command.dueDate } : {}),
      ...(command.resolutionCode ? { resolutionCode: command.resolutionCode } : {}),
      ...(command.explanation ? { explanation: command.explanation } : {}),
      updatedAt: this.clock(),
    };
  }
}
