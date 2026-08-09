import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseTabularStatement } from "../../../src/parsers/tabular.js";
import { GENERIC_STATEMENT_V1 } from "../../../src/statements/profiles/generic-statement-v1.js";
import type { SourceFileInput } from "../../../src/parsers/types.js";

async function createXlsxBuffer(
  sheetName: string,
  rows: Array<Array<string | number | Date | null>>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  for (const row of rows) {
    sheet.addRow(row);
  }

  return (await workbook.xlsx.writeBuffer()) as any;
}

describe("Generic Statement XLSX Parser Fallback", () => {
  it("should successfully parse a generic bank statement when no explicit profile matches", async () => {
    // This sheet is named differently and has different headers than Itaú
    const buffer = await createXlsxBuffer("Extrato Mensal", [
      ["Relatório Banco Fictício"],
      ["Ag: 1234 Conta: 5678-9"],
      [],
      // Using standard names that hit the generic checks
      ["data", "descrição", "nº doc.", "débito", "crédito", "saldo"],
      ["01/01/2026", "Saldo Anterior", "", "", "", "100.00"], // Should be ignored
      ["02/01/2026", "Pagamento Fornecedor", "DOC123", "50.00", "", "50.00"],
      ["03/01/2026", "Recebimento Cliente", "DOC456", "", "200.00", "250.00"],
      ["Total do dia", "", "", "", "", ""], // Should be ignored
    ]);

    const input: SourceFileInput = {
      id: "generic-test-1",
      originalName: "banco-ficticio.xlsx",
      kind: "STATEMENT",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };

    const { records, metadata, issues } = await parseTabularStatement(input, [GENERIC_STATEMENT_V1]);

    expect(issues.length).toBe(0);
    // Profile should fallback to generic
    expect(metadata.parser).toBe("generic-statement-v1");

    expect(records.length).toBe(2);

    expect(records[0]!.date).toBe("2026-01-02");
    expect(records[0]!.history).toBe("Pagamento Fornecedor");
    expect(records[0]!.document).toBe("DOC123");
    expect(records[0]!.value).toBe("-50.00"); // Debit logic is configured

    expect(records[1]!.date).toBe("2026-01-03");
    expect(records[1]!.history).toBe("Recebimento Cliente");
    expect(records[1]!.document).toBe("DOC456");
    expect(records[1]!.value).toBe("200.00"); // Credit logic is configured
  });
});
