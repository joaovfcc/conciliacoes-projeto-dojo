import { describe, expect, it } from "vitest";
import {
  AdvisorOrchestrator,
  FakeMatchAdvisor,
  reconcile,
  type AccountMapping,
  type AdvisorRequestV1,
  type ConfirmProcessingRequest,
  type LedgerRecord,
  type ReconciliationResult,
  type StatementRecord,
} from "../../packages/core/src/index";

function makeLedger(id: string, date: string, value: string, history: string): LedgerRecord {
  return {
    id,
    company: "1",
    branch: "01",
    ledgerAccount: "1.1.1.01.001",
    date,
    document: "DOC-100",
    history,
    value,
    sourceId: "src-l",
    evidence: {
      fileId: "f-stmt-1",
      originalName: "razao.xlsx",
      line: 12,
      extractionMethod: "TABULAR",
    },
  };
}

function makeStatement(id: string, date: string, value: string, history: string): StatementRecord {
  return {
    id,
    bank: "341",
    agency: "1234",
    bankAccount: "56789-0",
    date,
    document: "DOC-100",
    history,
    value,
    sourceId: "src-s",
    evidence: {
      fileId: "f-stmt-1",
      originalName: "extrato.xlsx",
      line: 45,
      extractionMethod: "TABULAR",
    },
  };
}

const mapping: AccountMapping = {
  ledgerAccount: "1.1.1.01.001",
  statementFileIds: ["f-stmt-1"],
  signProfile: "BANK_ASSET",
};

const confirmation: ConfirmProcessingRequest = {
  company: "1",
  period: "202603",
  valueTolerance: "0.00",
  dateToleranceDays: 3,
  mappings: [mapping],
  idempotencyKey: "test-integration-1",
};

describe("Integração LlmMatchAdvisor com Pipeline de Conciliação", () => {
  it("executa o pipeline completo com ambiguidade de valores: reconcile -> candidate generation -> fake advisor -> validation -> review results", async () => {
    // 1 match exato de valor único (RF-02)
    const exactL = makeLedger("l-exact", "2026-03-05", "100.00", "PAGTO FORN A");
    const exactS = makeStatement("s-exact", "2026-03-05", "-100.00", "PAGTO FORN A");

    // 2 lançamentos no razão com mesmo valor (750.00) e 1 no extrato (-750.00) -> gera AMBIGUOUS_MATCH no motor
    const ambL1 = makeLedger("l-amb-1", "2026-03-10", "750.00", "HONORARIOS ADVOCATICIOS REF MARCO");
    const ambL2 = makeLedger("l-amb-2", "2026-03-10", "750.00", "CONSULTORIA CONTABIL REF MARCO");
    const ambS = makeStatement("s-amb-1", "2026-03-10", "-750.00", "DEB SERV JURIDICOS SOCIEDADE ADV");

    const ledgers = [exactL, ambL1, ambL2];
    const statements = [exactS, ambS];

    // Passo 1: Motor determinístico
    const baseResult = reconcile(ledgers, statements, confirmation);

    // Deve ter 1 match exato automático e itens em AMBIGUOUS_MATCH
    expect(baseResult.results.some((r: ReconciliationResult) => r.status === "AUTO_MATCH_EXACT" && r.decisionLevel === "AUTOMATIC")).toBe(true);
    expect(baseResult.results.some((r: ReconciliationResult) => r.status === "AMBIGUOUS_MATCH")).toBe(true);

    // Passo 2: Execução do Advisor em modo REVIEW
    const fakeAdvisor = new FakeMatchAdvisor({
      handler: (req: AdvisorRequestV1) => {
        const group = req.groups[0]!;
        // A IA analisa o histórico e identifica que l-amb-1 (Honorários advocatícios) é o par de s-amb-1 (Serviços jurídicos)
        return {
          contractVersion: "1.0",
          requestId: req.requestId,
          provider: "simulated-n8n",
          model: "simulated-v1",
          promptVersion: req.promptVersion,
          suggestions: [
            {
              groupId: group.groupId,
              anchorId: group.anchorId,
              candidateIds: ["l-amb-1"],
              decision: "SUGGEST_MATCH",
              confidenceBps: 9100,
              reasonCode: "HISTORY_SIMILARITY",
              explanationPtBr: "Honorários advocatícios e serviços jurídicos possuem relação semântica direta.",
            },
          ],
        };
      },
    });

    const orchestrator = new AdvisorOrchestrator();
    const { result: finalResult, metrics } = await orchestrator.execute(
      baseResult,
      ledgers,
      statements,
      [mapping],
      fakeAdvisor,
      { mode: "REVIEW" },
    );

    expect(metrics.suggestionsValidated).toBe(1);

    const exactMatch = finalResult.results.find((r: ReconciliationResult) => r.status === "AUTO_MATCH_EXACT");
    expect(exactMatch).toBeDefined();
    expect(exactMatch!.decisionLevel).toBe("AUTOMATIC");

    const suggestionMatch = finalResult.results.find((r: ReconciliationResult) => r.status === "VALUE_ONLY_SUGGESTION");
    expect(suggestionMatch).toBeDefined();
    expect(suggestionMatch!.decisionLevel).toBe("REVIEW_REQUIRED");
    expect(suggestionMatch!.rule).toBe("AI-ADVISOR-V1");
    expect(suggestionMatch!.ledger?.id).toBe("l-amb-1");
    expect(suggestionMatch!.statement?.id).toBe("s-amb-1");
    expect(suggestionMatch!.reason).toContain("Honorários advocatícios");
  });

  it("garante fallback determinístico intacto caso o advisor lance erro de timeout ou rede", async () => {
    // 2 lançamentos no razão e 1 no extrato com mesmo valor (gera AMBIGUOUS_MATCH elegível para o advisor)
    const l1 = makeLedger("l-1", "2026-03-10", "300.00", "SERVICO A");
    const l2 = makeLedger("l-2", "2026-03-10", "300.00", "SERVICO B");
    const s1 = makeStatement("s-1", "2026-03-10", "-300.00", "SERVICO X");

    const baseResult = reconcile([l1, l2], [s1], confirmation);

    const failingAdvisor = new FakeMatchAdvisor({
      errorToThrow: new Error("Falha simulada de rede n8n"),
    });

    const orchestrator = new AdvisorOrchestrator();
    const { result, metrics } = await orchestrator.execute(
      baseResult,
      [l1, l2],
      [s1],
      [mapping],
      failingAdvisor,
      { mode: "REVIEW" },
    );

    expect(metrics.error).toBeDefined();
    expect(metrics.error).toContain("Falha simulada de rede n8n");
    expect(result.results).toEqual(baseResult.results);
  });
});
