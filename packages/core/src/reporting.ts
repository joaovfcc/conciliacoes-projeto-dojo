import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import {
  accountSummaryStatusLabel,
  balanceStatusLabel,
  bankLabel,
  decisionLevelLabel,
  documentKindLabel,
  extractionMethodLabel,
  formatDateForDisplay,
  formatPeriodForDisplay,
  investmentKindLabel,
  issueCategoryLabel,
  issueSeverityLabel,
  parserLabel,
  reconciliationRuleLabel,
  resultStatusLabel,
} from "./presentation.js";
import type { ProcessingResult, ReconciliationResult } from "./types.js";

const monetaryHeaders = new Set([
  "Saldo razão", "Saldo extrato", "Diferença", "Valor conciliado", "Valor razão", "Valor extrato",
  "Diferença valor", "Tolerância valor", "Saldo inicial", "Entradas", "Saídas", "Movimento líquido", "Saldo final",
  "Total de créditos", "Total de débitos", "Saldo final informado", "Saldo final calculado", "Diferença de saldo", "Tolerância de saldo",
  "Valor candidato",
  "Movimento bancário conciliável", "Movimento do razão", "Saldo inicial banco", "Saldo inicial razão",
  "Saldo final banco", "Saldo final razão", "Valor coberto", "Valor total", "Valor banco", "Valor razão",
  "Total banco", "Total razão",
  "Valor",
]);

export async function generateXlsx(result: ProcessingResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Conciliação Bancária Web";
  workbook.created = new Date(result.executedAt);

  writeSheet(workbook.addWorksheet("Resumo"), ["Empresa", "Filial", "Competência", "Conta contábil", "Contas bancárias", "Saldo razão", "Saldo extrato", "Diferença", "Qtd. conciliada", "Valor conciliado", "Divergências", "Sem extrato", "Sem razão", "Ambiguidades", "Duplicidades", "Status"], result.summaries.map((item) => [result.company, result.branch, formatPeriodForDisplay(result.period), item.ledgerAccount, item.statementAccounts.join(", "), item.ledgerBalance, item.statementBalance, item.balanceDifference, item.reconciledCount, item.reconciledValue, item.divergenceCount, item.ledgerWithoutStatementCount, item.statementWithoutLedgerCount, item.ambiguityCount, item.duplicateCount, accountSummaryStatusLabel(item.status)]));
  writeControls(workbook, result);
  writeSheet(workbook.addWorksheet("Controles de integridade"), ["Nível", "Categoria", "Descrição", "Arquivo", "Posição", "Orientação"], result.issues.map(issueRow));
  writeResultSheet(workbook, "Conciliações exatas", result.results.filter((item) => item.status === "AUTO_MATCH_EXACT"));
  writeResultSheet(workbook, "Conciliações proximidade", result.results.filter((item) => item.status === "AUTO_MATCH_DATE_TOLERANCE"));
  writeResultSheet(workbook, "Conciliações em grupo", result.results.filter((item) => item.status === "AUTO_MATCH_GROUP"));
  writeResultSheet(workbook, "Totais diários", result.results.filter((item) => item.status === "AUTO_MATCH_DAILY_TOTAL"));
  writeResultSheet(workbook, "Compensados no extrato", result.results.filter((item) => item.status === "BANK_NET_ZERO"));
  writeResultSheet(workbook, "Aplicações automáticas", result.results.filter((item) => item.status === "AUTO_APPLICATION_EXCLUDED"));
  writeResultSheet(workbook, "Sugestões", result.results.filter((item) => item.status === "VALUE_ONLY_SUGGESTION"));
  writeResultSheet(workbook, "Divergências", result.results.filter((item) => item.status === "VALUE_DIVERGENCE" || item.status === "DATE_DIVERGENCE"));
  writeResultSheet(workbook, "Razão sem extrato", result.results.filter((item) => item.status === "LEDGER_WITHOUT_STATEMENT"));
  writeResultSheet(workbook, "Extrato sem razão", result.results.filter((item) => item.status === "STATEMENT_WITHOUT_LEDGER"));
  writeAmbiguitySheet(workbook, result.results.filter((item) => item.status === "AMBIGUOUS_MATCH"));
  writeResultSheet(workbook, "Duplicidades", result.results.filter((item) => item.status === "POSSIBLE_DUPLICATE"));
  writeSheet(workbook.addWorksheet("Documentos processados"), ["Arquivo", "Banco", "Agência", "Conta", "Classificação", "Períodos", "Registros", "Método", "Leitor", "Confiança", "Saldo inicial", "Total de créditos", "Total de débitos", "Movimento líquido", "Saldo final informado", "Saldo final calculado", "Diferença de saldo", "Status de saldo", "Tolerância de saldo"], result.files.map((item) => {
    const balance = item.balanceCheck;
    return [item.originalName, bankLabel(item.bank), item.agency, item.account, documentKindLabel(item.classification), item.periods.map(formatPeriodForDisplay).join(", "), item.recordCount, extractionMethodLabel(item.extractionMethod), parserLabel(item.parser), item.confidence ?? "", balance?.openingBalance ?? "", balance?.creditTotal ?? "", balance?.debitTotal ?? "", balance?.movementTotal ?? "", balance?.extractedClosingBalance ?? "", balance?.expectedClosingBalance ?? "", balance?.difference ?? "", balanceStatusLabel(balance?.status ?? "NOT_AVAILABLE"), balance?.tolerance ?? ""];
  }));
  writeSheet(workbook.addWorksheet("Documentos bloqueados"), ["Categoria", "Descrição", "Arquivo", "Posição", "Orientação"], result.issues.filter((item) => item.severity === "ERROR").map((item) => [issueCategoryLabel(item.code, item.severity), item.message, item.fileId ?? "", item.sourcePosition ?? "", item.guidance ?? ""]));
  writeSheet(workbook.addWorksheet("Investimentos e posições"), ["Arquivo", "Banco", "Agência", "Conta", "Data", "Tipo", "Valor candidato", "Descrição", "Página", "Leitor", "Método", "Confiança"], result.investments.map((item) => [item.originalName, bankLabel(item.bank), item.agency, item.account, formatDateForDisplay(item.date), investmentKindLabel(item.kind), item.amount, item.description, item.evidence.page ?? "", parserLabel(item.evidence.parser), extractionMethodLabel(item.evidence.extractionMethod), item.evidence.confidence ?? ""]));
  writeSheet(workbook.addWorksheet("Erros técnicos"), ["Nível", "Categoria", "Descrição", "Arquivo", "Posição", "Orientação"], result.issues.filter((item) => item.severity === "ERROR").map(issueRow));
  writeAudit(workbook, result);

  const content = await workbook.xlsx.writeBuffer();
  return Buffer.from(content);
}

