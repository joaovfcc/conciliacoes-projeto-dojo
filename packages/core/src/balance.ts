import Decimal from "decimal.js";

import type { BalanceCheck, BalanceMovementEffect } from "./types.js";

export type BalanceMovement = { amount: string; runningBalance?: string };
export type DocumentBalanceControls = {
  openingBalance?: string;
  closingBalance?: string;
  movementEffect?: BalanceMovementEffect;
};

export function calculateBalanceCheck(
  movements: readonly BalanceMovement[],
  tolerance = "0.01",
  controls: DocumentBalanceControls = {},
): BalanceCheck {
  const decimalTolerance = new Decimal(tolerance);
  const movementEffect = controls.movementEffect ?? "ADDS_TO_BALANCE";
  const amounts = movements.map((movement) => new Decimal(movement.amount));
  const creditTotal = amounts.reduce((total, amount) => amount.greaterThan(0) ? total.plus(amount) : total, new Decimal(0));
  const debitTotal = amounts.reduce((total, amount) => amount.lessThan(0) ? total.plus(amount) : total, new Decimal(0));
  const movementTotal = amounts.reduce((total, amount) => total.plus(amount), new Decimal(0));
  const base = {
    creditTotal: format(creditTotal),
    debitTotal: format(debitTotal),
    movementTotal: format(movementTotal),
    tolerance: format(decimalTolerance),
  };
  const hasCompleteRunningBalances = movements.length > 0
    && movements.every((movement) => movement.runningBalance !== undefined);
  if (!hasCompleteRunningBalances) {
    if (controls.openingBalance === undefined || controls.closingBalance === undefined) {
      return { status: "NOT_AVAILABLE", ...base };
    }
    const openingBalance = new Decimal(controls.openingBalance);
    const expectedClosingBalance = applyMovement(openingBalance, movementTotal, movementEffect);
    const extractedClosingBalance = new Decimal(controls.closingBalance);
    const difference = expectedClosingBalance.minus(extractedClosingBalance);
    return {
      status: difference.abs().lessThanOrEqualTo(decimalTolerance) ? "PASSED" : "FAILED",
      openingBalance: format(openingBalance),
      ...base,
      expectedClosingBalance: format(expectedClosingBalance),
      extractedClosingBalance: format(extractedClosingBalance),
      difference: format(difference),
    };
  }

  const first = movements[0]!;
  const openingBalance = controls.openingBalance === undefined
    ? reverseMovement(new Decimal(first.runningBalance!), new Decimal(first.amount), movementEffect)
    : new Decimal(controls.openingBalance);
  let expected = openingBalance;
  let difference = new Decimal(0);
  for (const movement of movements) {
    expected = applyMovement(expected, new Decimal(movement.amount), movementEffect);
    const currentDifference = expected.minus(movement.runningBalance!);
    if (difference.isZero() && currentDifference.abs().greaterThan(decimalTolerance)) difference = currentDifference;
  }
  const extractedClosingBalance = controls.closingBalance === undefined
    ? new Decimal(movements.at(-1)!.runningBalance!)
    : new Decimal(controls.closingBalance);
  if (difference.isZero()) difference = expected.minus(extractedClosingBalance);
  return {
    status: difference.abs().lessThanOrEqualTo(decimalTolerance) ? "PASSED" : "FAILED",
    openingBalance: format(openingBalance),
    ...base,
    expectedClosingBalance: format(expected),
    extractedClosingBalance: format(extractedClosingBalance),
    difference: format(difference),
  };
}

function format(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

function applyMovement(balance: Decimal, movement: Decimal, effect: BalanceMovementEffect): Decimal {
  return effect === "ADDS_TO_BALANCE" ? balance.plus(movement) : balance.minus(movement);
}

function reverseMovement(balanceAfterMovement: Decimal, movement: Decimal, effect: BalanceMovementEffect): Decimal {
  return effect === "ADDS_TO_BALANCE"
    ? balanceAfterMovement.minus(movement)
    : balanceAfterMovement.plus(movement);
}
