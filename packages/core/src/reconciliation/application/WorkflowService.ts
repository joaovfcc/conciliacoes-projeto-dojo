import { randomUUID } from "node:crypto";
import type { AuditRepository } from "../../audit/domain/AuditEvent.js";
import {
  assertCompanyRole,
  AuthorizationError,
  type ActorContext,
} from "../../shared/domain/Authorization.js";
import type { ReconciliationRunRepository } from "../domain/ReconciliationRunRepository.js";
import type { ReconciliationRun, ReconciliationRunStatus } from "../domain/ReconciliationRun.js";

export type WorkflowAction = "SUBMIT" | "START_REVIEW" | "APPROVE" | "REJECT" | "REOPEN" | "CLOSE";

export class WorkflowRuleError extends Error {
  readonly code = "INVALID_WORKFLOW_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "WorkflowRuleError";
  }
}

export class WorkflowService {
  constructor(
    private readonly runs: ReconciliationRunRepository,
    private readonly audit?: AuditRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async transition(
    runId: string,
    action: WorkflowAction,
    actor: ActorContext,
    comment?: string,
  ): Promise<ReconciliationRun> {
    const run = await this.runs.findById(runId);
    if (!run) throw new WorkflowRuleError("Conciliação não encontrada");
    if (run.status === "CLOSED") throw new WorkflowRuleError("Uma conciliação fechada é imutável");

    const before = structuredClone(run);
    const now = this.clock();
    const next = this.apply(run, action, actor, comment, now);
    next.updatedAt = now;
    await this.runs.save(next);
    await this.audit?.append({
      id: randomUUID(),
      companyId: next.companyId,
      entityType: "RECONCILIATION_RUN",
      entityId: next.id,
      action: `WORKFLOW_${action}`,
      actorId: actor.actorId,
      occurredAt: now,
      before: { status: before.status, reviewerId: before.reviewerId },
      after: { status: next.status, reviewerId: next.reviewerId },
      ...(comment ? { metadata: { comment } } : {}),
    });
    return next;
  }

  private apply(
    run: ReconciliationRun,
    action: WorkflowAction,
    actor: ActorContext,
    comment: string | undefined,
    now: Date,
  ): ReconciliationRun {
    const expected: Record<WorkflowAction, ReconciliationRunStatus[]> = {
      SUBMIT: ["PREPARING"],
      START_REVIEW: ["READY_FOR_REVIEW"],
      APPROVE: ["UNDER_REVIEW"],
      REJECT: ["UNDER_REVIEW"],
      REOPEN: ["REJECTED"],
      CLOSE: ["APPROVED"],
    };
    if (!expected[action].includes(run.status)) {
      throw new WorkflowRuleError(`A ação ${action} não é permitida no estado ${run.status}`);
    }

    if (action === "SUBMIT" || action === "REOPEN") {
      assertCompanyRole(actor, run.companyId, ["PREPARER", "ADMIN"]);
      if (actor.actorId !== run.preparerId && !this.isAdmin(actor, run.companyId)) {
        throw new AuthorizationError("Somente o preparador responsável pode enviar ou reabrir a conciliação");
      }
    } else {
      assertCompanyRole(actor, run.companyId, ["REVIEWER", "ADMIN"]);
    }

    if (["START_REVIEW", "APPROVE", "REJECT", "CLOSE"].includes(action) && actor.actorId === run.preparerId) {
      throw new WorkflowRuleError("O preparador não pode revisar, aprovar nem fechar a própria conciliação");
    }
    if ((action === "APPROVE" || action === "REJECT") && run.reviewerId !== actor.actorId && !this.isAdmin(actor, run.companyId)) {
      throw new AuthorizationError("Somente o revisor responsável pode concluir a revisão");
    }
    if ((action === "REJECT" || action === "REOPEN") && !comment?.trim()) {
      throw new WorkflowRuleError("A rejeição e a reabertura exigem comentário");
    }
    if (action === "CLOSE" && run.exceptions.some((exception) => !["RESOLVED", "ACCEPTED_TIMING_DIFFERENCE", "REJECTED"].includes(exception.status))) {
      throw new WorkflowRuleError("Não é permitido fechar uma conciliação com exceções abertas");
    }

    switch (action) {
      case "SUBMIT":
        return { ...run, status: "READY_FOR_REVIEW", submittedAt: now, ...(comment ? { comments: comment } : {}) };
      case "START_REVIEW":
        return { ...run, status: "UNDER_REVIEW", reviewerId: actor.actorId };
      case "APPROVE":
        return { ...run, status: "APPROVED", approvedAt: now, ...(comment ? { comments: comment } : {}) };
      case "REJECT":
        return { ...run, status: "REJECTED", comments: comment! };
      case "REOPEN": {
        const { reviewerId: _reviewerId, approvedAt: _approvedAt, ...reopened } = run;
        return { ...reopened, status: "PREPARING", comments: comment! };
      }
      case "CLOSE":
        return { ...run, status: "CLOSED", closedAt: now, ...(comment ? { comments: comment } : {}) };
    }
  }

  private isAdmin(actor: ActorContext, companyId: string): boolean {
    return (actor.companyRoles[companyId] ?? []).includes("ADMIN");
  }
}
