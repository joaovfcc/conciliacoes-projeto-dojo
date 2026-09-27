import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseTabularStatement } from "../../../src/parsers/tabular.js";
import { BRADESCO_CHECKING_XLSX_V1 } from "../../../src/statements/profiles/bradesco-checking-xlsx-v1.js";
import { BB_CHECKING_XLSX_V1 } from "../../../src/statements/profiles/bb-checking-xlsx-v1.js";
import { SANTANDER_CHECKING_XLSX_V1 } from "../../../src/statements/profiles/santander-checking-xlsx-v1.js";
import { CAIXA_CHECKING_XLSX_V1 } from "../../../src/statements/profiles/caixa-checking-xlsx-v1.js";
import { ITAU_CHECKING_XLSX_V1 } from "../../../src/statements/profiles/itau-checking-xlsx-v1.js";
import { GENERIC_STATEMENT_V1 } from "../../../src/statements/profiles/generic-statement-v1.js";
import type { SourceFileInput } from "../../../src/parsers/types.js";

const ALL_PROFILES = [
  ITAU_CHECKING_XLSX_V1,
  BRADESCO_CHECKING_XLSX_V1,
  BB_CHECKING_XLSX_V1,
  SANTANDER_CHECKING_XLSX_V1,
  CAIXA_CHECKING_XLSX_V1,
  GENERIC_STATEMENT_V1,
];

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

function input(name: string, buffer: Buffer): SourceFileInput {
  return {
    id: `test-${name}`,
    originalName: `${name}.xlsx`,
    kind: "STATEMENT",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  };
}

