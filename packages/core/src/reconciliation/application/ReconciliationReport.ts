import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import {
  auditActionLabel,
  cardinalityLabel,
  evidenceTypeLabel,
  exceptionStatusLabel,
  exceptionTypeLabel,
  knownCategoricalValueLabel,
  matchGroupStatusLabel,
  reconciliationRuleLabel,
  reconciliationRunStatusLabel,
  resolutionCodeLabel,
} from "../../presentation.js";
import type { Evidence } from "../../shared/domain/Evidence.js";
import { isEffectiveReconciliation, type ReconciliationRun } from "../domain/ReconciliationRun.js";

export interface ReconciliationRunSummary {
  automaticMatches: number;
  manualMatches: number;
  suggestions: number;
  openExceptions: number;
  resolvedExceptions: number;
}

export function summarizeReconciliationRun(run: ReconciliationRun): ReconciliationRunSummary {
  return {
    automaticMatches: run.matchGroups.filter(
      (group) => group.status === "AUTO_CONFIRMED" && isEffectiveReconciliation(group),
    ).length,
    manualMatches: run.matchGroups.filter(
      (group) => group.status === "MANUALLY_CONFIRMED" && isEffectiveReconciliation(group),
    ).length,
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
    ["Status", reconciliationRunStatusLabel(run.status)],
    ["Preparador", run.preparerId],
    ["Revisor", run.reviewerId ?? ""],
    ["Conciliações automáticas", summary.automaticMatches],
    ["Conciliações manuais", summary.manualMatches],
    ["Sugestões", summary.suggestions],
    ["Exceções abertas", summary.openExceptions],
    ["Exceções concluídas", summary.resolvedExceptions],
  ]);
  writeSheet(
    workbook.addWorksheet("Conciliações"),
    ["ID", "Regra", "Cardinalidade", "Confiança", "Razão", "Extrato", "Diferença de data", "Diferença de valor", "Similaridade", "Status", "Responsável"],
    run.matchGroups.filter((group) => ["AUTO_CONFIRMED", "MANUALLY_CONFIRMED"].includes(group.status)
      && isEffectiveReconciliation(group)).map((group) => [
      group.id,
      reconciliationRuleLabel(group.ruleId),
      cardinalityLabel(group.cardinality),
      group.confidence,
      group.matchedLedgerIds.join(", "),
      group.matchedStatementIds.join(", "),
      group.dateDifferenceDays ?? "",
      group.amountDifference ? new Decimal(group.amountDifference).toNumber() : "",
      group.descriptionSimilarity ?? "",
      matchGroupStatusLabel(group.status),
      group.actorId ?? "",
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Compensados no extrato"),
    ["ID", "Regra", "Extrato", "Diferença de valor", "Status"],
    run.matchGroups.filter((group) => group.status === "AUTO_CONFIRMED" && !isEffectiveReconciliation(group)).map((group) => [
      group.id,
      reconciliationRuleLabel(group.ruleId),
      group.matchedStatementIds.join(", "),
      group.amountDifference ? new Decimal(group.amountDifference).toNumber() : "",
      matchGroupStatusLabel(group.status),
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Sugestões"),
    ["ID", "Regra", "Cardinalidade", "Confiança", "Razão", "Extrato", "Diferença de valor", "Status"],
    run.matchGroups.filter((group) => group.status === "SUGGESTED").map((group) => [
      group.id,
      reconciliationRuleLabel(group.ruleId),
      cardinalityLabel(group.cardinality),
      group.confidence,
      group.matchedLedgerIds.join(", "),
      group.matchedStatementIds.join(", "),
      group.amountDifference ? new Decimal(group.amountDifference).toNumber() : "",
      matchGroupStatusLabel(group.status),
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Exceções"),
    ["ID", "Tipo", "Status", "Responsável", "Prazo", "Código de resolução", "Explicação", "Razão", "Extrato", "Candidatos", "Evidências"],
    run.exceptions.map((exception) => [
      exception.id,
      exceptionTypeLabel(exception.type),
      exceptionStatusLabel(exception.status),
      exception.assignedTo ?? "",
      exception.dueDate?.toISOString() ?? "",
      resolutionCodeLabel(exception.resolutionCode),
      exception.explanation ?? "",
      exception.ledgerId ?? "",
      exception.statementId ?? "",
      exception.candidateIds.join(", "),
      exception.evidenceIds.join(", "),
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Evidências"),
    ["ID", "Tipo", "Match", "Exceção", "Origem", "Conteúdo", "Criada em"],
    evidences.map((evidence) => [
      evidence.id,
      evidenceTypeLabel(evidence.type),
      evidence.matchGroupId ?? "",
      evidence.exceptionId ?? "",
      localizedJson(evidence.source),
      evidence.content ? localizedJson(evidence.content) : "",
      formatDateTime(evidence.createdAt),
    ]),
  );
  writeSheet(
    workbook.addWorksheet("Auditoria"),
    ["ID", "Ação", "Ator", "Data", "Antes", "Depois", "Metadados"],
    auditEvents.map((event) => [
      event.id,
      auditActionLabel(event.action),
      event.actorId ?? "",
      formatDateTime(event.occurredAt),
      event.before === undefined ? "" : localizedJson(event.before),
      event.after === undefined ? "" : localizedJson(event.after),
      event.metadata === undefined ? "" : localizedJson(event.metadata),
    ]),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const jsonKeyLabels: Record<string, string> = {
  id: "identificador",
  status: "situação",
  type: "tipo",
  rule: "regra",
  ruleId: "regra",
  cardinality: "cardinalidade",
  source: "origem",
  content: "conteúdo",
  date: "data",
  amount: "valor",
  description: "descrição",
  confidence: "confiança",
  fileId: "identificador do arquivo",
  originalName: "nome do arquivo",
};

function localizedJson(value: unknown): string {
  const localize = (item: unknown): unknown => {
    if (typeof item === "string") return knownCategoricalValueLabel(item);
    if (Array.isArray(item)) return item.map(localize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, nested]) => [jsonKeyLabels[key] ?? key, localize(nested)]));
    }
    return item;
  };
  return JSON.stringify(localize(value));
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(value);
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
