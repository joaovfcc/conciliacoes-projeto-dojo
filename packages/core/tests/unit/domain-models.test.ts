import { describe, expect, it } from "vitest";
import {
  createNormalizedLedgerEntry,
  createNormalizedTransaction,
  absoluteDecimalString,
  decimalDifference,
  decimalString,
  positiveDecimalString,
  signedAmount,
} from "../../src/index.js";

describe("BR-01/BR-02 — domínio e modelo canônico", () => {
  it("normaliza dinheiro como decimal exato com duas casas", () => {
    expect(decimalString("0.1")).toBe("0.10");
    expect(signedAmount("1250.50", "DEBIT")).toBe("-1250.50");
    expect(signedAmount("1250.50", "CREDIT")).toBe("1250.50");
  });

  it("rejeita decimais não finitos e aplica invariantes positivas e absolutas", () => {
    expect(() => decimalString(Number.POSITIVE_INFINITY)).toThrow("inválido");
    expect(() => positiveDecimalString("0")).toThrow("positivo");
    expect(positiveDecimalString("1.239")).toBe("1.24");
    expect(absoluteDecimalString("-3.50")).toBe("3.50");
    expect(decimalDifference("10.01", "9.99")).toBe("0.02");
  });

  it("cria uma transação positiva com origem e confiança normalizada", () => {
    const transaction = createNormalizedTransaction({
      id: "tx-1",
      companyId: "company-1",
      accountId: "bank-1",
      importBatchId: "batch-1",
      transactionDate: "31/12/2025",
      amount: "150,00".replace(",", "."),
      nature: "DEBIT",
      description: "PAGAMENTO FORNECEDOR",
      source: { fileId: "file-1", row: 7, rawValues: { valor: "150,00 D" } },
      parsing: { layoutId: "layout-1", layoutVersion: 1, confidence: 0.98, warnings: [] },
    });

    expect(transaction.amount).toBe("150.00");
    expect(transaction.transactionDate).toBe("2025-12-31");
    expect(transaction.source.rawValues).toEqual({ valor: "150,00 D" });
  });

  it("rejeita valor não positivo e confiança fora do intervalo", () => {
    const base = {
      id: "tx-1",
      companyId: "company-1",
      accountId: "bank-1",
      importBatchId: "batch-1",
      transactionDate: "2025-12-31",
      nature: "CREDIT" as const,
      description: "CRÉDITO",
      source: { fileId: "file-1", rawValues: {} },
      parsing: { layoutId: "layout-1", layoutVersion: 1, confidence: 1.1, warnings: [] },
    };
    expect(() => createNormalizedTransaction({ ...base, amount: "0" })).toThrow();
    expect(() => createNormalizedTransaction({ ...base, amount: "1" })).toThrow("confiança");
  });

  it("normaliza lançamento do razão preservando evidência bruta", () => {
    const entry = createNormalizedLedgerEntry({
      id: "ledger-1",
      companyId: "company-1",
      ledgerAccountId: "ledger-account-1",
      importBatchId: "batch-2",
      transactionDate: "2025-12-30",
      amount: "25",
      nature: "CREDIT",
      description: "RECEBIMENTO",
      source: { fileId: "file-2", sheet: "Razão", row: 11, rawValues: { valor: "25,00" } },
    });
    expect(entry.amount).toBe("25.00");
    expect(entry.source.row).toBe(11);
  });
});
