import type { AdvisorRequestV1, AdvisorResponseV1 } from "./contracts.js";
import { ADVISOR_CONTRACT_VERSION_V1 } from "./contracts.js";

export interface LlmMatchAdvisor {
  advise(request: AdvisorRequestV1, signal?: AbortSignal): Promise<AdvisorResponseV1>;
}

export class DisabledMatchAdvisor implements LlmMatchAdvisor {
  async advise(request: AdvisorRequestV1, _signal?: AbortSignal): Promise<AdvisorResponseV1> {
    return {
      contractVersion: ADVISOR_CONTRACT_VERSION_V1,
      requestId: request.requestId,
      provider: "disabled",
      model: "none",
      promptVersion: request.promptVersion,
      suggestions: request.groups.map((group) => ({
        groupId: group.groupId,
        anchorId: group.anchorId,
        candidateIds: [],
        decision: "NO_MATCH" as const,
        confidenceBps: 0,
        reasonCode: "INSUFFICIENT_EVIDENCE" as const,
        explanationPtBr: "O assistente de IA está desabilitado por configuração.",
      })),
    };
  }
}

export interface FakeMatchAdvisorOptions {
  provider?: string;
  model?: string;
  delayMs?: number;
  handler?: (request: AdvisorRequestV1) => Promise<AdvisorResponseV1> | AdvisorResponseV1;
  errorToThrow?: Error;
}

export class FakeMatchAdvisor implements LlmMatchAdvisor {
  constructor(private readonly options: FakeMatchAdvisorOptions = {}) {}

  async advise(request: AdvisorRequestV1, signal?: AbortSignal): Promise<AdvisorResponseV1> {
    if (signal?.aborted) {
      throw new Error("Operação cancelada.");
    }
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve();
        }, this.options.delayMs);
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Operação cancelada por timeout."));
          }, { once: true });
        }
      });
    }
    if (this.options.errorToThrow) {
      throw this.options.errorToThrow;
    }
    if (this.options.handler) {
      return this.options.handler(request);
    }
    return {
      contractVersion: ADVISOR_CONTRACT_VERSION_V1,
      requestId: request.requestId,
      provider: this.options.provider ?? "fake-provider",
      model: this.options.model ?? "fake-model-v1",
      promptVersion: request.promptVersion,
      suggestions: request.groups.map((group) => {
        const otherEntries = group.entries.filter((entry) => entry.id !== group.anchorId);
        const candidateIds = otherEntries.map((e) => e.id);
        return {
          groupId: group.groupId,
          anchorId: group.anchorId,
          candidateIds,
          decision: candidateIds.length > 0 ? ("SUGGEST_MATCH" as const) : ("NO_MATCH" as const),
          confidenceBps: 8500,
          reasonCode: "HISTORY_SIMILARITY" as const,
          explanationPtBr: "Correspondência provável identificada por similaridade de histórico no provedor simulado.",
        };
      }),
    };
  }
}
