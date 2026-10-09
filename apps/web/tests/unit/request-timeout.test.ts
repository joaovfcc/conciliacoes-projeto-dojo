import { afterEach, describe, expect, it, vi } from "vitest";
import { messageOf, requestWithTimeout } from "../../src/components/reconciliation-app";

afterEach(() => {
  vi.useRealTimers();
});

describe("requestWithTimeout", () => {
  it("interrompe uma consulta que não responde em vez de carregar indefinidamente", async () => {
    vi.useFakeTimers();
    const pendingRequest = vi.fn(() => new Promise<Response>(() => undefined));

    const response = requestWithTimeout(pendingRequest, "/api/status", {}, 1_000);
    const assertion = expect(response).rejects.toThrow("O servidor demorou mais que o esperado");
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
  });
});

describe("messageOf", () => {
  it("converte erro de timeout em mensagem clara e orientativa sobre volume de dados", () => {
    const timeoutError = new Error("O servidor demorou mais que o esperado para responder.");
    expect(messageOf(timeoutError)).toBe(
      "O processamento dos arquivos está levando mais tempo que o esperado devido ao volume de lançamentos. O servidor continua executando; aguarde alguns instantes ou tente novamente."
    );
  });

  it("converte TypeError em mensagem de erro de conexão com servidor local", () => {
    const networkError = new TypeError("Failed to fetch");
    expect(messageOf(networkError)).toBe(
      "Não foi possível conectar ao servidor local. Verifique se a aplicação está em execução e tente novamente."
    );
  });

  it("preserva mensagem original de outros tipos de Error", () => {
    const businessError = new Error("Confirme a competência antes de iniciar a conciliação.");
    expect(messageOf(businessError)).toBe("Confirme a competência antes de iniciar a conciliação.");
  });

  it("retorna mensagem de inconsistência temporária para valores desconhecidos", () => {
    expect(messageOf(null)).toBe("Ocorreu uma inconsistência temporária ao processar a solicitação.");
    expect(messageOf({ code: 500 })).toBe("Ocorreu uma inconsistência temporária ao processar a solicitação.");
  });
});

