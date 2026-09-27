import type {
  AccountMapping,
  LedgerRecord,
  ProcessingResult,
  ReconciliationResult,
  StatementRecord,
} from "../types.js";
import { AdvisorCandidateGenerator, type CandidateGeneratorOptions } from "./candidate-generator.js";
import { AdvisorEvidenceRehydrator } from "./evidence-rehydrator.js";
import type { LlmMatchAdvisor } from "./LlmMatchAdvisor.js";
import { AdvisorResponseValidator } from "./response-validator.js";

export type AdvisorMode = "DISABLED" | "SHADOW" | "REVIEW";

export interface AdvisorOrchestratorOptions {
  mode: AdvisorMode;
  candidateOptions?: Partial<CandidateGeneratorOptions>;
  signal?: AbortSignal;
}

export interface AdvisorExecutionMetrics {
  durationMs: number;
  groupsRequested: number;
  suggestionsReceived: number;
  suggestionsValidated: number;
  suggestionsRejected: number;
  mode: AdvisorMode;
  provider?: string;
  model?: string;
  error?: string;
}

export class AdvisorOrchestrator {
  private readonly candidateGenerator = new AdvisorCandidateGenerator();
  private readonly validator = new AdvisorResponseValidator();
  private readonly rehydrator = new AdvisorEvidenceRehydrator();

