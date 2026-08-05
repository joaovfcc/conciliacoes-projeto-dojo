import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import type { ProcessingResult, ReconciliationResult } from "./types.js";

const monetaryHeaders = new Set([
  "Saldo razão", "Saldo extrato", "Diferença", "Valor conciliado", "Valor razão", "Valor extrato",
  "Diferença valor", "Tolerância valor", "Saldo inicial", "Entradas", "Saídas", "Movimento líquido", "Saldo final",
  "Total de créditos", "Total de débitos", "Saldo final informado", "Saldo final calculado", "Diferença de saldo", "Tolerância de saldo",
  "Valor candidato",
]);

export async function generateXlsx(result: ProcessingResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Conciliação Bancária Web";
  workbook.created = new Date(result.executedAt);

  writeSheet(workbook.addWorksheet("Resumo"), ["Empresa", "Filial", "Competência", "Conta contábil", "Contas bancárias", "Saldo razão", "Saldo extrato", "Diferença", "Qtd. conciliada", "Valor conciliado", "Divergências", "Sem extrato", "Sem razão", "Ambiguidades", "Duplicidades", "Status"], result.summaries.map((item) => [result.company, result.branch, result.period, item.ledgerAccount, item.statementAccounts.join(", "), item.ledgerBalance, item.statementBalance, item.balanceDifference, item.reconciledCount, item.reconciledValue, item.divergenceCount, item.ledgerWithoutStatementCount, item.statementWithoutLedgerCount, item.ambiguityCount, item.duplicateCount, item.status]));
  writeSheet(workbook.addWorksheet("Controles_de_Integridade"), ["Severidade", "Código", "Descrição", "Arquivo", "Posição", "Orientação"], result.issues.map(issueRow));
  writeResultSheet(workbook, "Conciliados_Automaticos", result.results.filter((item) => item.decisionLevel === "AUTOMATIC"));
  writeResultSheet(workbook, "Sugestoes", result.results.filter((item) => item.status === "VALUE_ONLY_SUGGESTION"));
  writeResultSheet(workbook, "Divergencias", result.results.filter((item) => item.status === "VALUE_DIVERGENCE" || item.status === "DATE_DIVERGENCE"));
  writeResultSheet(workbook, "Razao_Sem_Extrato", result.results.filter((item) => item.status === "LEDGER_WITHOUT_STATEMENT"));
  writeResultSheet(workbook, "Extrato_Sem_Razao", result.results.filter((item) => item.status === "STATEMENT_WITHOUT_LEDGER"));
  writeAmbiguitySheet(workbook, result.results.filter((item) => item.status === "AMBIGUOUS_MATCH"));
  writeResultSheet(workbook, "Duplicidades", result.results.filter((item) => item.status === "POSSIBLE_DUPLICATE"));
  writeSheet(workbook.addWorksheet("Documentos_Processados"), ["Arquivo", "Banco", "Agência", "Conta", "Classificação", "Períodos", "Registros", "Método", "Parser", "Confiança", "Saldo inicial", "Total de créditos", "Total de débitos", "Movimento líquido", "Saldo final informado", "Saldo final calculado", "Diferença de saldo", "Status de saldo", "Tolerância de saldo"], result.files.map((item) => {
    const balance = item.balanceCheck;
    return [item.originalName, item.bank, item.agency, item.account, item.classification, item.periods.join(", "), item.recordCount, item.extractionMethod, item.parser, item.confidence ?? "", balance?.openingBalance ?? "", balance?.creditTotal ?? "", balance?.debitTotal ?? "", balance?.movementTotal ?? "", balance?.extractedClosingBalance ?? "", balance?.expectedClosingBalance ?? "", balance?.difference ?? "", balance?.status ?? "NOT_AVAILABLE", balance?.tolerance ?? ""];
  }));
  writeSheet(workbook.addWorksheet("Documentos_Bloqueados"), ["Código", "Descrição", "Arquivo", "Posição", "Orientação"], result.issues.filter((item) => item.severity === "ERROR").map((item) => [item.code, item.message, item.fileId ?? "", item.sourcePosition ?? "", item.guidance ?? ""]));
  writeSheet(workbook.addWorksheet("Investimentos_Posicoes"), ["Arquivo", "Banco", "Agência", "Conta", "Data", "Tipo", "Valor candidato", "Descrição", "Página", "Parser", "Método", "Confiança"], result.investments.map((item) => [item.originalName, item.bank, item.agency, item.account, item.date ?? "", item.kind, item.amount, item.description, item.evidence.page ?? "", item.evidence.parser ?? "", item.evidence.extractionMethod, item.evidence.confidence ?? ""]));
  writeSheet(workbook.addWorksheet("Erros_Tecnicos"), ["Severidade", "Código", "Descrição", "Arquivo", "Posição", "Orientação"], result.issues.filter((item) => item.severity === "ERROR").map(issueRow));

  const content = await workbook.xlsx.writeBuffer();
  return Buffer.from(content);
}