describe("Multi-bank XLSX profile detection", () => {
  it("should detect Bradesco layout with docto. header (Bradesco-specific)", async () => {
    const buffer = await createXlsxBuffer("Bradesco", [
      ["Bradesco Net Empresa"],
      ["Agência: 3456 Conta: 12345-0"],
      [],
      ["data", "histórico", "docto.", "débito", "crédito", "saldo"],
      ["02/01/2026", "PAGAMENTO FORNECEDOR", "DOC100", "500.00", "", "9500.00"],
      ["03/01/2026", "RECEBIMENTO PIX", "DOC200", "", "1000.00", "10500.00"],
    ]);

    const { records, metadata, issues } = await parseTabularStatement(input("bradesco", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(metadata.parser).toBe("bradesco-checking-xlsx-v1");
    expect(records).toHaveLength(2);
    expect(records[0]!.value).toBe("-500.00");
    expect(records[1]!.value).toBe("1000.00");
  });

  it("detecta o XLSX Bradesco de valor único sem classificá-lo como Itaú", async () => {
    const buffer = await createXlsxBuffer("Lançamentos", [
      ["Atualização:", "31/12/2025 10:18"],
      ["Nome:", "EMPRESA EXEMPLO"],
      ["Agência:", "3394"],
      ["Conta:", "0012545-8"],
      [],
      ["Data", "Lançamento", "Ag/origem", "Razão Social", "CPF/CNPJ", "Valor (R$)", "Saldo (R$)"],
      ["28/11/2025", "SALDO ANTERIOR", "", "", "", "", "1.000,00"],
      ["01/12/2025", "TRANSFERENCIA PIX", "339401", "EMPRESA", "", "200,00", "1.200,00"],
      ["02/12/2025", "PAGAMENTO", "339402", "FORNECEDOR", "", "-50,00", "1.150,00"],
    ]);

    const { records, metadata, issues } = await parseTabularStatement(input("Bradesco_0012545-8_dados_limpos", buffer), ALL_PROFILES);

    expect(issues.filter((item) => item.severity === "ERROR")).toHaveLength(0);
    expect(metadata).toMatchObject({
      bank: "237",
      agency: "3394",
      account: "0012545-8",
      parser: "bradesco-checking-xlsx-v1",
    });
    expect(records).toHaveLength(2);
  });

  it("should detect BB layout with débito (r$)/crédito (r$) headers", async () => {
    const buffer = await createXlsxBuffer("Banco do Brasil", [
      ["Banco do Brasil S.A."],
      ["Agência: 1234-5 Conta: 67890-1"],
      [],
      ["data", "histórico", "documento", "débito (r$)", "crédito (r$)", "saldo (r$)"],
      ["05/01/2026", "TARIFA MENSAL", "DOC300", "30.00", "", "9970.00"],
      ["06/01/2026", "TED RECEBIDA", "DOC400", "", "2000.00", "11970.00"],
    ]);

    const { records, metadata, issues } = await parseTabularStatement(input("bb", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(metadata.parser).toBe("bb-checking-xlsx-v1");
    expect(records).toHaveLength(2);
    expect(records[0]!.value).toBe("-30.00");
    expect(records[1]!.value).toBe("2000.00");
  });

  it("should detect Santander layout by sheet name", async () => {
    const buffer = await createXlsxBuffer("Santander", [
      ["Santander Empresarial"],
      ["Agência: 5678 Conta: 11223-4"],
      [],
      ["data", "histórico", "documento", "valor", "saldo"],
      ["10/01/2026", "PAGAMENTO BOLETO", "DOC500", "-250.00", "9750.00"],
      ["11/01/2026", "DEPOSITO", "DOC600", "800.00", "10550.00"],
    ]);

    const { records, metadata, issues } = await parseTabularStatement(input("santander", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(metadata.parser).toBe("santander-checking-xlsx-v1");
    expect(records).toHaveLength(2);
    expect(records[0]!.value).toBe("-250.00");
    expect(records[1]!.value).toBe("800.00");
  });

  it("should detect Caixa layout with discriminação header (Caixa-specific)", async () => {
    const buffer = await createXlsxBuffer("Caixa", [
      ["Caixa Econômica Federal"],
      ["Agência: 0001 Conta: 99887-6"],
      [],
      ["data mov.", "discriminação", "número documento", "valor", "saldo"],
      ["15/01/2026", "SAQUE ATM", "DOC700", "-200.00", "9800.00"],
      ["16/01/2026", "DEP DINHEIRO", "DOC800", "500.00", "10300.00"],
    ]);

    const { records, metadata, issues } = await parseTabularStatement(input("caixa", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(metadata.parser).toBe("caixa-checking-xlsx-v1");
    expect(records).toHaveLength(2);
    expect(records[0]!.value).toBe("-200.00");
    expect(records[1]!.value).toBe("500.00");
  });

  it("should still detect Itaú layout correctly with all profiles present", async () => {
    const buffer = await createXlsxBuffer("lançamentos", [
      ["Itaú Empresas"],
      ["Agência: 0191", "Conta: 0026775-6"],
      [],
      ["data", "lançamento", "documento", "valor (R$)", "saldo (R$)"],
      ["03/12/2025", "TARIFA BANCARIA", "12345", "-10.00", "90.00"],
      ["04/12/2025", "RECEBIMENTO PIX", "54321", "500.00", "590.00"],
    ]);

    const { records, metadata, issues } = await parseTabularStatement(input("itau", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(metadata.parser).toBe("itau-checking-xlsx-v1");
    expect(records).toHaveLength(2);
  });

  it("should fallback to generic profile for unknown bank with standard headers", async () => {
    const buffer = await createXlsxBuffer("Extrato", [
      ["Banco Desconhecido"],
      [],
      ["data", "descrição", "valor", "saldo"],
      ["20/01/2026", "TRANSFERENCIA", "-100.00", "9900.00"],
      ["21/01/2026", "DEPOSITO", "300.00", "10200.00"],
    ]);

    const { records, issues } = await parseTabularStatement(input("unknown", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(records).toHaveLength(2);
  });

  it("aplica exclusão de saldo somente ao perfil selecionado em cada aba", async () => {
    const workbook = new ExcelJS.Workbook();
    const itau = workbook.addWorksheet("lançamentos");
    [
      ["Itaú Empresas"],
      ["Agência: 0191", "Conta: 0026775-6"],
      ["data", "lançamento", "valor (R$)", "saldo (R$)"],
      ["01/01/2026", "APL APLIC AUT MAIS", "-50.00", ""],
    ].forEach((row) => itau.addRow(row));
    const generic = workbook.addWorksheet("Extrato genérico");
    [
      ["Banco Desconhecido"],
      ["data", "descrição", "valor", "saldo"],
      ["02/01/2026", "APL APLIC AUT MAIS", "10.00", ""],
    ].forEach((row) => generic.addRow(row));
    const buffer = (await workbook.xlsx.writeBuffer()) as any;

    const { metadata, records } = await parseTabularStatement(input("multi-profile", buffer), ALL_PROFILES);

    expect(records).toHaveLength(2);
    expect(metadata.balanceCheck).toMatchObject({ movementTotal: "10.00" });
  });

  it("should handle dt balancete header", async () => {
    const buffer = await createXlsxBuffer("Extrato", [
      ["Relatório Contábil"],
      [],
      ["dt balancete", "descrição", "valor", "saldo"],
      ["25/01/2026", "LANÇAMENTO CONTABIL", "-50.00", "9950.00"],
      ["26/01/2026", "AJUSTE", "75.00", "10025.00"],
    ]);

    const { records, issues } = await parseTabularStatement(input("balancete-dt", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(records).toHaveLength(2);
    expect(records[0]!.date).toBe("2026-01-25");
  });

  it("should handle data balancete header with débito/crédito columns", async () => {
    const buffer = await createXlsxBuffer("Extrato", [
      ["Relatório Contábil"],
      [],
      ["data balancete", "histórico", "débito", "crédito", "saldo"],
      ["28/01/2026", "PAGAMENTO", "120.00", "", "9880.00"],
      ["29/01/2026", "RECEBIMENTO", "", "200.00", "10080.00"],
    ]);

    const { records, issues } = await parseTabularStatement(input("balancete-data", buffer), ALL_PROFILES);

    expect(issues.filter(i => i.severity === "ERROR")).toHaveLength(0);
    expect(records).toHaveLength(2);
    expect(records[0]!.date).toBe("2026-01-28");
    expect(records[0]!.value).toBe("-120.00");
    expect(records[1]!.value).toBe("200.00");
  });
});
