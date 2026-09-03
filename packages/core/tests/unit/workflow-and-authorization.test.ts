import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  decimalString,
  ExceptionService,
  InMemoryAuditRepository,
  InMemoryReconciliationRunRepository,
  SuggestionDecisionService,
  WorkflowRuleError,
  WorkflowService,
  summarizeReconciliationRun,
  type ActorContext,
  type ReconciliationRun,
} from "../../src/index.js";

const now = new Date("2025-12-31T12:00:00.000Z");
const preparer: ActorContext = { actorId: "preparer-1", companyRoles: { "company-1": ["PREPARER"] } };
const reviewer: ActorContext = { actorId: "reviewer-1", companyRoles: { "company-1": ["REVIEWER"] } };

const runFixture = (): ReconciliationRun => ({
  id: "run-1",
  companyId: "company-1",
  profileId: "profile-1",
  periodId: "period-2025-12",
  preparerId: "preparer-1",
  status: "PREPARING",
  createdAt: now,
  updatedAt: now,
  matchGroups: [],
  exceptions: [{
    id: "exception-1",
    reconciliationRunId: "run-1",
    type: "BANK_ONLY",
    status: "OPEN",
    candidateIds: [],
    evidenceIds: ["evidence-1"],
    createdAt: now,
    updatedAt: now,
  }],
});

describe("BR-11/BR-12 — exceções, workflow e autorização", () => {
  let runs: InMemoryReconciliationRunRepository;
  let audit: InMemoryAuditRepository;

  beforeEach(async () => {
    runs = new InMemoryReconciliationRunRepository();
    audit = new InMemoryAuditRepository();
    await runs.save(runFixture());
  });

  it("executa o fluxo completo com segregação entre preparador e revisor", async () => {
    const exceptions = new ExceptionService(runs, audit, () => now);
    await exceptions.execute("run-1", "exception-1", "ASSIGN", { assignedTo: "reviewer-1" }, reviewer);
    await exceptions.execute("run-1", "exception-1", "START_REVIEW", {}, reviewer);
    await exceptions.execute(
      "run-1",
      "exception-1",
      "RESOLVE",
      { resolutionCode: "VERIFIED", explanation: "Evidência bancária conferida" },
      reviewer,
    );

    const workflow = new WorkflowService(runs, audit, () => now);
    await workflow.transition("run-1", "SUBMIT", preparer);
    await workflow.transition("run-1", "START_REVIEW", reviewer);
    await workflow.transition("run-1", "APPROVE", reviewer, "Conferência concluída");
    const closed = await workflow.transition("run-1", "CLOSE", reviewer);

    expect(closed.status).toBe("CLOSED");
    expect(closed.reviewerId).toBe("reviewer-1");
    expect((await audit.list("RECONCILIATION_RUN", "run-1")).map((event) => event.action)).toEqual([
      "WORKFLOW_SUBMIT",
      "WORKFLOW_START_REVIEW",
      "WORKFLOW_APPROVE",
      "WORKFLOW_CLOSE",
    ]);
  });

  it("impede o preparador de revisar a própria conciliação", async () => {
    const dualRole: ActorContext = {
      actorId: "preparer-1",
      companyRoles: { "company-1": ["PREPARER", "REVIEWER"] },
    };
    const workflow = new WorkflowService(runs, audit, () => now);
    await workflow.transition("run-1", "SUBMIT", dualRole);

    await expect(workflow.transition("run-1", "START_REVIEW", dualRole)).rejects.toThrow(
      "O preparador não pode revisar",
    );
  });

  it("impede fechamento enquanto houver exceção aberta", async () => {
    const run = runFixture();
    run.status = "APPROVED";
    run.reviewerId = "reviewer-1";
    await runs.save(run);

    await expect(new WorkflowService(runs).transition("run-1", "CLOSE", reviewer)).rejects.toThrow(
      "exceções abertas",
    );
  });

  it("torna o agregado imutável após fechamento", async () => {
    const run = runFixture();
    run.status = "CLOSED";
    run.closedAt = now;
    run.exceptions[0]!.status = "RESOLVED";
    await runs.save(run);

    await expect(new ExceptionService(runs).execute(
      "run-1",
      "exception-1",
      "REJECT",
      { resolutionCode: "INVALID", explanation: "Tentativa tardia" },
      reviewer,
    )).rejects.toBeInstanceOf(WorkflowRuleError);
  });

  it("não aceita papel concedido em outra empresa", async () => {
    const outsider: ActorContext = {
      actorId: "outsider-1",
      companyRoles: { "company-2": ["ADMIN"] },
    };

    const workflow = new WorkflowService(runs);
    await workflow.transition("run-1", "SUBMIT", preparer);
    await expect(workflow.transition("run-1", "START_REVIEW", outsider)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("confirma sugestão 1:N somente na revisão e só então a inclui como conciliação manual", async () => {
    const run = runFixture();
    run.matchGroups.push({
      id: "suggestion-1",
      reconciliationRunId: run.id,
      ruleId: "RF-04",
      cardinality: "ONE_TO_MANY",
      confidence: 0.91,
      matchedStatementIds: ["statement-1"],
      matchedLedgerIds: ["ledger-1", "ledger-2"],
      amountDifference: decimalString("0.00"),
      status: "SUGGESTED",
      createdAt: now,
    });
    await runs.save(run);

    expect(summarizeReconciliationRun(run)).toMatchObject({ manualMatches: 0, suggestions: 1 });

    const updated = await new SuggestionDecisionService(runs, audit, () => now).execute(
      run.id,
      "suggestion-1",
      "APPROVE",
      {},
      reviewer,
    );

    expect(updated).toMatchObject({ status: "MANUALLY_CONFIRMED", actorId: reviewer.actorId });
    expect(summarizeReconciliationRun((await runs.findById(run.id))!)).toMatchObject({ manualMatches: 1, suggestions: 0 });
    expect(await audit.list("MATCH_GROUP", "suggestion-1")).toMatchObject([
      expect.objectContaining({
        action: "MATCH_GROUP_APPROVE",
        actorId: reviewer.actorId,
        before: { status: "SUGGESTED", actorId: undefined },
        after: { status: "MANUALLY_CONFIRMED", actorId: reviewer.actorId },
      }),
    ]);
  });

  it("exige revisor e justificativa para rejeitar uma sugestão", async () => {
    const run = runFixture();
    run.matchGroups.push({
      id: "suggestion-1",
      reconciliationRunId: run.id,
      ruleId: "RF-05",
      cardinality: "MANY_TO_ONE",
      confidence: 0.88,
      matchedStatementIds: ["statement-1", "statement-2"],
      matchedLedgerIds: ["ledger-1"],
      amountDifference: decimalString("0.00"),
      status: "SUGGESTED",
      createdAt: now,
    });
    await runs.save(run);
    const service = new SuggestionDecisionService(runs, audit, () => now);

    await expect(service.execute(run.id, "suggestion-1", "REJECT", { comment: "Não representa o lançamento consolidado" }, preparer))
      .rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.execute(run.id, "suggestion-1", "REJECT", {}, reviewer))
      .rejects.toThrow("A rejeição da sugestão exige uma justificativa");

    const rejected = await service.execute(
      run.id,
      "suggestion-1",
      "REJECT",
      { comment: "Não representa o lançamento consolidado" },
      reviewer,
    );

    expect(rejected).toMatchObject({ status: "REJECTED", actorId: reviewer.actorId });
    expect(summarizeReconciliationRun((await runs.findById(run.id))!)).toMatchObject({ manualMatches: 0, suggestions: 0 });
  });
});
