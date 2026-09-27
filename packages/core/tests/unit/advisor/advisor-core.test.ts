import { describe, expect, it } from "vitest";
import {
  AdvisorCandidateGenerator,
  AdvisorEvidenceRehydrator,
  AdvisorOrchestrator,
  AdvisorResponseValidator,
  DisabledMatchAdvisor,
  FakeMatchAdvisor,
  type AccountMapping,
  type AdvisorRequestV1,
  type AdvisorResponseV1,
  type LedgerRecord,
  type ProcessingResult,
  type ReconciliationResult,
  type StatementRecord,
} from "../../../src/index.js";

function makeLedger(id: string, date: string, value: string, history = "PAGTO FORNECEDOR"): LedgerRecord {
  return {
    id,
    company: "1",
    branch: "01",
    ledgerAccount: "1.1.1.01.001",
    date,
    document: "DOC123",
    history,
    value,
    sourceId: "src-ledger",
    evidence: {
      fileId: "f-ledger",
      originalName: "razao.xlsx",
      line: 10,
      extractionMethod: "TABULAR",
    },
  };
}

function makeStatement(id: string, date: string, value: string, history = "DEB DIVERSOS"): StatementRecord {
  return {
    id,
    bank: "341",
    agency: "1234",
    bankAccount: "56789-0",
    date,
    document: "DOC123",
    history,
    value,
    sourceId: "src-statement",
    evidence: {
      fileId: "f-statement",
      originalName: "extrato.xlsx",
      line: 25,
      extractionMethod: "TABULAR",
    },
  };
}

const mockMapping: AccountMapping = {
  ledgerAccount: "1.1.1.01.001",
  statementFileIds: ["f-statement"],
  signProfile: "BANK_ASSET",
};

describe("Advisor Candidate Generator", () => {
  const generator = new AdvisorCandidateGenerator();

  it("gera candidatos a partir de grupos de ambiguidade (AMBIGUOUS_MATCH)", () => {
    const l1 = makeLedger("ldg-1", "2026-03-10", "150.00");
    const l2 = makeLedger("ldg-2", "2026-03-10", "150.00");
    const s1 = makeStatement("stmt-1", "2026-03-10", "-150.00");

    const results: ReconciliationResult[] = [
      {
        id: "res-amb-1",
        status: "AMBIGUOUS_MATCH",
        rule: "RF-09",
        decisionLevel: "REVIEW_REQUIRED",
        reason: "Ambiguidade de mesmo valor",
        statement: s1,
        valueTolerance: "0.00",
        ambiguityGroup: {
          id: "amb-1",
          ledgerAccount: "1.1.1.01.001",
          amount: "150.00",
          ledgerCandidateIds: ["ldg-1", "ldg-2"],
          statementCandidateIds: ["stmt-1"],
          reason: "2 lançamentos no razão e 1 no extrato com mesmo valor",
          evaluatedAt: "2026-03-10T00:00:00.000Z",
        },
      },
    ];

    const request = generator.generate(results, [l1, l2], [s1], [mockMapping], {
      period: "2026-03",
    });

    expect(request.contractVersion).toBe("1.0");
    expect(request.groups).toHaveLength(1);
    expect(request.groups[0]!.entries).toHaveLength(3);
    expect(request.groups[0]!.entries.some((e) => e.id === "stmt-1")).toBe(true);
    expect(request.groups[0]!.entries.some((e) => e.id === "ldg-1")).toBe(true);
    expect(request.groups[0]!.entries.some((e) => e.id === "ldg-2")).toBe(true);
  });

  it("gera candidatos de âncora de extrato sem razão (STATEMENT_WITHOUT_LEDGER)", () => {
    const l1 = makeLedger("ldg-1", "2026-03-12", "500.00", "PAGTO ALUGUEL");
    const s1 = makeStatement("stmt-1", "2026-03-10", "-500.00", "DEB ALUGUEL SALA");

    const results: ReconciliationResult[] = [
      {
        id: "res-stmt-1",
        status: "STATEMENT_WITHOUT_LEDGER",
        rule: "RF-09",
        decisionLevel: "REVIEW_REQUIRED",
        reason: "Extrato sem razão",
        statement: s1,
        valueTolerance: "0.00",
      },
      {
        id: "res-ldg-1",
        status: "LEDGER_WITHOUT_STATEMENT",
        rule: "RF-09",
        decisionLevel: "REVIEW_REQUIRED",
        reason: "Razão sem extrato",
        ledger: l1,
        valueTolerance: "0.00",
      },
    ];

    const request = generator.generate(results, [l1], [s1], [mockMapping], {
      period: "2026-03",
    });

    expect(request.groups.length).toBeGreaterThanOrEqual(1);
    const stmtGroup = request.groups.find((g) => g.anchorId === "stmt-1");
    expect(stmtGroup).toBeDefined();
    expect(stmtGroup!.entries.some((e) => e.id === "ldg-1")).toBe(true);
  });
});