  async execute(
    baseResult: ProcessingResult,
    ledgers: LedgerRecord[],
    statements: StatementRecord[],
    mappings: AccountMapping[],
    advisor: LlmMatchAdvisor,
    options: AdvisorOrchestratorOptions,
  ): Promise<{ result: ProcessingResult; metrics: AdvisorExecutionMetrics }> {
    const startTime = Date.now();
    const mode = options.mode;

    const metrics: AdvisorExecutionMetrics = {
      durationMs: 0,
      groupsRequested: 0,
      suggestionsReceived: 0,
      suggestionsValidated: 0,
      suggestionsRejected: 0,
      mode,
    };

    if (mode === "DISABLED") {
      metrics.durationMs = Date.now() - startTime;
      return { result: baseResult, metrics };
    }

    try {
      // 1. Identificar registros já conciliados deterministicamente
      const alreadyReconciledIds = new Set<string>();
      for (const res of baseResult.results) {
        if (res.decisionLevel === "AUTOMATIC") {
          if (res.ledger) alreadyReconciledIds.add(res.ledger.id);
          if (res.statement) alreadyReconciledIds.add(res.statement.id);
          if (res.ledgers) res.ledgers.forEach((l) => alreadyReconciledIds.add(l.id));
          if (res.statements) res.statements.forEach((s) => alreadyReconciledIds.add(s.id));
        }
      }

      // 2. Gerar candidatos delimitados deterministicamente
      const request = this.candidateGenerator.generate(
        baseResult.results,
        ledgers,
        statements,
        mappings,
        {
          period: baseResult.period,
          currency: "BRL",
          promptVersion: options.candidateOptions?.promptVersion ?? "match-advisor-v1",
          maxGroupsPerRequest: options.candidateOptions?.maxGroupsPerRequest ?? 20,
          maxCandidatesPerGroup: options.candidateOptions?.maxCandidatesPerGroup ?? 20,
          dateToleranceDays: options.candidateOptions?.dateToleranceDays ?? 10,
        },
      );

      metrics.groupsRequested = request.groups.length;

      if (request.groups.length === 0) {
        metrics.durationMs = Date.now() - startTime;
        return { result: baseResult, metrics };
      }

      // 3. Chamar a porta do Advisor
      const rawResponse = await advisor.advise(request, options.signal);
      metrics.suggestionsReceived = rawResponse.suggestions?.length ?? 0;
      metrics.provider = rawResponse.provider;
      metrics.model = rawResponse.model;

      // 4. Validar deterministicamente a resposta da LLM
      const validation = this.validator.validate(
        rawResponse,
        request,
        ledgers,
        statements,
        mappings,
        alreadyReconciledIds,
      );

      metrics.suggestionsValidated = validation.validSuggestions.length;
      metrics.suggestionsRejected = validation.rejectedSuggestions.length;

      // 5. Em modo SHADOW, registra métricas e retorna o baseline intacto
      if (mode === "SHADOW") {
        metrics.durationMs = Date.now() - startTime;
        return { result: baseResult, metrics };
      }

      // 6. Em modo REVIEW, reidratar evidências canônicas e projetar no resultado
      const ledgerById = new Map<string, LedgerRecord>();
      for (const l of ledgers) ledgerById.set(l.id, l);
      const statementById = new Map<string, StatementRecord>();
      for (const s of statements) statementById.set(s.id, s);

      const suggestedResults = this.rehydrator.rehydrate(
        validation.validSuggestions,
        ledgerById,
        statementById,
        mappings,
      );

      if (suggestedResults.length === 0) {
        metrics.durationMs = Date.now() - startTime;
        return { result: baseResult, metrics };
      }

      // 7. Substituir as pendências individuais consumidas pelas sugestões estruturadas
      const consumedIds = new Set<string>();
      for (const sug of suggestedResults) {
        if (sug.ledger) consumedIds.add(sug.ledger.id);
        if (sug.statement) consumedIds.add(sug.statement.id);
        if (sug.ledgers) sug.ledgers.forEach((l) => consumedIds.add(l.id));
        if (sug.statements) sug.statements.forEach((s) => consumedIds.add(s.id));
      }

      const updatedResults: ReconciliationResult[] = [];
      for (const res of baseResult.results) {
        const isConsumed =
          (res.ledger && consumedIds.has(res.ledger.id)) ||
          (res.statement && consumedIds.has(res.statement.id)) ||
          (res.ledgers && res.ledgers.some((l) => consumedIds.has(l.id))) ||
          (res.statements && res.statements.some((s) => consumedIds.has(s.id)));

        // Preserva resultados automáticos incondicionalmente
        if (res.decisionLevel === "AUTOMATIC" || !isConsumed) {
          updatedResults.push(res);
        }
      }

      // Adiciona as sugestões validadas (com status REVIEW_REQUIRED)
      updatedResults.push(...suggestedResults);

      // 8. Atualizar sumários de contas para contabilizar sugestões
      const updatedSummaries = baseResult.summaries.map((summary) => {
        let suggestedGroupCount = 0;
        let suggestedLedgerCount = 0;
        let suggestedStatementCount = 0;

        for (const sug of suggestedResults) {
          const lAcc = sug.ledgers?.[0]?.ledgerAccount ?? sug.ledger?.ledgerAccount;
          if (lAcc === summary.ledgerAccount) {
            suggestedGroupCount += 1;
            suggestedLedgerCount += sug.ledgers?.length ?? (sug.ledger ? 1 : 0);
            suggestedStatementCount += sug.statements?.length ?? (sug.statement ? 1 : 0);
          }
        }

        return {
          ...summary,
          suggestedGroupCount: (summary.suggestedGroupCount ?? 0) + suggestedGroupCount,
          suggestedLedgerCount: (summary.suggestedLedgerCount ?? 0) + suggestedLedgerCount,
          suggestedStatementCount: (summary.suggestedStatementCount ?? 0) + suggestedStatementCount,
        };
      });

      const updatedResult: ProcessingResult = {
        ...baseResult,
        summaries: updatedSummaries,
        results: updatedResults,
      };

      metrics.durationMs = Date.now() - startTime;
      return { result: updatedResult, metrics };
    } catch (error) {
      metrics.durationMs = Date.now() - startTime;
      metrics.error = error instanceof Error ? error.message : String(error);
      // Fallback seguro: preserva resultado determinístico sem quebrar a execução
      return { result: baseResult, metrics };
    }
  }
}
