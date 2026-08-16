import { describe, expect, it } from "vitest";
import {
  balanceStatusLabel,
  decisionLevelLabel,
  documentKindLabel,
  extractionMethodLabel,
  issueCategoryLabel,
  reconciliationRuleLabel,
  resultStatusLabel,
  resultStatuses,
} from "../../src/index.js";

describe("apresentação em português", () => {
  it("possui rótulo em português para todos os resultados de conciliação", () => {
    for (const status of resultStatuses) {
      const label = resultStatusLabel(status);
      expect(label).not.toBe(status);
      expect(label).not.toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("traduz os códigos categóricos exibidos ao usuário", () => {
    expect(reconciliationRuleLabel("RULE_1_EXACT")).toBe("Regra 1 — documento, data e valor exatos");
    expect(decisionLevelLabel("REVIEW_REQUIRED")).toBe("Revisão necessária");
    expect(extractionMethodLabel("TABULAR")).toBe("Planilha");
    expect(documentKindLabel("CURRENT_ACCOUNT")).toBe("Conta-corrente");
    expect(balanceStatusLabel("PASSED")).toBe("Aprovado");
    expect(issueCategoryLabel("LAYOUT_NOT_DETECTED", "ERROR")).toBe("Leiaute não identificado");
  });

  it("não expõe códigos dinâmicos desconhecidos como texto principal", () => {
    expect(issueCategoryLabel("NEW_INTERNAL_CODE", "WARNING")).toBe("Alerta de processamento");
    expect(reconciliationRuleLabel("NEW_INTERNAL_RULE")).toBe("Regra de conciliação não catalogada");
  });
});
