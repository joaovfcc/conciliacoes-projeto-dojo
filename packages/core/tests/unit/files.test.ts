import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { preflightFiles, type SourceFileInput } from "../../src/files";

async function ledgerFile(): Promise<SourceFileInput> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Razao");
  sheet.addRow(["DATA", "LOTE/SUB/DOC/LINHA", "HISTORICO", "FILIAL DE ORIGEM"]);
  sheet.addRow(["CONTA", "DESCRICAO"]);
  sheet.addRow(["1.1.1.0.2", "BANCOS CONTA MOVIMENTOS"]);
  sheet.addRow(["CONTA - 1.1.1.0.2027 - BANCO ITAU AG. 191 C/C26775-6", "SALDO ANTERIOR"]);
  sheet.addRow([new Date("2025-12-01T00:00:00Z"), "001", "PAGAMENTO", "01"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { id: "ledger", originalName: "razao.xlsx", kind: "LEDGER", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer };
}

function statementFile(): SourceFileInput {
  const value = [
    "<OFX>",
    "<BANKID>341",
    "<BRANCHID>8363",
    "<ACCTID>00378-4",
    "<BANKTRANLIST>",
    "<STMTTRN><DTPOSTED>20251201<TRNAMT>-337.70<FITID>1<MEMO>PAGAMENTO</STMTTRN>",
    "</BANKTRANLIST>",
  ].join("\n");
  return { id: "statement", originalName: "extrato.ofx", kind: "STATEMENT", contentType: "application/x-ofx", buffer: Buffer.from(value) };
}

describe("pré-análise de contas", () => {
  it("extrai agência/conta do cabeçalho Protheus sem restringir a conciliação", async () => {
    const result = await preflightFiles(await ledgerFile(), [statementFile()]);

    expect(result.preflight.ledgerAccounts[0]).toMatchObject({
      account: "11102027",
      bank: "ITAU",
      agency: "191",
      bankAccount: "26775-6",
    });
    expect(result.preflight.issues).not.toContainEqual(expect.objectContaining({ severity: "ERROR" }));
    expect(result.preflight.issues).not.toContainEqual(expect.objectContaining({ code: "LINHA_RAZAO_INVALIDA" }));
  });
});
