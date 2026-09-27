import { describe, it, expect } from "vitest";
import { normalizeText, parseFlexibleMoney } from "../../../src/parsers/text-normalization.js";
import { matchesColumnRole } from "../../../src/parsers/header-aliases.js";
import { extractBankMetadataFromLines, isValidAccountNumber } from "../../../src/parsers/bank-metadata-extractor.js";
import { discoverSheetLayout } from "../../../src/parsers/layout-discovery.js";
import { parseStatement } from "../../../src/statements/generic-statement-parser.js";
import { GENERIC_STATEMENT_V1 } from "../../../src/statements/profiles/generic-statement-v1.js";
import { SANTANDER_CHECKING_XLSX_V1 } from "../../../src/statements/profiles/santander-checking-xlsx-v1.js";
import type { ExtractedTabularSheet } from "../../../src/tabular/tabular-types.js";

function makeSheet(name: string, rowsMatrix: string[][]): ExtractedTabularSheet {
  return {
    name,
    index: 0,
    hidden: false,
    rows: rowsMatrix.map((rowCells, rIndex) => ({
      rowNumber: rIndex + 1,
      cells: rowCells.map((val, cIndex) => ({
        columnIndex: cIndex,
        rawValue: val,
        displayValue: val,
      })),
    })),
  };
}

