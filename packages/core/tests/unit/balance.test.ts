import { describe, expect, it } from "vitest";
import { calculateBalanceCheck } from "../../src/balance.js";

describe("controle de saldo de extrato", () => {
  it("reconcilia saldo de abertura, movimentos e saldos acumulados", () => {
    expect(calculateBalanceCheck([
      { amount: "10.00", runningBalance: "110.00" },
      { amount: "-5.00", runningBalance: "105.00" },
    ])).toEqual({
      status: "PASSED",
      openingBalance: "100.00",
      creditTotal: "10.00",
      debitTotal: "-5.00",
      movementTotal: "5.00",
      expectedClosingBalance: "105.00",
      extractedClosingBalance: "105.00",
      difference: "0.00",
      tolerance: "0.01",
    });
  });

  it("falha quando um saldo acumulado não corresponde à sequência dos movimentos", () => {
    expect(calculateBalanceCheck([
      { amount: "10.00", runningBalance: "110.00" },
      { amount: "-5.00", runningBalance: "100.00" },
    ])).toMatchObject({ status: "FAILED", difference: "5.00" });
  });

  it("não inventa um saldo de abertura quando o layout não fornece saldos acumulados", () => {
    expect(calculateBalanceCheck([{ amount: "10.00" }])).toEqual({
      status: "NOT_AVAILABLE",
      creditTotal: "10.00",
      debitTotal: "0.00",
      movementTotal: "10.00",
      tolerance: "0.01",
    });
  });
});