describe("Advisor Response Validator", () => {
  const validator = new AdvisorResponseValidator();
  const l1 = makeLedger("ldg-1", "2026-03-10", "200.00");
  const s1 = makeStatement("stmt-1", "2026-03-10", "-200.00");

  const baseRequest: AdvisorRequestV1 = {
    contractVersion: "1.0",
    requestId: "req-123",
    idempotencyKey: "idem-123",
    period: "2026-03",
    currency: "BRL",
    promptVersion: "match-advisor-v1",
    groups: [
      {
        groupId: "grp-1",
        anchorId: "stmt-1",
        entries: [
          {
            id: "stmt-1",
            source: "STATEMENT",
            date: "2026-03-10",
            amountCents: "-20000",
            document: "DOC123",
            normalizedHistory: "DEB DIVERSOS",
          },
          {
            id: "ldg-1",
            source: "LEDGER",
            date: "2026-03-10",
            amountCents: "-20000",
            document: "DOC123",
            normalizedHistory: "PAGTO FORNECEDOR",
          },
        ],
      },
    ],
  };

  it("valida com sucesso sugestão correta e equilibrada", () => {
    const validResponse: AdvisorResponseV1 = {
      contractVersion: "1.0",
      requestId: "req-123",
      provider: "test-llm",
      model: "test-model-v1",
      promptVersion: "match-advisor-v1",
      suggestions: [
        {
          groupId: "grp-1",
          anchorId: "stmt-1",
          candidateIds: ["ldg-1"],
          decision: "SUGGEST_MATCH",
          confidenceBps: 9000,
          reasonCode: "HISTORY_SIMILARITY",
          explanationPtBr: "Histórico e valores compatíveis.",
        },
      ],
    };

    const res = validator.validate(validResponse, baseRequest, [l1], [s1], [mockMapping]);
    expect(res.rejectedSuggestions).toHaveLength(0);
    expect(res.validSuggestions).toHaveLength(1);
    expect(res.validSuggestions[0]!.anchorId).toBe("stmt-1");
    expect(res.validSuggestions[0]!.candidateIds).toEqual(["ldg-1"]);
  });

  it("rejeita sugestão com ID desconhecido ou inventado (fail-closed)", () => {
    const invalidResponse: AdvisorResponseV1 = {
      contractVersion: "1.0",
      requestId: "req-123",
      provider: "test-llm",
      model: "test-model-v1",
      promptVersion: "match-advisor-v1",
      suggestions: [
        {
          groupId: "grp-1",
          anchorId: "stmt-1",
          candidateIds: ["ID_INVENTADO_999"],
          decision: "SUGGEST_MATCH",
          confidenceBps: 9500,
          reasonCode: "HISTORY_SIMILARITY",
          explanationPtBr: "Sugestão com ID inválido.",
        },
      ],
    };

    const res = validator.validate(invalidResponse, baseRequest, [l1], [s1], [mockMapping]);
    expect(res.validSuggestions).toHaveLength(0);
    expect(res.rejectedSuggestions).toHaveLength(1);
    expect(res.rejectedSuggestions[0]!.code).toBe("ADVISOR_UNKNOWN_ID");
  });

  it("rejeita sugestão com divergência matemática em centavos", () => {
    const l2 = makeLedger("ldg-2", "2026-03-10", "300.00"); // 300 != 200
    const reqWithLdg2: AdvisorRequestV1 = {
      ...baseRequest,
      groups: [
        {
          groupId: "grp-1",
          anchorId: "stmt-1",
          entries: [
            ...baseRequest.groups[0]!.entries,
            {
              id: "ldg-2",
              source: "LEDGER",
              date: "2026-03-10",
              amountCents: "-30000",
              document: "DOC999",
              normalizedHistory: "OUTRO PAGTO",
            },
          ],
        },
      ],
    };

    const mismatchResponse: AdvisorResponseV1 = {
      contractVersion: "1.0",
      requestId: "req-123",
      provider: "test-llm",
      model: "test-model-v1",
      promptVersion: "match-advisor-v1",
      suggestions: [
        {
          groupId: "grp-1",
          anchorId: "stmt-1",
          candidateIds: ["ldg-2"],
          decision: "SUGGEST_MATCH",
          confidenceBps: 9000,
          reasonCode: "HISTORY_SIMILARITY",
          explanationPtBr: "Valores diferentes mas sugeridos erroneamente.",
        },
      ],
    };

    const res = validator.validate(mismatchResponse, reqWithLdg2, [l1, l2], [s1], [mockMapping]);
    expect(res.validSuggestions).toHaveLength(0);
    expect(res.rejectedSuggestions).toHaveLength(1);
    expect(res.rejectedSuggestions[0]!.code).toBe("ADVISOR_AMOUNT_MISMATCH");
  });
});

