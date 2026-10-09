import { describe, expect, it } from "vitest";

import { parseStatement } from "../../../src/statements/generic-statement-parser.js";
import type { StatementLayoutProfile } from "../../../src/statements/statement-types.js";
import type { ExtractedTabularSheet } from "../../../src/tabular/tabular-types.js";

const PROFILE: StatementLayoutProfile = {
  id: "ambiguous-columns-v1",
  version: 1,
  status: "EXPERIMENTAL",
  bankCode: "",
  productType: "CHECKING",
  formats: ["XLSX"],
  detection: { requiredHeaderGroups: [], minimumScore: 0 },
  columns: {
    date: ["data"],
    description: ["historico"],
    amount: ["valor"],
  },
  rules: { headerScanRows: 10, negativeAmountMeansDebit: true },
};

describe("generic statement column mapping", () => {
  it("does not reuse one composite header for multiple semantic roles", () => {
    const sheet: ExtractedTabularSheet = {
      index: 0,
      name: "Extrato",
      hidden: false,
      rows: [
        {
          rowNumber: 1,
          cells: [
            { columnIndex: 0, rawValue: "Data / Valor", displayValue: "Data / Valor" },
            { columnIndex: 1, rawValue: "Historico", displayValue: "Historico" },
          ],
        },
        {
          rowNumber: 2,
          cells: [
            { columnIndex: 0, rawValue: "01/12/2025", displayValue: "01/12/2025" },
            { columnIndex: 1, rawValue: "PAGAMENTO", displayValue: "PAGAMENTO" },
          ],
        },
      ],
    };

    const result = parseStatement(sheet, PROFILE, 0, "XLSX");

    expect(result.transactions).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "COLUMN_MAPPING_INCOMPLETE" }),
    ]);
  });
});

