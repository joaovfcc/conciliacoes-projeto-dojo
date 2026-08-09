import Decimal from "decimal.js";

export type DecimalString = string & { readonly __decimalString: unique symbol };

export function decimalString(value: Decimal.Value): DecimalString {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error("Valor monetário inválido.");
  return parsed.toDecimalPlaces(2).toFixed(2) as DecimalString;
}

export function positiveDecimalString(value: Decimal.Value): DecimalString {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.lte(0)) {
    throw new Error("O valor monetário deve ser positivo.");
  }
  return decimalString(parsed);
}

export function absoluteDecimalString(value: Decimal.Value): DecimalString {
  return decimalString(new Decimal(value).abs());
}

export function signedAmount(
  amount: Decimal.Value,
  nature: "DEBIT" | "CREDIT",
): DecimalString {
  const absolute = new Decimal(amount).abs();
  return decimalString(nature === "DEBIT" ? absolute.negated() : absolute);
}

export function decimalDifference(left: Decimal.Value, right: Decimal.Value): DecimalString {
  return decimalString(new Decimal(left).minus(right).abs());
}
