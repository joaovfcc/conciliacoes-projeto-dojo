import { describe, expect, it } from "vitest";
import { parseCsvSchema, parseCsvDate, parseCsvAmountWithSign } from "../../src/csv-schema";
import type { ExtractedCsvRow } from "../../src/statement-sources";

describe("CSV Schema", () => {
  it("encontra o cabeçalho e mapeia colunas com aliases ignorando linhas iniciais", () => {
    const rows: ExtractedCsvRow[] = [
      { row: 1, cells: ["Extrato Banco XYZ"] },
      { row: 2, cells: [""] },
      { row: 3, cells: ["Data Lançamento", "Histórico", "Valor R$"] },
      { row: 4, cells: ["01/01/2025", "Pagamento", "100,00"] },
    ];
    const schema = {
      columns: [
        { name: "date", aliases: ["data", "data lançamento"], required: true },
        { name: "description", aliases: ["histórico", "descricao"], required: true },
        { name: "amount", aliases: ["valor", "valor r$"], required: true },
      ],
    };
    const result = parseCsvSchema(rows, schema);
    expect(result.headerRow).toBe(2);
    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]!.fields["date"]).toBe("01/01/2025");
    expect(result.parsed[0]!.fields["amount"]).toBe("100,00");
  });

  it("rejeita quando o cabeçalho obrigatório não é encontrado", () => {
    const rows: ExtractedCsvRow[] = [
      { row: 1, cells: ["Extrato Banco XYZ"] },
      { row: 2, cells: ["Data", "Histórico", "Categoria"] }, // Falta o Valor
      { row: 3, cells: ["01/01/2025", "Pagamento", "Compras"] },
    ];
    const schema = {
      columns: [
        { name: "date", aliases: ["data"], required: true },
        { name: "amount", aliases: ["valor"], required: true },
      ],
    };
    expect(() => parseCsvSchema(rows, schema)).toThrowError(/compatível com o schema esperado/);
  });

  it("neutraliza formula injection, mas preserva números negativos", () => {
    const rows: ExtractedCsvRow[] = [
      { row: 1, cells: ["Data", "Descrição", "Valor"] },
      { row: 2, cells: ["01/01/2025", "=CMD()", "100"] },
      { row: 3, cells: ["01/01/2025", "@EVAL()", "-50"] },
      { row: 4, cells: ["01/01/2025", "Normal", "+20"] },
    ];
    const schema = {
      columns: [
        { name: "date", aliases: ["data"], required: true },
        { name: "desc", aliases: ["descrição"], required: true },
        { name: "val", aliases: ["valor"], required: true },
      ],
    };
    const result = parseCsvSchema(rows, schema);
    expect(result.parsed[0]!.fields["desc"]).toBe("'CMD()");
    expect(result.parsed[1]!.fields["desc"]).toBe("'EVAL()");
    // Números com sinal não devem ser prefixados com aspas:
    expect(result.parsed[1]!.fields["val"]).toBe("-50");
    expect(result.parsed[2]!.fields["val"]).toBe("+20");
  });

  it("ignora linhas vazias e repetições de cabeçalho", () => {
    const rows: ExtractedCsvRow[] = [
      { row: 1, cells: ["Data", "Valor"] },
      { row: 2, cells: ["01/01/2025", "100"] },
      { row: 3, cells: ["", ""] },
      { row: 4, cells: ["Data", "Valor"] }, // Repetição na quebra de página
      { row: 5, cells: ["02/01/2025", "200"] },
    ];
    const schema = {
      columns: [
        { name: "date", aliases: ["data"], required: true },
        { name: "amount", aliases: ["valor"], required: true },
      ],
    };
    const result = parseCsvSchema(rows, schema);
    expect(result.parsed).toHaveLength(2);
    expect(result.parsed[0]!.fields["date"]).toBe("01/01/2025");
    expect(result.parsed[1]!.fields["date"]).toBe("02/01/2025");
  });

  describe("normalizadores", () => {
    it("parseCsvDate interpreta data BR com 2 e 4 dígitos no ano", () => {
      expect(parseCsvDate("01/12/25")).toBe("2025-12-01");
      expect(parseCsvDate("01/12/2025")).toBe("2025-12-01");
      expect(parseCsvDate("01-12-2025")).toBe("2025-12-01");
      expect(parseCsvDate("2025-12-01")).toBe("2025-12-01");
      expect(parseCsvDate("inválido")).toBeUndefined();
    });

    it("parseCsvAmountWithSign processa sinal em coluna separada", () => {
      expect(parseCsvAmountWithSign("100,00", "C")).toBe("100.00");
      expect(parseCsvAmountWithSign("100,00", "D")).toBe("-100.00");
      expect(parseCsvAmountWithSign("100,00", "-")).toBe("-100.00");
      expect(parseCsvAmountWithSign("-100,00", "")).toBe("-100.00");
    });
  });
});
