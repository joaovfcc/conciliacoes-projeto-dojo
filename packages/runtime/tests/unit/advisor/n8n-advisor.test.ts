import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AdvisorRequestV1, AdvisorResponseV1 } from "@conciliacao/core";
import { CircuitBreaker, N8nMatchAdvisor } from "../../../src/index.js";

const mockRequest: AdvisorRequestV1 = {
  contractVersion: "1.0",
  requestId: "req-unit-1",
  idempotencyKey: "idem-unit-1",
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
          amountCents: "-10000",
          document: "123",
          normalizedHistory: "HIST 1",
        },
        {
          id: "ldg-1",
          source: "LEDGER",
          date: "2026-03-10",
          amountCents: "-10000",
          document: "123",
          normalizedHistory: "HIST 2",
        },
      ],
    },
  ],
};

const mockValidResponse: AdvisorResponseV1 = {
  contractVersion: "1.0",
  requestId: "req-unit-1",
  provider: "openai",
  model: "gpt-4o-mini",
  promptVersion: "match-advisor-v1",
  suggestions: [
    {
      groupId: "grp-1",
      anchorId: "stmt-1",
      candidateIds: ["ldg-1"],
      decision: "SUGGEST_MATCH",
      confidenceBps: 8900,
      reasonCode: "HISTORY_SIMILARITY",
      explanationPtBr: "Histórico coerente.",
    },
  ],
};

describe("N8nMatchAdvisor", () => {
  it("envia headers de autenticação HMAC e payload correto", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;

    const fakeFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = init?.body as string;
      return new Response(JSON.stringify(mockValidResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const secret = "super-secret-key-123";
    const advisor = new N8nMatchAdvisor({
      url: "https://n8n.internal/webhook/reconciliation-advisor-v1",
      secret,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const response = await advisor.advise(mockRequest);

    expect(response).toEqual(mockValidResponse);
    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders!.get("X-Request-Id")).toBe("req-unit-1");
    expect(capturedHeaders!.get("X-Idempotency-Key")).toBe("idem-unit-1");

    const timestamp = capturedHeaders!.get("X-Advisor-Timestamp");
    const signature = capturedHeaders!.get("X-Advisor-Signature");

    expect(timestamp).toBeDefined();
    expect(signature).toBeDefined();

    const expectedSig = `sha256=${createHmac("sha256", secret)
      .update(`${timestamp}.${capturedBody}`)
      .digest("hex")}`;

    expect(signature).toBe(expectedSig);
  });

  it("trata timeout de rede disparando código ADVISOR_TIMEOUT", async () => {
    const fakeSlowFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("The operation was aborted."));
        });
      });
    };

    const advisor = new N8nMatchAdvisor({
      url: "https://n8n.internal/webhook/reconciliation-advisor-v1",
      secret: "secret",
      timeoutMs: 50,
      fetchFn: fakeSlowFetch as unknown as typeof fetch,
    });

    let thrownError: unknown;
    try {
      await advisor.advise(mockRequest);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect((thrownError as { code?: string }).code).toBe("ADVISOR_TIMEOUT");
  });

  it("trata erro HTTP 500 do n8n disparando ADVISOR_UNAVAILABLE", async () => {
    const fake500Fetch = async (): Promise<Response> => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const advisor = new N8nMatchAdvisor({
      url: "https://n8n.internal/webhook/reconciliation-advisor-v1",
      secret: "secret",
      fetchFn: fake500Fetch as unknown as typeof fetch,
    });

    let thrownError: unknown;
    try {
      await advisor.advise(mockRequest);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect((thrownError as { code?: string }).code).toBe("ADVISOR_UNAVAILABLE");
  });
});

describe("CircuitBreaker", () => {
  it("abre o circuito após N falhas consecutivas e bloqueia chamadas", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });

    const failingAction = async () => {
      throw new Error("Network error");
    };

    // Falha 1
    await expect(breaker.execute(failingAction)).rejects.toThrow("Network error");
    expect(breaker.getState()).toBe("CLOSED");

    // Falha 2 -> Abre circuito
    await expect(breaker.execute(failingAction)).rejects.toThrow("Network error");
    expect(breaker.getState()).toBe("OPEN");

    // Chamada seguinte deve ser bloqueada de imediato pelo circuit breaker
    let circuitError: unknown;
    try {
      await breaker.execute(async () => "ok");
    } catch (err) {
      circuitError = err;
    }

    expect(circuitError).toBeDefined();
    expect((circuitError as { code?: string }).code).toBe("ADVISOR_CIRCUIT_OPEN");
  });
});