function writeControls(workbook: ExcelJS.Workbook, result: ProcessingResult): void {
  const controls = result.controls;
  writeSheet(workbook.addWorksheet("Controles consolidados"), ["Controle", "Valor banco", "Valor razão", "Diferença", "Tolerância", "Status"], [
    ["Movimentos", controls.movements.bankConciliable, controls.movements.ledger, controls.movements.difference, controls.tolerance, balanceStatusLabel(controls.movements.status)],
    ["Saldo inicial", controls.balances.bankOpening ?? "", controls.balances.ledgerOpening ?? "", controls.balances.openingDifference ?? "", controls.tolerance, balanceStatusLabel(controls.balances.openingStatus)],
    ["Saldo final", controls.balances.bankClosing ?? "", controls.balances.ledgerClosing ?? "", controls.balances.closingDifference ?? "", controls.tolerance, balanceStatusLabel(controls.balances.closingStatus)],
  ]);
  writeSheet(workbook.addWorksheet("Cobertura e status"), ["Métrica", "Coberto", "Total", "Percentual"], [
    ["Linhas", controls.coverage.lines.covered, controls.coverage.lines.total, controls.coverage.lines.percentage],
    ["Valor absoluto", controls.coverage.absoluteValue.covered, controls.coverage.absoluteValue.total, controls.coverage.absoluteValue.percentage],
    ...controls.countsByStatus.map((item) => [resultStatusLabel(item.status), item.count, "", ""]),
  ]);
  writeSheet(workbook.addWorksheet("Pendências por data"), ["Data", "Qtd. banco", "Qtd. razão", "Valor banco", "Valor razão", "Diferença"], controls.pendingByDate.map((item) => [formatDateForDisplay(item.date), item.bankCount, item.ledgerCount, item.bankValue, item.ledgerValue, item.difference]));
}

function issueRow(item: ProcessingResult["issues"][number]): unknown[] {
  return [issueSeverityLabel(item.severity), issueCategoryLabel(item.code, item.severity), item.message, item.fileId ?? "", item.sourcePosition ?? "", item.guidance ?? ""];
}

function writeAmbiguitySheet(workbook: ExcelJS.Workbook, results: ReconciliationResult[]): void {
  const headers = ["ID da ambiguidade", "Conta contábil", "Data razão", "Documento razão", "Valor razão", "ID candidato", "Banco", "Agência", "Conta bancária", "Data candidato", "Documento candidato", "Histórico candidato", "Valor candidato", "Arquivo", "Página/Linha", "Regra", "Motivo"];
  const rows = results.flatMap((item) => (item.candidates ?? []).map((candidate) => [
    item.id,
    item.ledger?.ledgerAccount ?? "",
    formatDateForDisplay(item.ledger?.date),
    item.ledger?.document ?? "",
    item.ledger?.value ?? "",
    candidate.id,
    bankLabel(candidate.bank),
    candidate.agency,
    candidate.bankAccount,
    formatDateForDisplay(candidate.date),
    candidate.document,
    candidate.history,
    candidate.value,
    candidate.evidence.originalName,
    candidate.evidence.page ?? candidate.evidence.line ?? "",
    reconciliationRuleLabel(item.rule),
    item.reason,
  ]));
  writeSheet(workbook.addWorksheet("Ambiguidades"), headers, rows);
}

