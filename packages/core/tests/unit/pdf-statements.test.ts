import { describe, expect, it } from "vitest";
import { preflightFiles, statementParseErrorFromPdfOpen, type ParsedInputBundle, type SourceFileInput } from "../../src/files";

const ledger: SourceFileInput = {
  id: "ledger",
  originalName: "razao.csv",
  kind: "LEDGER",
  contentType: "text/csv",
  buffer: Buffer.from("EMPRESA,FILIAL,CONTA,DATA,DOCUMENTO,HISTORICO,VALOR\nEMPRESA,01,111,2025-12-01,1,TESTE,10.00\n"),
};

describe("parsers PDF bancários", () => {
  it("lê Bradesco conta corrente sem transformar saldo em lançamento", async () => {
    const result = await parse(["Extrato mensal / por periodo", "Extrato de: Ag: 3394 | CC: 0003802-4", "Data Lancamento Dcto Credito Debito Saldo", "01/12/2025 PIX FORNECEDOR 123456 10,00 90,00", "Saldo anterior"], "bradesco.pdf");
    expect(result.preflight.statements[0]).toMatchObject({ bank: "BRADESCO", classification: "CURRENT_ACCOUNT", reconciliationEligible: true });
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toMatchObject({ date: "2025-12-01", value: "10.00" });
    expect(result.statements.map((item) => item.value)).not.toContain("90.00");
  });

  it("bloqueia BRB sem movimentos quando o documento não declara ausência de lançamentos", async () => {
    const result = await parse(["Dados da conta origem", "Tipo de extrato", "Numero da conta", "046.000.136-1", "Periodo 01/12/2025 a 31/12/2025"], "brb.pdf");
    expect(result.preflight.statements[0]).toMatchObject({ bank: "BRB", classification: "CURRENT_ACCOUNT", recordCount: 0, reconciliationEligible: true });
    expect(result.preflight.issues).toContainEqual(expect.objectContaining({ severity: "ERROR", code: "STATEMENT_MOVEMENTS_NOT_EXTRACTED" }));
  });

  it("aceita extrato sem movimentos somente com declaração explícita", async () => {
    const result = await parse(["Dados da conta origem", "Tipo de extrato", "Numero da conta", "046.000.136-1", "Periodo 01/12/2025 a 31/12/2025", "SEM MOVIMENTOS NO PERIODO"], "brb-sem-movimentos.pdf");
    expect(result.preflight.issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "EXTRATO_SEM_MOVIMENTOS" }));
  });

  it("lê BRB quando data, histórico, documento, valor, sinal e saldo estão na mesma linha visual", async () => {
    const result = await parse(["Dados da conta origem", "Tipo de extrato", "Numero da conta", "046.000.136-1", "01/12/2025 PIX RECEBIDO 123456 10,00 + 110,00", "02/12/2025 PAGAMENTO FORNECEDOR 123457 5,00 - 105,00"], "brb-linha-unica.pdf");

    expect(result.statements).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2025-12-01", document: "123456", value: "10.00" }),
      expect.objectContaining({ date: "2025-12-02", document: "123457", value: "-5.00" }),
    ]));
    expect(result.preflight.statements[0]?.balanceCheck).toMatchObject({ status: "PASSED", openingBalance: "100.00", extractedClosingBalance: "105.00" });
  });

  it("bloqueia o extrato quando os saldos acumulados não fecham", async () => {
    const result = await parse(["Dados da conta origem", "Tipo de extrato", "Numero da conta", "046.000.136-1", "01/12/2025 PIX RECEBIDO 123456 10,00 + 110,00", "02/12/2025 PAGAMENTO FORNECEDOR 123457 5,00 - 100,00"], "brb-saldo-inconsistente.pdf");

    expect(result.preflight.statements[0]?.balanceCheck).toMatchObject({ status: "FAILED" });
    expect(result.preflight.issues).toContainEqual(expect.objectContaining({ severity: "ERROR", code: "BALANCE_INTEGRITY_FAILED" }));
  });

  it("não classifica Safra como Itaú apenas por mencionar aplicação automática", async () => {
    await expect(parse(["Banco Safra", "Extrato de movimentação", "Período 01/12/2025 a 31/12/2025", "Aplicação automática"], "safra.pdf")).rejects.toMatchObject({ code: "PDF_LAYOUT_UNSUPPORTED" });
  });

  it("lê Santander conta corrente com lançamento e saldo em colunas separadas", async () => {
    const result = await parse(["Internet Banking Empresarial", "Conta Corrente", "Agencia: 3377 Conta: 130002439", "01/12/2025 TED RECEBIDA 1234 10,00 110,00"], "santander.pdf");
    expect(result.preflight.statements[0]).toMatchObject({ bank: "SANTANDER", classification: "CURRENT_ACCOUNT" });
    expect(result.statements[0]).toMatchObject({ date: "2025-12-01", value: "10.00" });
  });

  it("lê Sofisa conta corrente com sinal separado", async () => {
    const result = await parse(["Extrato 45 dias Entradas/Saidas", "Agencia: 00019 Conta: 0001420722", "01/12/25 1 PIX FORNECEDOR 123456 - 10,00"], "sofisa.pdf");
    expect(result.preflight.statements[0]).toMatchObject({ bank: "SOFISA", classification: "CURRENT_ACCOUNT" });
    expect(result.statements[0]).toMatchObject({ date: "2025-12-01", value: "-10.00" });
  });

  it("lê Itaú conta corrente por OCR/texto e preserva sinal posterior", async () => {
    const result = await parse(["Extrato de conta corrente", "Agencia: 8363 Conta: 00378-4", "Saldo resumido - 31/12/2025", "Data Lancamento Valor (R$) Saldo (R$)", "01/12 SISPAG FORNECEDORES 9773 337,70-"], "itau.pdf");
    expect(result.preflight.statements[0]).toMatchObject({ bank: "ITAU", classification: "CURRENT_ACCOUNT" });
    expect(result.statements[0]).toMatchObject({ document: "9773", date: "2025-12-01", value: "-337.70" });
  });

  it("mantém investimento Bradesco apenas para conferência", async () => {
    const result = await parse(["Extrato de investimentos", "3394 | 0003802-4 Agencia/Conta", "01/12/2025 01/12/2025 Aplicacao - 10,00"], "bradesco-invest.pdf");
    assertInvestmentOnly(result, "BRADESCO", "INVESTMENT_ACTIVITY");
  });

  it("mantém investimento Santander apenas para conferência", async () => {
    const result = await parse(["Extrato de Movimento e Posicao", "Agencia: 3377 Conta: 130002439", "01/12/2025 10,00 0,00 0,00 0,00 0,00 5,00 0,50"], "santander-invest.pdf");
    assertInvestmentOnly(result, "SANTANDER", "INVESTMENT_ACTIVITY");
  });

  it("mantém APLIC AUT MAIS do Itaú apenas para conferência", async () => {
    const result = await parse(["Itau APLIC AUT MAIS - EXTRATO DETALHADO DE MOVIMENTACAO", "Agencia/conta: 8363-00378-4", "Movimentacao em Dezembro/2025", "01/12/2025 A2533632570315 10,00 11,00"], "itau-invest.pdf");
    assertInvestmentOnly(result, "ITAU", "INVESTMENT_ACTIVITY");
  });

  it("lê posição Sofisa como saldo informativo, sem lançamentos", async () => {
    const result = await parse(["POSICAO DE INVESTIMENTOS", "Consulta de posicao - renda fixa (31/12/2025)", "Agencia: 00019 Conta: 0001420722", "CDB 1.114.704,15", "Valor liquido total R$ 1.114.704,15"], "sofisa-invest.pdf");
    assertInvestmentOnly(result, "SOFISA", "INVESTMENT_POSITION");
    expect(result.preflight.statements[0]?.finalBalance).toBe("1114704.15");
    expect(result.investments[0]).toMatchObject({ kind: "POSITION", amount: "1114704.15" });
  });
  it("recusa colisão Itaú/Safra mesmo quando o texto contém assinaturas completas do produto Itaú", async () => {
    await expect(parse(["Banco Safra", "Itau", "APLIC AUT MAIS", "Extrato detalhado de movimentacao", "01/12/2025 periodo"], "colisao-safra-itau.pdf")).rejects.toMatchObject({ code: "PDF_LAYOUT_UNSUPPORTED" });
  });
});

