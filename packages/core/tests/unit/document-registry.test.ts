import { describe, expect, it } from "vitest";
import { FinancialDocumentAdapterRegistry, scoredEvidence, validateAdapterContract, type FinancialDocumentAdapter } from "../../src/document-registry";

function adapter(id: string, score: number): FinancialDocumentAdapter {
  return {
    id,
    version: "1",
    kind: "CURRENT_ACCOUNT",
    contract: { layoutFamily: id, positiveSignatures: [`assinatura:${id}`], negativeSignatures: [], balanceEvidenceStrategy: "RUNNING_BALANCE_WHEN_AVAILABLE" },
    detect: () => scoredEvidence("CURRENT_ACCOUNT", score, [`assinatura:${id}`]),
  };
}

describe("FinancialDocumentAdapterRegistry", () => {
  it("exige um contrato declarativo para cada adapter", () => {
    expect(validateAdapterContract(adapter("ITAU_CC", 100))).toEqual([]);
  });

  it("seleciona somente um adapter acima do limiar e da margem", () => {
    const registry = new FinancialDocumentAdapterRegistry([adapter("ITAU_CC", 100), adapter("SAFRA_CC", 40)]);

    expect(registry.select({ fileId: "file", originalName: "statement.pdf", text: "conteúdo" })).toMatchObject({ status: "SELECTED", adapter: { id: "ITAU_CC" } });
  });

  it("recusa empate em vez de classificar pelo primeiro adapter", () => {
    const registry = new FinancialDocumentAdapterRegistry([adapter("ITAU_CC", 100), adapter("SAFRA_CC", 90)]);

    expect(registry.select({ fileId: "file", originalName: "statement.pdf", text: "conteúdo" })).toMatchObject({ status: "AMBIGUOUS" });
  });

  it("recusa documento sem evidências suficientes", () => {
    const registry = new FinancialDocumentAdapterRegistry([adapter("ITAU_CC", 60)]);

    expect(registry.select({ fileId: "file", originalName: "statement.pdf", text: "conteúdo" })).toMatchObject({ status: "UNSUPPORTED" });
  });
});
