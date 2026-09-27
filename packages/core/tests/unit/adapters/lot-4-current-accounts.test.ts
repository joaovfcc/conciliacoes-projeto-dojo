import { describe, expect, it } from "vitest";
import { paulistaCurrentAccountAdapter, paulistaLinkedAccountAdapter } from "../../../src/adapters/paulista.js";
import { pineCurrentAccountAdapter, pineLinkedAccountAdapter } from "../../../src/adapters/pine.js";
import { vortxCurrentAccountAdapter } from "../../../src/adapters/vortx.js";
import { safraCurrentAccountAdapter } from "../../../src/adapters/safra.js";
import { safraAutomaticProductsAdapter, safraCoePositionAdapter, safraFundPositionAdapter } from "../../../src/adapters/safra-investments.js";
import type { ExtractedStatementSource } from "../../../src/statement-sources.js";

const sha256 = "4".repeat(64);

describe("adapters de conta-corrente do Lote 4", () => {
  it("separa os layouts Paulista de conta-corrente e conta vinculada", async () => {
    const current = source([[
      "Banco Paulista S. A.", "Conta Corrente", "Rel. demonstrativo de movimentacao para uso interno",
      "0001 AGENCIA: CONTA CORRENTE: 0044642-7", "Data inicial: 01/11/2025",
      "03/11/2025 03/11/2025 13:12:31 426 - TRANSF CONTA VINCULADA 000000000000 500,00 C",
    ].join("\n")]);
    const linked = source([[
      "Banco Paulista S. A.", "Rel. de Extratos para Conferencia de Conta Vinculada", "Conta vinculada",
      "Agencia: 0001", "Conta: 0079007-1", "Data inicial: 01/11/2025", "Data final: 30/11/2025",
      "31/10/2025 0,00 SALDO DISPONIVEL INICIAL", "30/11/2025 0,00 SALDO TOTAL",
    ].join("\n")]);

    expect(paulistaCurrentAccountAdapter.detect(current).matched).toBe(true);
    expect(paulistaCurrentAccountAdapter.detect(linked).matched).toBe(false);
    expect(paulistaLinkedAccountAdapter.detect(linked).matched).toBe(true);

    const document = await paulistaCurrentAccountAdapter.parse(current);
    expect(document.identity).toMatchObject({ bankName: "PAULISTA", agency: { normalized: "0001" }, account: { normalized: "00446427" } });
    expect(document.transactions).toEqual([expect.objectContaining({ postingDate: "2025-11-03", amount: "500.00", direction: "CREDIT" })]);
    expect(paulistaCurrentAccountAdapter.validate(document).accepted).toBe(true);

    const noMovements = await paulistaLinkedAccountAdapter.parse(linked);
    expect(noMovements).toMatchObject({ declaresNoMovements: true, openingBalance: "0.00", closingBalance: "0.00" });
    expect(paulistaLinkedAccountAdapter.validate(noMovements).accepted).toBe(true);
  });

  it("extrai Pine, inclusive histórico quebrado, e aceita conta vinculada sem movimentos", async () => {
    const current = source([[
      "Pine", "Agencia: 0001 Conta: 5005-0", "Extrato Conta Corrente de 01/11/2025 ate 31/12/2025",
      "Data Lancamento Historico Valor Saldo", "01/11/2025 Saldo anterior 100,00",
      "03/11/2025 TARIFA DE CONTA ATIVA -50,00", "CREDITO PIX", "26/12/2025 100,00",
      "26/12/2025 Saldo do dia 150,00", "SALDO DA CONTA 150,00",
    ].join("\n")]);
    const linked = source([[
      "Pine", "Agencia: 0001 Conta: 802808-9", "Extrato Conta Vinculada de 01/11/2025 ate 31/12/2025",
      "Data Lancamento Historico Valor Saldo", "01/11/2025 Saldo anterior 0,00", "31/12/2025 Saldo do dia 0,00", "SALDO DA CONTA 0,00",
    ].join("\n")]);

    const document = await pineCurrentAccountAdapter.parse(current);
    expect(document.transactions).toEqual([
      expect.objectContaining({ postingDate: "2025-11-03", amount: "-50.00", direction: "DEBIT" }),
      expect.objectContaining({ postingDate: "2025-12-26", amount: "100.00", description: "CREDITO PIX" }),
    ]);
    expect(pineCurrentAccountAdapter.validate(document).accepted).toBe(true);

    const noMovements = await pineLinkedAccountAdapter.parse(linked);
    expect(noMovements.declaresNoMovements).toBe(true);
    expect(pineLinkedAccountAdapter.validate(noMovements).accepted).toBe(true);
  });

  it("extrai Vórtx sem usar saldo como lançamento", async () => {
    const document = await vortxCurrentAccountAdapter.parse(source([[
      "Extrato Detalhado", "Banco Agencia Conta", "310 0001 00108791-4", "Periodo: 01/10/2025 a 06/01/2026",
      "Data Lancamento Nome Banco Agencia Conta Valor (R$) Saldo (R$)", "06/01/2026 SALDO FINAL R$ 30,00",
      "30/12/2025 23:18 Tarifas de conta -R$ 500,00 R$ 30,00", "01/10/2025 SALDO INICIAL R$ 530,00",
    ].join("\n")]));

    expect(document.transactions).toEqual([expect.objectContaining({ postingDate: "2025-12-30", amount: "-500.00", description: "Tarifas de conta" })]);
    expect(document.openingBalance).toBe("530.00");
    expect(document.closingBalance).toBe("30.00");
    expect(vortxCurrentAccountAdapter.validate(document).accepted).toBe(true);
  });

  it("extrai o extrato Safra sem converter linhas de saldo em movimentos", async () => {
    const document = await safraCurrentAccountAdapter.parse(source([[
      "Banco Safra S.A.", "Extrato de Movimentacao", "AG: 0028 | CONTA: 00583024-4",
      "Periodo de 01/12/2026 a 31/12/2026", "Lancamentos realizados",
      "01/12 SALDO CONTA CORRENTE 9,71", "01/12 APLICACAO CDB AUTOMATICO 5830244 -400,00",
      "04/12 PIX RECEBIDO CLIENTE", "123456789 220.000,00", "31/12 SALDO INICIAL 4.705,19",
    ].join("\n")]));

    expect(safraCurrentAccountAdapter.detect(source(["Banco Safra Extrato de Movimentacao Lancamentos Realizados"])).matched).toBe(true);
    expect(document.identity).toMatchObject({ bankCode: "422", agency: { normalized: "0028" }, account: { normalized: "005830244" } });
    expect(document.transactions).toEqual([
      expect.objectContaining({ postingDate: "2026-12-01", amount: "-400.00", documentNumber: "5830244" }),
      expect.objectContaining({ postingDate: "2026-12-04", amount: "220000.00", documentNumber: "123456789" }),
    ]);
    expect(safraCurrentAccountAdapter.validate(document).accepted).toBe(true);
  });

  it("classifica posições e movimentos Safra como informativos, sem transações conciliáveis", async () => {
    const fund = await safraFundPositionAdapter.parse(source([[
      "Banco Safra S.A.", "Fundo (Posicao de Investimentos em 31/12/2025)", "AG: 0028 | CONTA: 00583024-4",
      "000029769 689.557,31 5.342,822",
    ].join("\n")]));
    const coe = await safraCoePositionAdapter.parse(source([[
      "Banco Safra S.A.", "Cert Oper Estr (Posicao de Investimentos em 31/12/2025)", "AG: 0028 | CONTA: 00583024-4",
      "03VAL 19/05/2025 1.000.000,00 1.051.830,60 12.957,64",
    ].join("\n")]));
    const products = await safraAutomaticProductsAdapter.parse(source([[
      "Banco Safra S.A.", "Produtos Automaticos", "Demonstrativo mensal - 12 / 2025", "Agencia 0028 Conta 00583024-4",
      "01/12/2025 102279736 400,00", "09/12/2025 101886957 25/11/2025 9.000,00",
    ].join("\n")]));

    for (const document of [fund, coe, products]) {
      expect(document.transactions).toEqual([]);
      expect(document.investments?.length).toBeGreaterThan(0);
      expect(document.issues).toContainEqual(expect.objectContaining({ code: "INVESTIMENTO_INFORMATIVO" }));
    }
    expect(fund.investments).toContainEqual(expect.objectContaining({ kind: "POSITION", amount: "689557.31" }));
    expect(coe.investments).toContainEqual(expect.objectContaining({ kind: "POSITION", amount: "1051830.60" }));
    expect(products.investments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "APPLICATION", amount: "400.00" }),
      expect.objectContaining({ kind: "REDEMPTION", amount: "9000.00" }),
    ]));
  });
});

function source(pageTexts: string[]): ExtractedStatementSource & { format: "PDF" } {
  return { sourceId: "test-source", format: "PDF", sha256, pages: pageTexts.map((text, index) => ({ page: index + 1, text, method: "TEXT" as const })) };
}
