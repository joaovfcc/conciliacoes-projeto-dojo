import { createHmac } from "node:crypto";
import type { AdvisorRequestV1, AdvisorResponseV1, LlmMatchAdvisor } from "@conciliacao/core";
import { CircuitBreaker } from "./circuit-breaker.js";

export interface N8nMatchAdvisorOptions {
  url: string;
  secret: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  circuitBreaker?: CircuitBreaker;
  fetchFn?: typeof fetch;
}

export class N8nMatchAdvisor implements LlmMatchAdvisor {
  private readonly url: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly fetch: typeof fetch;

  constructor(options: N8nMatchAdvisorOptions) {
    if (!options.url) throw new Error("URL do n8n não configurada.");
    if (!options.secret) throw new Error("Secret HMAC do n8n não configurada.");
    this.url = options.url;
    this.secret = options.secret;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
    this.circuitBreaker = options.circuitBreaker ?? new CircuitBreaker();
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  async advise(request: AdvisorRequestV1, externalSignal?: AbortSignal): Promise<AdvisorResponseV1> {
    return this.circuitBreaker.execute(async () => {
      const body = JSON.stringify(request);
      if (Buffer.byteLength(body, "utf-8") > this.maxBodyBytes) {
        const error = new Error("Tamanho da requisição excede o limite permitido.");
        (error as unknown as { code: string }).code = "ADVISOR_INVALID_RESPONSE";
        throw error;
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", this.secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);

      const abortHandler = () => {
        timeoutController.abort();
      };

      if (externalSignal) {
        if (externalSignal.aborted) {
          clearTimeout(timeoutId);
          throw new Error("Operação cancelada.");
        }
        externalSignal.addEventListener("abort", abortHandler, { once: true });
      }

      let response: Response;
      try {
        response = await this.fetch(this.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Advisor-Timestamp": timestamp,
            "X-Advisor-Signature": `sha256=${signature}`,
            "X-Request-Id": request.requestId,
            "X-Idempotency-Key": request.idempotencyKey,
          },
          body,
          signal: timeoutController.signal,
        });
      } catch (error) {
        if (timeoutController.signal.aborted && !externalSignal?.aborted) {
          const timeoutError = new Error(`Timeout de ${this.timeoutMs}ms ao consultar o n8n.`);
          (timeoutError as unknown as { code: string }).code = "ADVISOR_TIMEOUT";
          throw timeoutError;
        }
        const unavailableError = new Error(
          `Falha de comunicação com o n8n: ${error instanceof Error ? error.message : String(error)}`,
        );
        (unavailableError as unknown as { code: string }).code = "ADVISOR_UNAVAILABLE";
        throw unavailableError;
      } finally {
        clearTimeout(timeoutId);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", abortHandler);
        }
      }

      if (!response.ok) {
        const statusText = response.statusText || String(response.status);
        const error = new Error(`Erro HTTP ${response.status} retornado pelo n8n: ${statusText}`);
        (error as unknown as { code: string }).code = "ADVISOR_UNAVAILABLE";
        throw error;
      }

      const text = await response.text();
      if (Buffer.byteLength(text, "utf-8") > this.maxBodyBytes) {
        const error = new Error("Tamanho da resposta do n8n excede o limite permitido.");
        (error as unknown as { code: string }).code = "ADVISOR_INVALID_RESPONSE";
        throw error;
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        const error = new Error("Resposta do n8n não é um JSON válido.");
        (error as unknown as { code: string }).code = "ADVISOR_INVALID_RESPONSE";
        throw error;
      }

      return json as AdvisorResponseV1;
    });
  }
}