describe("Advisor Evidence Rehydrator & Orchestrator", () => {
  const orchestrator = new AdvisorOrchestrator();

  it("preserva 100% dos resultados determinísticos em modo DISABLED", async () => {
    const l1 = makeLedger("ldg-1", "2026-03-10", "200.00");
    const s1 = makeStatement("stmt-1", "2026-03-10", "-200.00");

    const baseResult: ProcessingResult = {
      company: "1",
      branch: "01",
      period: "2026-03",
      executedAt: "2026-03-10T00:00:00.000Z",
      summaries: [],
      results: [
        {
          id: "res-1",
          status: "AUTO_MATCH_EXACT",
          rule: "RF-02",
          decisionLevel: "AUTOMATIC",
          reason: "Match exato 1:1",
          ledger: l1,
          statement: s1,
          valueTolerance: "0.00",
        },
      ],
      issues: [],
      files: [],
      investments: [],
      controls: {
        tolerance: "0.00",
        signProfiles: ["BANK_ASSET"],
        movements: { bankConciliable: "-200.00", ledger: "200.00", difference: "0.00", status: "PASSED" },
        balances: { openingStatus: "NOT_AVAILABLE", closingStatus: "NOT_AVAILABLE" },
        coverage: {
          lines: { covered: "2", total: "2", percentage: "100.00" },
          absoluteValue: { covered: "200.00", total: "200.00", percentage: "100.00" },
        },
        countsByStatus: [{ status: "AUTO_MATCH_EXACT", count: "1" }],
        pendingByDate: [],
      },
    };

    const disabledAdvisor = new DisabledMatchAdvisor();
    const { result, metrics } = await orchestrator.execute(
      baseResult,
      [l1],
      [s1],
      [mockMapping],
      disabledAdvisor,
      { mode: "DISABLED" },
    );

    expect(metrics.mode).toBe("DISABLED");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.status).toBe("AUTO_MATCH_EXACT");
  });

  it("injeta sugestão com REVIEW_REQUIRED em modo REVIEW sem alterar matches automáticos", async () => {
    const l1 = makeLedger("ldg-1", "2026-03-10", "500.00", "ALUGUEL MARCO");
    const s1 = makeStatement("stmt-1", "2026-03-10", "-500.00", "DEB ALUGUEL SALA 101");

    const baseResult: ProcessingResult = {
      company: "1",
      branch: "01",
      period: "2026-03",
      executedAt: "2026-03-10T00:00:00.000Z",
      summaries: [
        {
          ledgerAccount: "1.1.1.01.001",
          statementAccounts: ["56789-0"],
          ledgerBalance: "500.00",
          statementBalance: "-500.00",
          balanceDifference: "0.00",
          reconciledCount: 0,
          reconciledValue: "0.00",
          divergenceCount: 2,
          ledgerWithoutStatementCount: 1,
          statementWithoutLedgerCount: 1,
          ambiguityCount: 0,
          duplicateCount: 0,
          status: "COM_DIVERGENCIAS",
        },
      ],
      results: [
        {
          id: "res-stmt",
          status: "STATEMENT_WITHOUT_LEDGER",
          rule: "RF-09",
          decisionLevel: "REVIEW_REQUIRED",
          reason: "Extrato sem razão",
          statement: s1,
          valueTolerance: "0.00",
        },
        {
          id: "res-ldg",
          status: "LEDGER_WITHOUT_STATEMENT",
          rule: "RF-09",
          decisionLevel: "REVIEW_REQUIRED",
          reason: "Razão sem extrato",
          ledger: l1,
          valueTolerance: "0.00",
        },
      ],
      issues: [],
      files: [],
      investments: [],
      controls: {
        tolerance: "0.00",
        signProfiles: ["BANK_ASSET"],
        movements: { bankConciliable: "-500.00", ledger: "500.00", difference: "0.00", status: "PASSED" },
        balances: { openingStatus: "NOT_AVAILABLE", closingStatus: "NOT_AVAILABLE" },
        coverage: {
          lines: { covered: "0", total: "2", percentage: "0.00" },
          absoluteValue: { covered: "0.00", total: "500.00", percentage: "0.00" },
        },
        countsByStatus: [
          { status: "STATEMENT_WITHOUT_LEDGER", count: "1" },
          { status: "LEDGER_WITHOUT_STATEMENT", count: "1" },
        ],
        pendingByDate: [],
      },
    };

    const fakeAdvisor = new FakeMatchAdvisor({
      handler: (req) => ({
        contractVersion: "1.0",
        requestId: req.requestId,
        provider: "test-llm",
        model: "gpt-4o-mini",
        promptVersion: req.promptVersion,
        suggestions: [
          {
            groupId: req.groups[0]!.groupId,
            anchorId: req.groups[0]!.anchorId,
            candidateIds: [req.groups[0]!.entries.find((e) => e.id !== req.groups[0]!.anchorId)!.id],
            decision: "SUGGEST_MATCH",
            confidenceBps: 8800,
            reasonCode: "HISTORY_SIMILARITY",
            explanationPtBr: "Histórico de aluguel condizente entre razão e extrato.",
          },
        ],
      }),
    });

    const { result, metrics } = await orchestrator.execute(
      baseResult,
      [l1],
      [s1],
      [mockMapping],
      fakeAdvisor,
      { mode: "REVIEW" },
    );

    expect(metrics.suggestionsValidated).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.status).toBe("VALUE_ONLY_SUGGESTION");
    expect(result.results[0]!.decisionLevel).toBe("REVIEW_REQUIRED");
    expect(result.results[0]!.reason).toContain("Sugestão da IA");
    expect(result.results[0]!.ledger?.id).toBe("ldg-1");
    expect(result.results[0]!.statement?.id).toBe("stmt-1");

    // Verifica que sumário contabilizou a sugestão sem alterar reconciledCount
    expect(result.summaries[0]!.reconciledCount).toBe(0);
    expect(result.summaries[0]!.suggestedGroupCount).toBe(1);
  });
});
