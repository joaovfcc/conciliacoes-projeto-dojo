import { afterEach, describe, expect, it, vi } from "vitest";
import { requestWithTimeout } from "../../src/components/reconciliation-app";

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
