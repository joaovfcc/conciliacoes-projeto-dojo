import { describe, expect, it } from "vitest";
import {
  bankAccountsConflict,
  bankAccountsMatch,
  compareBankAccountIdentities,
  normalizeBankAccountRegistration,
} from "../../src/normalization.js";

describe("identidade bancária canônica", () => {
  it("confirma banco, agência e conta quando o razão omite somente zeros e dígito", () => {
    const ledger = { bank: "BRADESCO", agency: "3394", bankAccount: "12545" };
    const statement = { bank: "237", agency: "03394", account: "0012545-8" };

    expect(compareBankAccountIdentities(ledger, statement)).toMatchObject({ status: "CONFIRMED" });
    expect(bankAccountsMatch(ledger, statement)).toBe(true);
    expect(bankAccountsConflict(ledger, statement)).toBe(false);
  });

  it("bloqueia dígitos verificadores explicitamente divergentes", () => {
    const ledger = { bank: "237", agency: "3394", bankAccount: "0012545-7" };
    const statement = { bank: "BRADESCO", agency: "3394", account: "0012545-8" };

    expect(compareBankAccountIdentities(ledger, statement)).toMatchObject({
      status: "CONFLICT",
      conflictingFields: ["ACCOUNT"],
    });
    expect(bankAccountsConflict(ledger, statement)).toBe(true);
  });

  it("não confirma identidade incompleta", () => {
    const ledger = { agency: "3394", bankAccount: "12545" };
    const statement = { bank: "237", agency: "3394", account: "0012545-8" };

    expect(compareBankAccountIdentities(ledger, statement)).toMatchObject({
      status: "PARTIAL",
      missingFields: ["BANK"],
    });
    expect(bankAccountsMatch(ledger, statement)).toBe(false);
    expect(bankAccountsConflict(ledger, statement)).toBe(false);
  });

  it("separa número-base e dígito ao normalizar o cadastro", () => {
    expect(normalizeBankAccountRegistration({
      bankCode: " 237 ",
      agency: "03394",
      accountNumber: "0012545-8",
    })).toEqual({
      bankCode: "237",
      agency: "3394",
      accountNumber: "12545",
      accountDigit: "8",
    });
  });
});
