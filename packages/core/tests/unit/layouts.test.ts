import { describe, expect, it } from "vitest";
import {
  createLayoutFingerprint,
  detectLayoutResult,
  InspectLayoutUseCase,
  parseGenericStatement,
  resolveLayout,
  type ExtractedTabularDocument,
  type ExtractedTabularRow,
  type StatementLayoutProfile,
  type LayoutRepository,
} from "../../src/index.js";

function row(rowNumber: number, values: unknown[]): ExtractedTabularRow {
  return {
    rowNumber,
    cells: values.map((value, columnIndex) => ({ columnIndex, rawValue: value, displayValue: String(value ?? "") })),
  };
}

function document(transactionDate: string, amount: string): ExtractedTabularDocument {
  return {
    sourceFormat: "XLSX",
    dataModel: "TABULAR",
    sheets: [{
      index: 0,
      name: "Extrato",
      hidden: false,
      rows: [
        row(1, ["Banco 341"]),
        row(2, ["Data", "Descrição", "Valor", "Saldo"]),
        row(3, [transactionDate, "Pagamento", amount, "100,00"]),
      ],
    }],
    warnings: [],
    metadata: { totalSheets: 1, totalRows: 3, totalCells: 9, hasFormulas: false, macroEnabled: false },
  };
}

const profile: StatementLayoutProfile = {
  id: "generic-single-amount-v1",
  version: 1,
  status: "VALIDATED",
  bankCode: "",
  productType: "CHECKING",
  formats: ["XLSX"],
  detection: { requiredHeaderGroups: [["data"], ["descrição"], ["valor"]], minimumScore: 70 },
  columns: { date: ["data"], description: ["descrição"], amount: ["valor"], balance: ["saldo"] },
  rules: { headerScanRows: 20, negativeAmountMeansDebit: true, ignoreRowPatterns: ["total", "saldo final"] },
};

describe("BR-05/BR-06 — catálogo, fingerprint e detector seguro", () => {
  it("mantém o fingerprint quando somente data e valores variáveis mudam", () => {
    const first = createLayoutFingerprint(document("01/12/2025", "10,00"));
    const second = createLayoutFingerprint(document("15/01/2026", "999,99"));
    expect(first.fingerprintHash).toBe(second.fingerprintHash);
    expect(first.bankHints).toEqual(["ITAU"]);
  });

  it("prioriza vínculo da conta sobre layout global", () => {
    const fingerprint = createLayoutFingerprint(document("01/12/2025", "10,00"));
    const resolved = resolveLayout({
      fingerprint,
      companyId: "company-1",
      bankAccountId: "account-1",
      entries: [
        { profile: { ...profile, id: "global" }, scope: "GLOBAL", priority: 1 },
        { profile: { ...profile, id: "account" }, scope: "ACCOUNT", bankAccountId: "account-1", priority: 100 },
      ],
    });
    expect(resolved.entry?.profile.id).toBe("account");
    expect(resolved.requiresMapping).toBe(false);
  });

  it("bloqueia dois layouts com o mesmo score", () => {
    const sheet = document("01/12/2025", "10,00").sheets[0]!;
    const result = detectLayoutResult(sheet, [profile, { ...profile, id: "generic-copy-v1" }], "XLSX");
    expect(result.match).toBeNull();
    expect(result.warnings).toContain("LAYOUT_AMBIGUOUS");
    expect(result.requiresReview).toBe(true);
  });

  it("não elimina descrição com a palavra total nem usa saldo como lançamento", () => {
    const sheet = {
      index: 0,
      name: "Extrato",
      hidden: false,
      rows: [
        row(1, ["Data", "Descrição", "Valor", "Saldo"]),
        row(2, ["01/12/2025", "Pagamento TotalPass", "-50,00", "950,00"]),
        row(3, ["02/12/2025", "Saldo final", "", "950,00"]),
      ],
    };
    const parsed = parseGenericStatement(sheet, profile, 0, "XLSX");
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]?.description).toBe("Pagamento TotalPass");
    expect(parsed.transactions[0]?.amount).toBe(50);
  });
});

describe("BR-07 — mapeamento assistido", () => {
  it("retorna fingerprint, prévia, papéis sugeridos e saída canônica antes da confirmação", async () => {
    const csvProfile: StatementLayoutProfile = {
      id: "bank-csv-v1",
      version: 1,
      status: "VALIDATED",
      bankCode: "999",
      productType: "CHECKING",
      formats: ["CSV"],
      detection: {
        requiredHeaderGroups: [["Data"], ["Descrição"], ["Débito", "Crédito"]],
        minimumScore: 70,
      },
      columns: {
        date: ["Data"],
        description: ["Descrição"],
        debit: ["Débito"],
        credit: ["Crédito"],
        balance: ["Saldo"],
      },
      rules: { headerScanRows: 20, negativeAmountMeansDebit: true },
    };
    const repository: LayoutRepository = {
      save: async () => undefined,
      findAll: async () => [csvProfile],
      findById: async () => csvProfile,
    };
    const csv = Buffer.from([
      "Data;Descrição;Débito;Crédito;Saldo",
      "10/12/2025;TARIFA;10,00;;90,00",
      "11/12/2025;RECEBIMENTO;;100,00;190,00",
    ].join("\n"));

    const inspection = await new InspectLayoutUseCase(repository).execute("extrato.csv", csv);

    expect(inspection.detection.match?.profileId).toBe("bank-csv-v1");
    expect(inspection.suggestedColumns).toMatchObject({ DATE: 0, DESCRIPTION: 1, DEBIT: 2, CREDIT: 3, BALANCE: 4 });
    expect(inspection.normalizedPreview).toEqual([
      expect.objectContaining({ nature: "DEBIT", amount: "10.00", rowNumber: 2 }),
      expect.objectContaining({ nature: "CREDIT", amount: "100.00", rowNumber: 3 }),
    ]);
  });
});
