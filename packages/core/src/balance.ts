import Decimal from "decimal.js";

import type { BalanceCheck } from "./types.js";

export type BalanceMovement = { amount: string; runningBalance?: string };

export function calculateBalanceCheck(movements: readonly BalanceMovement[], tolerance = "0.01"): BalanceCheck {
  const decimalTolerance = new Decimal(tolerance);
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
  if (!movements.length || movements.some((movement) => movement.runningBalance === undefined)) return { status: "NOT_AVAILABLE", ...base };

  const first = movements[0]!;
  const openingBalance = new Decimal(first.runningBalance!).minus(first.amount);
  let expected = openingBalance;
  let difference = new Decimal(0);
  for (const movement of movements) {
    expected = expected.plus(movement.amount);
    const currentDifference = expected.minus(movement.runningBalance!);
    if (difference.isZero() && currentDifference.abs().greaterThan(decimalTolerance)) difference = currentDifference;
  }
  const extractedClosingBalance = new Decimal(movements.at(-1)!.runningBalance!);
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