describe("abertura segura de PDF", () => {
  it("classifica PDF protegido por senha antes de tentar extração", () => {
    const error = new Error("senha necessária");
    error.name = "PasswordException";

    expect(statementParseErrorFromPdfOpen(error)).toMatchObject({ code: "PDF_PASSWORD_PROTECTED" });
  });
});



function assertInvestmentOnly(result: ParsedInputBundle, bank: string, classification: "INVESTMENT_ACTIVITY" | "INVESTMENT_POSITION"): void {
  expect(result.preflight.statements[0]).toMatchObject({ bank, classification, reconciliationEligible: false });
  expect(result.statements).toHaveLength(0);
  expect(result.investments.length).toBeGreaterThan(0);
}

async function parse(lines: string[], originalName: string): Promise<ParsedInputBundle> {
  const statement: SourceFileInput = { id: originalName, originalName, kind: "STATEMENT", contentType: "application/pdf", buffer: pdf(lines) };
  return preflightFiles(ledger, [statement]);
}

function pdf(lines: string[]): Buffer {
  const escape = (value: string) => value.replace(/([\\()])/g, "\\$1");
  const stream = ["BT", "/F1 10 Tf", "72 760 Td", ...lines.flatMap((line) => [`(${escape(line)}) Tj`, "0 -16 Td"]), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source, "latin1");
}
