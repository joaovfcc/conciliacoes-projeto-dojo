import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { Evidence } from "../../shared/domain/Evidence.js";
import type { ReconciliationRun } from "../domain/ReconciliationRun.js";

export interface ReconciliationRunSummary {
  automaticMatches: number;
  manualMatches: number;
  suggestions: number;
  openExceptions: number;
  resolvedExceptions: number;
}

export function summarizeReconciliationRun(run: ReconciliationRun): ReconciliationRunSummary {
  return {
    automaticMatches: run.matchGroups.filter((group) => group.status === "AUTO_CONFIRMED").length,
    manualMatches: run.matchGroups.filter((group) => group.status === "MANUALLY_CONFIRMED").length,
    suggestions: run.matchGroups.filter((group) => group.status === "SUGGESTED").length,
    openExceptions: run.exceptions.filter((exception) => ["OPEN", "ASSIGNED", "UNDER_REVIEW"].includes(exception.status)).length,
    resolvedExceptions: run.exceptions.filter((exception) => ["RESOLVED", "ACCEPTED_TIMING_DIFFERENCE", "REJECTED"].includes(exception.status)).length,
  };
}

export async function generateReconciliationRunXlsx(
  run: ReconciliationRun,
  evidences: readonly Evidence[] = [],
  auditEvents: readonly AuditEvent[] = [],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Conciliação Bancária V2";
  workbook.created = run.createdAt;
  const summary = summarizeReconciliationRun(run);
  writeSheet(workbook.addWorksheet("Resumo"), ["Campo", "Valor"], [
    ["Execução", run.id],
    ["Empresa", run.companyId],
    ["Perfil", run.profileId],
    ["Competência", run.periodId],
    ["Status", run.status],
    ["Preparador", run.preparerId],
    ["Revisor", run.reviewerId ?? ""],
    ["Matches automáticos", summary.automaticMatches],
    ["Matches manuais", summary.manualMatches],
    ["Sugestões", summary.suggestions],
    ["Exceções abertas", summary.openExceptions],
    ["Exceções concluídas", summary.resolvedExceptions],
  ]);
  writeSheet(
    workbook.addWorksheet("Matches"),
    ["ID", "Regra", "Cardinalidade", "Confiança", "Razão", "Extrato", "Diferença de data", "Diferença de valor", "Similaridade", "Status", "Responsável"],
    run.matchGroups.filter((group) => group.status !== "SUGGESTED").map((group) => [
      group.id,
      group.ruleId,
      group.cardinality,
      group.confidence,
      group.matchedLedgerIds.join(", "),
      group.matchedStatementIds.join(", "),
      group.dateDifferenceDays ?? "",
      group.amountDifference ? new Decimal(group.amountDifference).toNumber() : "",
      group.descriptionSimilarity ?? "",
      group.status,
      group.actorId ?? "",
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Sugestoes"),
    ["ID", "Regra", "Cardinalidade", "Confiança", "Razão", "Extrato", "Diferença de valor", "Status"],
    run.matchGroups.filter((group) => group.status === "SUGGESTED").map((group) => [
      group.id,
      group.ruleId,
      group.cardinality,
      group.confidence,
      group.matchedLedgerIds.join(", "),
      group.matchedStatementIds.join(", "),
      group.amountDifference ? new Decimal(group.amountDifference).toNumber() : "",
      group.status,
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Excecoes"),
    ["ID", "Tipo", "Status", "Responsável", "Prazo", "Código de resolução", "Explicação", "Razão", "Extrato", "Candidatos", "Evidências"],
    run.exceptions.map((exception) => [
      exception.id,
      exception.type,
      exception.status,
      exception.assignedTo ?? "",
      exception.dueDate?.toISOString() ?? "",
      exception.resolutionCode ?? "",
      exception.explanation ?? "",
      exception.ledgerId ?? "",
      exception.statementId ?? "",
      exception.candidateIds.join(", "),
      exception.evidenceIds.join(", "),
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Evidencias"),
    ["ID", "Tipo", "Match", "Exceção", "Origem", "Conteúdo", "Criada em"],
    evidences.map((evidence) => [
      evidence.id,
      evidence.type,
      evidence.matchGroupId ?? "",
      evidence.exceptionId ?? "",
      JSON.stringify(evidence.source),
      evidence.content ? JSON.stringify(evidence.content) : "",
      evidence.createdAt.toISOString(),
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Auditoria"),
    ["ID", "Ação", "Ator", "Data", "Antes", "Depois", "Metadados"],
    auditEvents.map((event) => [
      event.id,
      event.action,
      event.actorId ?? "",
      event.occurredAt.toISOString(),
      event.before === undefined ? "" : JSON.stringify(event.before),
      event.after === undefined ? "" : JSON.stringify(event.after),
      event.metadata === undefined ? "" : JSON.stringify(event.metadata),
    ]),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function writeSheet(sheet: ExcelJS.Worksheet, headers: string[], rows: readonly unknown[][]): void {
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row.map(safeCell)));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${columnName(headers.length)}${Math.max(1, sheet.rowCount)}` };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  sheet.columns.forEach((column, index) => {
    column.width = Math.min(48, Math.max(12, headers[index]?.length ?? 12));
  });
}

function safeCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function columnName(count: number): string {
  let value = count;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}
