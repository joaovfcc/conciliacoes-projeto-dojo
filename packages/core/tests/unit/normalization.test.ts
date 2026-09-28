import { describe, expect, it } from "vitest";
import {
  parseDate,
  ledgerAccountsMatch,
  normalizeLedgerAccount,
} from "../../src/normalization.js";
import { isLedgerStructureRow } from "../../src/parsers/tabular-utils.js";

describe("Flexibilização do parseDate", () => {
  it("deve parsear datas no formato brasileiro padrão (DD/MM/YYYY e DD/MM/YY)", () => {
    expect(parseDate("31/12/2025")).toBe("2025-12-31");
    expect(parseDate("05/01/2026")).toBe("2026-01-05");
    expect(parseDate("05/01/26")).toBe("2026-01-05");
    expect(parseDate("15/08/99")).toBe("1999-08-15");
  });

  it("deve parsear datas com 1 dígito de dia ou mês", () => {
    expect(parseDate("1/2/26")).toBe("2026-02-01");
    expect(parseDate("5/10/2025")).toBe("2025-10-05");
    expect(parseDate("15/1/2026")).toBe("2026-01-15");
    expect(parseDate("1/1/2026")).toBe("2026-01-01");
  });

  it("deve desambiguar e parsear formato americano (MM/DD/YYYY ou MM/DD/YY)", () => {
    // 12/31/25 não pode ser mês 31, então é mês 12, dia 31, ano 2025
    expect(parseDate("12/31/25")).toBe("2025-12-31");
    expect(parseDate("09/25/2025")).toBe("2025-09-25");
    expect(parseDate("1/30/2026")).toBe("2026-01-30");
  });

  it("deve aceitar separadores traço e ponto", () => {
    expect(parseDate("05-01-2026")).toBe("2026-01-05");
    expect(parseDate("2026.01.05")).toBe("2026-01-05");
    expect(parseDate("2026/01/05")).toBe("2026-01-05");
  });

  it("deve aceitar datas em formato ISO e YYYYMMDD", () => {
    expect(parseDate("2026-01-05")).toBe("2026-01-05");
    expect(parseDate("20260105")).toBe("2026-01-05");
  });

  it("deve aceitar números seriais do Excel", () => {
    expect(parseDate(45292)).toBe("2024-01-01");
  });

  it("deve rejeitar datas inválidas ou impossíveis", () => {
    expect(() => parseDate("32/01/2026")).toThrow(/Data inválida/);
    expect(() => parseDate("31/02/2026")).toThrow(/Data inválida/);
    expect(() => parseDate("")).toThrow(/Data inválida/);
    expect(() => parseDate("abc")).toThrow(/Data inválida/);
  });
});

describe("Comparação de contas contábeis (ledgerAccountsMatch)", () => {
  it("deve casar contas contábeis ignorando pontos e caracteres de máscara", () => {
    expect(ledgerAccountsMatch("1.1.1.0.2027", "11102027")).toBe(true);
    expect(ledgerAccountsMatch("1.1.1.02.001", "11102001")).toBe(true);
    expect(ledgerAccountsMatch("1.1.1.02.001-A", "11102001A")).toBe(true);
  });

  it("deve casar contas contábeis numéricas tolerando zeros à esquerda", () => {
    expect(ledgerAccountsMatch("0011102027", "11102027")).toBe(true);
    expect(ledgerAccountsMatch("1.1.1.0.2027", "0011102027")).toBe(true);
  });

  it("deve rejeitar contas distintas", () => {
    expect(ledgerAccountsMatch("1.1.1.0.2027", "1.1.1.0.2028")).toBe(false);
    expect(ledgerAccountsMatch("11102027", "11102028")).toBe(false);
  });

  it("deve retornar falso para valores ausentes ou vazios", () => {
    expect(ledgerAccountsMatch("", "11102027")).toBe(false);
    expect(ledgerAccountsMatch(undefined, "11102027")).toBe(false);
    expect(ledgerAccountsMatch(null, null)).toBe(false);
  });
});

describe("Identificação de linhas estruturais de Razão (isLedgerStructureRow)", () => {
  it("deve ignorar rodapés e totalizadores espaçados do Protheus", () => {
    expect(
      isLedgerStructureRow({
        DATE: "",
        HISTORY: "T o t a i s   d a   C o n t a   ==>",
        DEBIT: "1000.00",
        CREDIT: "500.00",
      })
    ).toBe(true);

    expect(
      isLedgerStructureRow({
        DATE: "T O T A L   G E R A L   ==>",
        HISTORY: "",
        DEBIT: "50000.00",
        CREDIT: "50000.00",
      })
    ).toBe(true);

    expect(
      isLedgerStructureRow({
        DOCUMENT: "==>",
        HISTORY: "T o t a i s   d a   C o n t a",
      })
    ).toBe(true);
  });

  it("deve ignorar linhas de saldo inicial, final ou cabeçalhos repetidos", () => {
    expect(
      isLedgerStructureRow({
        DATE: "01/01/2026",
        HISTORY: "SALDO ANTERIOR",
        BALANCE: "10000.00",
      })
    ).toBe(true);

    expect(
      isLedgerStructureRow({
        DATE: "DATA",
        HISTORY: "HISTORICO",
      })
    ).toBe(true);
  });

  it("não deve considerar linhas de lançamentos normais como estruturais", () => {
    expect(
      isLedgerStructureRow({
        DATE: "05/01/2026",
        DOCUMENT: "NF 12345",
        HISTORY: "PAGAMENTO FORNECEDOR ABC LTDA",
        DEBIT: "1500.00",
      })
    ).toBe(false);

    expect(
      isLedgerStructureRow({
        DATE: "1/2/26",
        DOCUMENT: "PIX",
        HISTORY: "RECEBIMENTO CLIENTE XYZ",
        CREDIT: "2300.00",
      })
    ).toBe(false);
  });
});
