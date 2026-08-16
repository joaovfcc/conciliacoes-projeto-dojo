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

  it("preserva a primeira divergência intermediária mesmo quando o saldo final volta a fechar", () => {
    expect(calculateBalanceCheck([
      { amount: "10.00", runningBalance: "110.00" },
      { amount: "-5.00", runningBalance: "100.00" },
      { amount: "2.00", runningBalance: "107.00" },
    ])).toMatchObject({ status: "FAILED", difference: "5.00", extractedClosingBalance: "107.00" });
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

  it("considera o controle indisponível quando apenas parte das linhas possui saldo acumulado", () => {
    expect(calculateBalanceCheck([
      { amount: "10.00", runningBalance: "110.00" },
      { amount: "-5.00" },
    ])).toMatchObject({ status: "NOT_AVAILABLE", movementTotal: "5.00" });
  });

  it("valida saldos documentais quando o banco não fornece saldo em cada lançamento", () => {
    expect(calculateBalanceCheck(
      [{ amount: "100.00" }, { amount: "-20.00" }],
      "0.01",
      { openingBalance: "100.00", closingBalance: "180.00" },
    )).toMatchObject({
      status: "PASSED",
      openingBalance: "100.00",
      expectedClosingBalance: "180.00",
      extractedClosingBalance: "180.00",
      difference: "0.00",
    });
  });

  it("falha quando os saldos documentais não fecham com os movimentos", () => {
    expect(calculateBalanceCheck(
      [{ amount: "100.00" }, { amount: "-20.00" }],
      "0.01",
      { openingBalance: "100.00", closingBalance: "175.00" },
    )).toMatchObject({ status: "FAILED", difference: "5.00" });
  });

  it("explicita o perfil físico do razão em que o saldo seguinte subtrai o movimento", () => {
    expect(calculateBalanceCheck(
      [{ amount: "20.00", runningBalance: "80.00" }, { amount: "-5.00", runningBalance: "85.00" }],
      "0.01",
      { movementEffect: "SUBTRACTS_FROM_BALANCE" },
    )).toEqual({
      status: "PASSED",
      openingBalance: "100.00",
      creditTotal: "20.00",
      debitTotal: "-5.00",
      movementTotal: "15.00",
      expectedClosingBalance: "85.00",
      extractedClosingBalance: "85.00",
      difference: "0.00",
      tolerance: "0.01",
    });
  });
});
