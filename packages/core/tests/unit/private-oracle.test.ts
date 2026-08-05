import { describe, expect, it } from "vitest";
import { validatePrivateStatementOracles } from "../../src/private-oracle.js";

const valid = {
  fileSha256: "a".repeat(64), adapterId: "ITAU_CC", adapterVersion: "1", classification: "CURRENT_ACCOUNT" as const,
  bank: "ITAU", periods: ["202601"], recordCount: 1, approvalReference: "CONTABIL-2026-01",
};

describe("oráculo privado de paridade", () => {
  it("aceita uma expectativa rastreável sem nome de arquivo", () => {
    expect(validatePrivateStatementOracles([valid])).toEqual([]);
  });

  it("recusa hash inválido, duplicado ou expectativa sem aprovação", () => {
    expect(validatePrivateStatementOracles([
      { ...valid, fileSha256: "invalid", approvalReference: "" },
      valid,
      valid,
    ])).toEqual(["ORACLE_APPROVAL_REQUIRED", "ORACLE_SHA256_DUPLICATE", "ORACLE_SHA256_INVALID"]);
  });
});
