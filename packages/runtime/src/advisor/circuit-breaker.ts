export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private nextAttemptTime = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30000;
  }

  getState(): CircuitState {
    if (this.state === "OPEN" && Date.now() >= this.nextAttemptTime) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = this.getState();
    if (currentState === "OPEN") {
      const error = new Error("Circuito de proteção aberto devido a falhas consecutivas.");
      (error as unknown as { code: string }).code = "ADVISOR_CIRCUIT_OPEN";
      throw error;
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.nextAttemptTime = Date.now() + this.cooldownMs;
    }
  }

  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.nextAttemptTime = 0;
  }
}