describe("Generic Discovery & Bank Metadata Architecture", () => {
  describe("Text Normalization & Flexible Money", () => {
    it("normalizes text and removes accents and special chars", () => {
      expect(normalizeText("Valor (R$)")).toBe("valor r");
      expect(normalizeText("VALOR R$")).toBe("valor r");
      expect(normalizeText("Histórico")).toBe("historico");
      expect(normalizeText("Descrição")).toBe("descricao");
      expect(normalizeText("Lançamento")).toBe("lancamento");
      expect(normalizeText("C/C.")).toBe("c c");
      expect(normalizeText("Conta Corrente")).toBe("conta corrente");
      expect(normalizeText("Agência")).toBe("agencia");
    });

    it("parses diverse money formats including Brazilian, negative prefixes, parentheses and suffixes", () => {
      expect(parseFlexibleMoney("1.000,00").toNumber()).toBe(1000);
      expect(parseFlexibleMoney("-1.000,00").toNumber()).toBe(-1000);
      expect(parseFlexibleMoney("(1.000,00)").toNumber()).toBe(-1000);
      expect(parseFlexibleMoney("1.000,00 D").toNumber()).toBe(-1000);
      expect(parseFlexibleMoney("1.000,00 C").toNumber()).toBe(1000);
      expect(parseFlexibleMoney("R$ 2.500,50").toNumber()).toBe(2500.5);
      expect(parseFlexibleMoney("-250.75").toNumber()).toBe(-250.75);
    });
  });

  describe("Bank Metadata Extractor", () => {
    it("1. extracts bank, agency and account from 'BANCO SANTANDER AG. 3377 C/C. 130002439'", () => {
      const candidate = extractBankMetadataFromLines(["BANCO SANTANDER AG. 3377 C/C. 130002439"]);
      expect(candidate.bank).toBe("SANTANDER");
      expect(candidate.agency).toBe("3377");
      expect(candidate.account).toBe("130002439");
    });

    it("2. extracts bank, agency and account from 'BANCO SANTANDER AG 3377 CC 130002439'", () => {
      const candidate = extractBankMetadataFromLines(["BANCO SANTANDER AG 3377 CC 130002439"]);
      expect(candidate.bank).toBe("SANTANDER");
      expect(candidate.agency).toBe("3377");
      expect(candidate.account).toBe("130002439");
    });

    it("3. extracts bank, agency and account from 'Santander Agência: 3377 Conta: 130002439'", () => {
      const candidate = extractBankMetadataFromLines(["Santander Agência: 3377 Conta: 130002439"]);
      expect(candidate.bank).toBe("SANTANDER");
      expect(candidate.agency).toBe("3377");
      expect(candidate.account).toBe("130002439");
    });

    it("4. does NOT capture 'Corrente' as an account number from 'Extrato Santander - Conta Corrente'", () => {
      expect(isValidAccountNumber("Corrente")).toBe(false);
      expect(isValidAccountNumber("Extrato")).toBe(false);
      expect(isValidAccountNumber("Saldo")).toBe(false);

      const candidate = extractBankMetadataFromLines(["Extrato Santander - Conta Corrente"]);
      expect(candidate.bank).toBe("SANTANDER");
      expect(candidate.account).toBeUndefined();
    });

    it("5. captures the real account when preceded by 'Conta Corrente' header", () => {
      const candidate = extractBankMetadataFromLines([
        "Extrato Santander - Conta Corrente",
        "Empresa SPREAD SISTEMAS E AUTOMACAO LTDA Agência 3377 Conta 130002439",
      ]);
      expect(candidate.bank).toBe("SANTANDER");
      expect(candidate.agency).toBe("3377");
      expect(candidate.account).toBe("130002439");
    });
  });

  describe("Layout Discovery Engine", () => {
    it("6. recognizes sheet called 'Extrato'", () => {
      const sheet = makeSheet("Extrato", [
        ["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"],
        ["01/12/2025", "PAGTO TARIFA", "1234", "-50,00", "950,00"],
      ]);
      const layout = discoverSheetLayout(sheet);
      expect(layout).not.toBeNull();
      expect(layout?.sheetName).toBe("Extrato");
      expect(layout?.headerRowIndex).toBe(0);
      expect(layout?.columns.date).toBe(0);
      expect(layout?.columns.description).toBe(1);
      expect(layout?.columns.document).toBe(2);
      expect(layout?.columns.amount).toBe(3);
      expect(layout?.columns.balance).toBe(4);
    });

    it("7. recognizes Santander header 'Data | Histórico | Documento | Valor (R$) | Saldo (R$)'", () => {
      const sheet = makeSheet("Extrato", [
        ["Extrato Santander - Conta Corrente", "", "", "", ""],
        ["Empresa", "SPREAD SISTEMAS", "Agência", "3377", "Conta 130002439"],
        ["Período consultado", "01/12/2025 a 31/12/2025", "", "", ""],
        ["Saldo disponível", "1000,00", "", "", ""],
        ["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"],
        ["08/12/2025", "TARIFA PACOTE SERVICOS", "000000", "-185,00", "0,00"],
        ["26/12/2025", "PIX RECEBIDO", "000000", "1000,00", "1000,00"],
      ]);
      const layout = discoverSheetLayout(sheet);
      expect(layout).not.toBeNull();
      expect(layout?.headerRowIndex).toBe(4);
      expect(layout?.metadata.bank).toBe("SANTANDER");
      expect(layout?.metadata.agency).toBe("3377");
      expect(layout?.metadata.account).toBe("130002439");
    });
  });

  describe("Generic Statement Parser Variations", () => {
    it("8. parses statement with single column 'Valor'", () => {
      const sheet = makeSheet("Sheet1", [
        ["Data", "Descricao", "Valor"],
        ["01/12/2025", "CREDITO PIX", "1500,00"],
        ["02/12/2025", "DEBITO TARIFA", "-50,00"],
      ]);
      const parsed = parseStatement(sheet, GENERIC_STATEMENT_V1, 0, "XLSX");
      expect(parsed.transactions.length).toBe(2);
      expect(parsed.transactions[0]!.amount).toBe(1500);
      expect(parsed.transactions[0]!.direction).toBe("CREDIT");
      expect(parsed.transactions[1]!.amount).toBe(50);
      expect(parsed.transactions[1]!.direction).toBe("DEBIT");
    });

    it("9. parses statement with separate 'Débito' and 'Crédito' columns", () => {
      const sheet = makeSheet("Movimentos", [
        ["Data", "Historico", "Debito", "Credito"],
        ["01/12/2025", "DEBITO COMPRA", "120,00", ""],
        ["02/12/2025", "CREDITO SALARIO", "", "3500,00"],
      ]);
      const parsed = parseStatement(sheet, GENERIC_STATEMENT_V1, 0, "XLSX");
      expect(parsed.transactions.length).toBe(2);
      expect(parsed.transactions[0]!.amount).toBe(120);
      expect(parsed.transactions[0]!.direction).toBe("DEBIT");
      expect(parsed.transactions[1]!.amount).toBe(3500);
      expect(parsed.transactions[1]!.direction).toBe("CREDIT");
    });

    it("10. parses statement with 'Valor' and 'D/C' indicator column", () => {
      const sheet = makeSheet("Lancamentos", [
        ["Data", "Historico", "Valor", "D/C"],
        ["01/12/2025", "TAXA MANUTENCAO", "30,00", "D"],
        ["02/12/2025", "TRANSFERENCIA RECEBIDA", "800,00", "C"],
      ]);
      const parsed = parseStatement(sheet, GENERIC_STATEMENT_V1, 0, "XLSX");
      expect(parsed.transactions.length).toBe(2);
      expect(parsed.transactions[0]!.amount).toBe(30);
      expect(parsed.transactions[0]!.direction).toBe("DEBIT");
      expect(parsed.transactions[1]!.amount).toBe(800);
      expect(parsed.transactions[1]!.direction).toBe("CREDIT");
    });

    it("11-13. supports headers starting at varying row positions (row 1, 5, 10)", () => {
      // Row 5 header
      const rowsAt5 = [
        ["Empresa XPTO", "", ""],
        ["Banco do Brasil", "", ""],
        ["Agência: 1234", "Conta: 56789-0", ""],
        ["Extrato Mensal", "", ""],
        ["Data", "Histórico", "Valor"],
        ["10/12/2025", "TED RECEBIDA", "2000,00"],
      ];
      const sheet5 = makeSheet("Extrato", rowsAt5);
      const parsed5 = parseStatement(sheet5, GENERIC_STATEMENT_V1, 4, "XLSX");
      expect(parsed5.transactions.length).toBe(1);
      expect(parsed5.transactions[0]!.amount).toBe(2000);
      expect(parsed5.metadata?.bank).toBe("001");
      expect(parsed5.metadata?.agency).toBe("1234");
      expect(parsed5.metadata?.account).toBe("56789-0");
    });

    it("14-15. supports generic sheet names like 'Sheet1' or 'Movimentação'", () => {
      const sheet = makeSheet("Movimentação", [
        ["Data", "Historico", "Valor"],
        ["15/12/2025", "PAGTO BOLETO", "-450,00"],
      ]);
      const parsed = parseStatement(sheet, GENERIC_STATEMENT_V1, 0, "XLSX");
      expect(parsed.transactions.length).toBe(1);
      expect(parsed.transactions[0]!.description).toBe("PAGTO BOLETO");
    });

    it("16-19. supports negative number notations (minus, parentheses, D/C suffixes)", () => {
      const sheet = makeSheet("Extrato", [
        ["Data", "Historico", "Valor"],
        ["01/12/2025", "VALOR COM MINUS", "-100,00"],
        ["02/12/2025", "VALOR COM PARENTESES", "(200,00)"],
        ["03/12/2025", "VALOR SUFIXO D", "300,00 D"],
        ["04/12/2025", "VALOR SUFIXO C", "400,00 C"],
      ]);
      const parsed = parseStatement(sheet, GENERIC_STATEMENT_V1, 0, "XLSX");
      expect(parsed.transactions.length).toBe(4);
      expect(parsed.transactions[0]!.direction).toBe("DEBIT");
      expect(parsed.transactions[0]!.amount).toBe(100);

      expect(parsed.transactions[1]!.direction).toBe("DEBIT");
      expect(parsed.transactions[1]!.amount).toBe(200);

      expect(parsed.transactions[2]!.direction).toBe("DEBIT");
      expect(parsed.transactions[2]!.amount).toBe(300);

      expect(parsed.transactions[3]!.direction).toBe("CREDIT");
      expect(parsed.transactions[3]!.amount).toBe(400);
    });

    it("20-22. ensures structural balance lines NEVER become transactions", () => {
      const sheet = makeSheet("Extrato", [
        ["Data", "Historico", "Valor", "Saldo"],
        ["01/12/2025", "SALDO ANTERIOR", "", "500,00"],
        ["02/12/2025", "TED RECEBIDA", "1000,00", "1500,00"],
        ["03/12/2025", "SALDO DISPONIVEL", "", "1500,00"],
        ["04/12/2025", "SALDO EM INVESTIMENTOS", "", "2000,00"],
        ["05/12/2025", "SALDO FINAL", "", "1500,00"],
      ]);
      const parsed = parseStatement(sheet, GENERIC_STATEMENT_V1, 0, "XLSX");
      expect(parsed.transactions.length).toBe(1);
      expect(parsed.transactions[0]!.description).toBe("TED RECEBIDA");
      expect(parsed.transactions[0]!.amount).toBe(1000);
      expect(parsed.metadata?.openingBalance).toBe(500);
      expect(parsed.metadata?.closingBalance).toBe(1500);
    });
  });
});