describe("generic statement date inheritance and multiline handling", () => {
  const PROFILE_WITH_INHERITANCE: StatementLayoutProfile = {
    id: "test-inheritance-v1",
    version: 1,
    status: "EXPERIMENTAL",
    bankCode: "237",
    productType: "CHECKING",
    formats: ["XLSX"],
    detection: { requiredHeaderGroups: [], minimumScore: 0 },
    columns: {
      date: ["data"],
      description: ["historico"],
      amount: ["valor"],
    },
    rules: {
      headerScanRows: 10,
      negativeAmountMeansDebit: true,
      inheritDateFromPreviousRow: true,
    },
  };

  const PROFILE_WITHOUT_INHERITANCE: StatementLayoutProfile = {
    ...PROFILE_WITH_INHERITANCE,
    id: "test-no-inheritance-v1",
    rules: {
      ...PROFILE_WITH_INHERITANCE.rules,
      inheritDateFromPreviousRow: false,
    },
  };

  it("inherits date from previous row when inheritDateFromPreviousRow is true and row has amount", () => {
    const sheet: ExtractedTabularSheet = {
      index: 0,
      name: "Extrato",
      hidden: false,
      rows: [
        {
          rowNumber: 1,
          cells: [
            { columnIndex: 0, rawValue: "Data", displayValue: "Data" },
            { columnIndex: 1, rawValue: "Historico", displayValue: "Historico" },
            { columnIndex: 2, rawValue: "Valor", displayValue: "Valor" },
          ],
        },
        {
          rowNumber: 2,
          cells: [
            { columnIndex: 0, rawValue: "01/12/2025", displayValue: "01/12/2025" },
            { columnIndex: 1, rawValue: "PRIMEIRO LANCAMENTO", displayValue: "PRIMEIRO LANCAMENTO" },
            { columnIndex: 2, rawValue: "100.00", displayValue: "100.00" },
          ],
        },
        {
          rowNumber: 3,
          cells: [
            { columnIndex: 0, rawValue: "", displayValue: "" },
            { columnIndex: 1, rawValue: "SEGUNDO LANCAMENTO MESMO DIA", displayValue: "SEGUNDO LANCAMENTO MESMO DIA" },
            { columnIndex: 2, rawValue: "250.00", displayValue: "250.00" },
          ],
        },
      ],
    };

    const result = parseStatement(sheet, PROFILE_WITH_INHERITANCE, 0, "XLSX");

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]!.date).toBe("2025-12-01");
    expect(result.transactions[0]!.description).toBe("PRIMEIRO LANCAMENTO");
    expect(result.transactions[0]!.amount).toBe(100);

    expect(result.transactions[1]!.date).toBe("2025-12-01");
    expect(result.transactions[1]!.description).toBe("SEGUNDO LANCAMENTO MESMO DIA");
    expect(result.transactions[1]!.amount).toBe(250);
  });

  it("concatenates description to previous transaction when row has no amount (multiline description)", () => {
    const sheet: ExtractedTabularSheet = {
      index: 0,
      name: "Extrato",
      hidden: false,
      rows: [
        {
          rowNumber: 1,
          cells: [
            { columnIndex: 0, rawValue: "Data", displayValue: "Data" },
            { columnIndex: 1, rawValue: "Historico", displayValue: "Historico" },
            { columnIndex: 2, rawValue: "Valor", displayValue: "Valor" },
          ],
        },
        {
          rowNumber: 2,
          cells: [
            { columnIndex: 0, rawValue: "01/12/2025", displayValue: "01/12/2025" },
            { columnIndex: 1, rawValue: "LINHA PRINCIPAL", displayValue: "LINHA PRINCIPAL" },
            { columnIndex: 2, rawValue: "100.00", displayValue: "100.00" },
          ],
        },
        {
          rowNumber: 3,
          cells: [
            { columnIndex: 0, rawValue: "", displayValue: "" },
            { columnIndex: 1, rawValue: "COMPLEMENTO TEXTO", displayValue: "COMPLEMENTO TEXTO" },
            { columnIndex: 2, rawValue: "", displayValue: "" },
          ],
        },
      ],
    };

    const result = parseStatement(sheet, PROFILE_WITH_INHERITANCE, 0, "XLSX");

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.date).toBe("2025-12-01");
    expect(result.transactions[0]!.description).toBe("LINHA PRINCIPAL COMPLEMENTO TEXTO");
    expect(result.transactions[0]!.amount).toBe(100);
  });

  it("does not inherit date when inheritDateFromPreviousRow is false (negative test)", () => {
    const sheet: ExtractedTabularSheet = {
      index: 0,
      name: "Extrato",
      hidden: false,
      rows: [
        {
          rowNumber: 1,
          cells: [
            { columnIndex: 0, rawValue: "Data", displayValue: "Data" },
            { columnIndex: 1, rawValue: "Historico", displayValue: "Historico" },
            { columnIndex: 2, rawValue: "Valor", displayValue: "Valor" },
          ],
        },
        {
          rowNumber: 2,
          cells: [
            { columnIndex: 0, rawValue: "01/12/2025", displayValue: "01/12/2025" },
            { columnIndex: 1, rawValue: "PRIMEIRO LANCAMENTO", displayValue: "PRIMEIRO LANCAMENTO" },
            { columnIndex: 2, rawValue: "100.00", displayValue: "100.00" },
          ],
        },
        {
          rowNumber: 3,
          cells: [
            { columnIndex: 0, rawValue: "", displayValue: "" },
            { columnIndex: 1, rawValue: "SEGUNDO LANCAMENTO SEM DATA", displayValue: "SEGUNDO LANCAMENTO SEM DATA" },
            { columnIndex: 2, rawValue: "250.00", displayValue: "250.00" },
          ],
        },
      ],
    };

    const result = parseStatement(sheet, PROFILE_WITHOUT_INHERITANCE, 0, "XLSX");

    // Only the row with an explicit date is parsed
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.description).toBe("PRIMEIRO LANCAMENTO");
  });

  it("skips dateless row when there is no previous date (negative test)", () => {
    const sheet: ExtractedTabularSheet = {
      index: 0,
      name: "Extrato",
      hidden: false,
      rows: [
        {
          rowNumber: 1,
          cells: [
            { columnIndex: 0, rawValue: "Data", displayValue: "Data" },
            { columnIndex: 1, rawValue: "Historico", displayValue: "Historico" },
            { columnIndex: 2, rawValue: "Valor", displayValue: "Valor" },
          ],
        },
        {
          rowNumber: 2,
          cells: [
            { columnIndex: 0, rawValue: "", displayValue: "" },
            { columnIndex: 1, rawValue: "LANCAMENTO SEM DATA INICIAL", displayValue: "LANCAMENTO SEM DATA INICIAL" },
            { columnIndex: 2, rawValue: "100.00", displayValue: "100.00" },
          ],
        },
      ],
    };

    const result = parseStatement(sheet, PROFILE_WITH_INHERITANCE, 0, "XLSX");

    expect(result.transactions).toHaveLength(0);
  });
});
