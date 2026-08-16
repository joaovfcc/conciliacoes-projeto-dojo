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
