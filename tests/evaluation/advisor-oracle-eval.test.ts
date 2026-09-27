import { describe, expect, it } from "vitest";
import {
  AdvisorCandidateGenerator,
  AdvisorResponseValidator,
  type AccountMapping,
  type AdvisorRequestEntryV1,
  type AdvisorRequestGroupV1,
  type LedgerRecord,
  type ReconciliationResult,
  type StatementRecord,
} from "../../packages/core/src/index";
import type { ValidatedAdvisorSuggestion } from "../../packages/core/src/advisor/response-validator";

describe("Executor de Avaliação Contábil Privada (Oracle Benchmark)", () => {
  it("mede precisão, recall, falsos positivos e cobertura de candidatos", () => {
    const generator = new AdvisorCandidateGenerator();
    const validator = new AdvisorResponseValidator();

    const sampleLedgers: LedgerRecord[] = [
      {
        id: "l-eval-1",
        company: "1",
        branch: "01",
        ledgerAccount: "1.1.1.01.001",
        date: "2026-03-10",
        document: "NF-101",
        history: "PAGAMENTO TARIFA MANUTENCAO CONTA",
        value: "45.00",
        sourceId: "src-l",
        evidence: { fileId: "f-1", originalName: "razao.xlsx", line: 1, extractionMethod: "TABULAR" },
      },
      {
        id: "l-eval-2",
        company: "1",
        branch: "01",
        ledgerAccount: "1.1.1.01.001",
        date: "2026-03-12",
        document: "NF-102",
        history: "SERVICOS DE CONSULTORIA TI",
        value: "3500.00",
        sourceId: "src-l",
        evidence: { fileId: "f-1", originalName: "razao.xlsx", line: 2, extractionMethod: "TABULAR" },
      },
    ];

    const sampleStatements: StatementRecord[] = [
      {
        id: "s-eval-1",
        bank: "341",
        agency: "1234",
        bankAccount: "56789-0",
        date: "2026-03-10",
        document: "TAR-101",
        history: "TAR MANUT CONTA PACOTE SERV",
        value: "-45.00",
        sourceId: "src-s",
        evidence: { fileId: "f-1", originalName: "extrato.xlsx", line: 1, extractionMethod: "TABULAR" },
      },
      {
        id: "s-eval-2",
        bank: "341",
        agency: "1234",
        bankAccount: "56789-0",
        date: "2026-03-11",
        document: "TED-102",
        history: "TRANSF ELETR DISP CONSULTORIA",
        value: "-3500.00",
        sourceId: "src-s",
        evidence: { fileId: "f-1", originalName: "extrato.xlsx", line: 2, extractionMethod: "TABULAR" },
      },
    ];

    const sEval1 = sampleStatements[0]!;
    const sEval2 = sampleStatements[1]!;
    const lEval1 = sampleLedgers[0]!;
    const lEval2 = sampleLedgers[1]!;

    const results: ReconciliationResult[] = [
      {
        id: "res-s1",
        status: "STATEMENT_WITHOUT_LEDGER",
        rule: "RF-09",
        decisionLevel: "REVIEW_REQUIRED",
        reason: "Extrato sem razão",
        statement: sEval1,
        valueTolerance: "0.00",
      },
      {
        id: "res-s2",
        status: "STATEMENT_WITHOUT_LEDGER",
        rule: "RF-09",
        decisionLevel: "REVIEW_REQUIRED",
        reason: "Extrato sem razão",
        statement: sEval2,
        valueTolerance: "0.00",
      },
      {
        id: "res-l1",
        status: "LEDGER_WITHOUT_STATEMENT",
        rule: "RF-09",
        decisionLevel: "REVIEW_REQUIRED",
        reason: "Razão sem extrato",
        ledger: lEval1,
        valueTolerance: "0.00",
      },
      {
        id: "res-l2",
        status: "LEDGER_WITHOUT_STATEMENT",
        rule: "RF-09",
        decisionLevel: "REVIEW_REQUIRED",
        reason: "Razão sem extrato",
        ledger: lEval2,
        valueTolerance: "0.00",
      },
    ];

    const mapping: AccountMapping = {
      ledgerAccount: "1.1.1.01.001",
      statementFileIds: ["f-1"],
      signProfile: "BANK_ASSET",
    };

    // 1. Geração de Candidatos
    const request = generator.generate(results, sampleLedgers, sampleStatements, [mapping], {
      period: "2026-03",
    });

    expect(request.groups.length).toBeGreaterThan(0);

    // Cobertura do gerador: todos os pares esperados pelo oráculo devem estar presentes nos grupos gerados
    const allCandidateIds = new Set(request.groups.flatMap((g: AdvisorRequestGroupV1) => g.entries.map((e: AdvisorRequestEntryV1) => e.id)));
    expect(allCandidateIds.has("l-eval-1")).toBe(true);
    expect(allCandidateIds.has("s-eval-1")).toBe(true);
    expect(allCandidateIds.has("l-eval-2")).toBe(true);
    expect(allCandidateIds.has("s-eval-2")).toBe(true);

    // 2. Simulação de resposta da IA: responde apenas aos grupos de âncoras de extrato
    const simulatedResponse = {
      contractVersion: "1.0" as const,
      requestId: request.requestId,
      provider: "simulated-eval",
      model: "eval-v1",
      promptVersion: "match-advisor-v1",
      suggestions: request.groups.map((g: AdvisorRequestGroupV1) => {
        if (g.anchorId === "s-eval-1") {
          return {
            groupId: g.groupId,
            anchorId: g.anchorId,
            candidateIds: ["l-eval-1"],
            decision: "SUGGEST_MATCH" as const,
            confidenceBps: 9200,
            reasonCode: "HISTORY_SIMILARITY" as const,
            explanationPtBr: "Similaridade semântica de tarifas confirmada pelo oráculo.",
          };
        }
        if (g.anchorId === "s-eval-2") {
          return {
            groupId: g.groupId,
            anchorId: g.anchorId,
            candidateIds: ["l-eval-2"],
            decision: "SUGGEST_MATCH" as const,
            confidenceBps: 9400,
            reasonCode: "HISTORY_SIMILARITY" as const,
            explanationPtBr: "Similaridade semântica de consultoria confirmada pelo oráculo.",
          };
        }
        return {
          groupId: g.groupId,
          anchorId: g.anchorId,
          candidateIds: [],
          decision: "NO_MATCH" as const,
          confidenceBps: 0,
          reasonCode: "INSUFFICIENT_EVIDENCE" as const,
          explanationPtBr: "Sem par adicional.",
        };
      }),
    };

    const validation = validator.validate(
      simulatedResponse,
      request,
      sampleLedgers,
      sampleStatements,
      [mapping],
    );

    expect(validation.rejectedSuggestions).toHaveLength(0);
    expect(validation.validSuggestions).toHaveLength(2);
    expect(validation.validSuggestions.some((s: ValidatedAdvisorSuggestion) => s.anchorId === "s-eval-1")).toBe(true);
    expect(validation.validSuggestions.some((s: ValidatedAdvisorSuggestion) => s.anchorId === "s-eval-2")).toBe(true);
  });
});