function writeResultSheet(workbook: ExcelJS.Workbook, name: string, results: ReconciliationResult[]): void {
  writeSheet(workbook.addWorksheet(name), ["ID", "Status", "Nível", "Regra", "Motivo", "Ressalva", "Lado", "ID lançamento", "Conta contábil", "Banco", "Agência", "Conta bancária", "Data", "Documento", "Histórico", "Valor", "Arquivo", "Linha/Página", "Leitor", "Método", "Confiança", "Total banco", "Total razão", "Diferença em centavos", "Versão da regra"], results.flatMap(resultRows));
}

function resultRows(item: ReconciliationResult): unknown[][] {
  const ledgers = item.ledgers ?? (item.ledger ? [item.ledger] : []);
  const statements = item.statements ?? (item.statement ? [item.statement] : []);
  const disclaimer = item.status === "AUTO_MATCH_DAILY_TOTAL" ? "Fechamento no nível do lote diário; não implica pareamento individual entre linhas." : "";
  const common = [item.id, resultStatusLabel(item.status), decisionLevelLabel(item.decisionLevel), reconciliationRuleLabel(item.rule), item.reason, disclaimer];
  const totals = [item.matchGroup ? centsCell(item.matchGroup.bankTotalCents) : "", item.matchGroup ? centsCell(item.matchGroup.ledgerTotalCents) : "", item.matchGroup?.differenceCents ?? "", item.ruleVersion ?? ""];
  const ledgerRows = ledgers.map((record) => [...common, "Razão", record.id, record.ledgerAccount, "", "", "", formatDateForDisplay(record.date), record.document, record.history, record.value, record.evidence.originalName, record.evidence.line ?? "", parserLabel(record.evidence.parser), extractionMethodLabel(record.evidence.extractionMethod), record.evidence.confidence ?? "", ...totals]);
  const statementRows = statements.map((record) => [...common, "Extrato", record.id, "", bankLabel(record.bank), record.agency, record.bankAccount, formatDateForDisplay(record.date), record.document, record.history, record.value, record.evidence.originalName, record.evidence.page ?? record.evidence.line ?? "", parserLabel(record.evidence.parser), extractionMethodLabel(record.evidence.extractionMethod), record.evidence.confidence ?? "", ...totals]);
  return [...ledgerRows, ...statementRows];
}

function writeAudit(workbook: ExcelJS.Workbook, result: ProcessingResult): void {
  writeSheet(workbook.addWorksheet("Auditoria do motor"), ["ID", "Regra", "Versão", "Resultado", "IDs", "IDs banco", "IDs razão", "Total banco", "Total razão", "Diferença em centavos", "Score", "Avaliado em"], (result.reconciliation?.audit ?? []).map((item) => [item.id, reconciliationRuleLabel(item.ruleId), item.ruleVersion, auditOutcomeLabel(item.outcome), item.transactionIds.join(", "), item.bankTransactionIds.join(", "), item.ledgerTransactionIds.join(", "), centsCell(item.bankTotalCents), centsCell(item.ledgerTotalCents), item.differenceCents, item.score ?? "", item.evaluatedAt]));
}

function auditOutcomeLabel(status: string): string {
  const labels: Record<string, string> = {
    RECONCILED_EXACT: resultStatusLabel("AUTO_MATCH_EXACT"), RECONCILED_DATE_WINDOW: resultStatusLabel("AUTO_MATCH_DATE_TOLERANCE"),
    RECONCILED_GROUP: resultStatusLabel("AUTO_MATCH_GROUP"), RECONCILED_DAILY_TOTAL: resultStatusLabel("AUTO_MATCH_DAILY_TOTAL"),
    BANK_NET_ZERO: resultStatusLabel("BANK_NET_ZERO"), EXCLUDED_AUTO_APPLICATION: resultStatusLabel("AUTO_APPLICATION_EXCLUDED"),
    BANK_ONLY: resultStatusLabel("STATEMENT_WITHOUT_LEDGER"), LEDGER_ONLY: resultStatusLabel("LEDGER_WITHOUT_STATEMENT"),
  };
  return labels[status] ?? status;
}

function centsCell(value: string): string {
  return new Decimal(value).dividedBy(100).toFixed(2);
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