function issueRow(item: ProcessingResult["issues"][number]): unknown[] {
  return [item.severity, item.code, item.message, item.fileId ?? "", item.sourcePosition ?? "", item.guidance ?? ""];
}

function writeAmbiguitySheet(workbook: ExcelJS.Workbook, results: ReconciliationResult[]): void {
  const headers = ["ID da ambiguidade", "Conta contábil", "Data razão", "Documento razão", "Valor razão", "ID candidato", "Banco", "Agência", "Conta bancária", "Data candidato", "Documento candidato", "Histórico candidato", "Valor candidato", "Arquivo", "Página/Linha", "Regra", "Motivo"];
  const rows = results.flatMap((item) => (item.candidates ?? []).map((candidate) => [
    item.id,
    item.ledger?.ledgerAccount ?? "",
    item.ledger?.date ?? "",
    item.ledger?.document ?? "",
    item.ledger?.value ?? "",
    candidate.id,
    candidate.bank,
    candidate.agency,
    candidate.bankAccount,
    candidate.date,
    candidate.document,
    candidate.history,
    candidate.value,
    candidate.evidence.originalName,
    candidate.evidence.page ?? candidate.evidence.line ?? "",
    item.rule,
    item.reason,
  ]));
  writeSheet(workbook.addWorksheet("Ambiguidades"), headers, rows);
}

function writeResultSheet(workbook: ExcelJS.Workbook, name: string, results: ReconciliationResult[]): void {
  writeSheet(workbook.addWorksheet(name), ["ID", "Status", "Nível", "Regra", "Motivo", "Conta contábil", "Data razão", "Documento razão", "Histórico razão", "Valor razão", "Arquivo razão", "Linha razão", "Banco", "Agência", "Conta bancária", "Data extrato", "Documento extrato", "Histórico extrato", "Valor extrato", "Arquivo extrato", "Linha/Página", "Parser", "Método", "Confiança", "Diferença valor", "Diferença dias", "Tolerância valor"], results.map((item) => [item.id, item.status, item.decisionLevel, item.rule, item.reason, item.ledger?.ledgerAccount ?? "", item.ledger?.date ?? "", item.ledger?.document ?? "", item.ledger?.history ?? "", item.ledger?.value ?? "", item.ledger?.evidence.originalName ?? "", item.ledger?.evidence.line ?? "", item.statement?.bank ?? "", item.statement?.agency ?? "", item.statement?.bankAccount ?? "", item.statement?.date ?? "", item.statement?.document ?? "", item.statement?.history ?? "", item.statement?.value ?? "", item.statement?.evidence.originalName ?? "", item.statement?.evidence.page ?? item.statement?.evidence.line ?? "", item.statement?.evidence.parser ?? "", item.statement?.evidence.extractionMethod ?? "", item.statement?.evidence.confidence ?? "", item.valueDifference ?? "", item.dateDifference ?? "", item.valueTolerance]));
}

function writeSheet(sheet: ExcelJS.Worksheet, headers: string[], rows: unknown[][]): void {
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row.map((value, index) => cellValue(headers[index] ?? "", value)));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  header.alignment = { vertical: "middle" };
  sheet.columns.forEach((column, index) => {
    column.width = Math.min(42, Math.max(12, headers[index]?.length ?? 12));
    if (monetaryHeaders.has(headers[index] ?? "")) column.numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  });
}

function cellValue(header: string, value: unknown): unknown {
  if (monetaryHeaders.has(header) && typeof value === "string" && value) return new Decimal(value).toNumber();
  if (typeof value !== "string") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
