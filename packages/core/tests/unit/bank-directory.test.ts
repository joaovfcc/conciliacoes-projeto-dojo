import { describe, expect, it } from "vitest";
import {
  BANK_INSTITUTION_CATALOG,
  resolveBankInstitution,
  summarizeBankInstitutionCatalog,
} from "../../src/bank-directory.js";

describe("catálogo escalável de instituições bancárias", () => {
  it("mantém 23 posições explícitas sem confundir capacidade com homologação", () => {
    expect(summarizeBankInstitutionCatalog(BANK_INSTITUTION_CATALOG)).toEqual({
      total: 23,
      observedInCorpus: 18,
      awaitingSample: 5,
    });
  });

  it.each([
    ["Banco ABC Brasil", "ABC_BRASIL", "246"],
    ["Banco do Brasil", "BANCO_DO_BRASIL", "001"],
    ["Bocom BBM", "BOCOM", "107"],
    ["Banco Guanabara", "GUANABARA", "612"],
    ["Banco Sofisa 633", "SOFISA", "633"],
    ["Banco Inter", "INTER", "077"],
    ["Nubank", "NUBANK", "260"],
    ["Sicredi", "SICREDI", "748"],
    ["Sicoob", "SICOOB", "756"],
    ["BTG Pactual", "BTG_PACTUAL", "208"],
  ])("resolve '%s'", (input: string, institutionId: string, bankCode: string) => {
    expect(resolveBankInstitution(input)).toMatchObject({ institutionId, bankCode });
  });

  it("não atribui instituição a texto sem evidência", () => {
    expect(resolveBankInstitution("Movimentação de conta corrente")).toBeUndefined();
  });
});
