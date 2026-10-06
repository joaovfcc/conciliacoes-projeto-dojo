"use client";

import type { ReconciliationResult, LedgerRecord, StatementRecord } from "@conciliacao/core";
import {
  bankLabel,
  extractionMethodLabel,
  formatDateForDisplay,
  parserLabel,
  reconciliationRuleLabel,
  resultStatusLabel,
} from "@conciliacao/core/presentation";

export function EvidenceDrawer({
  selected,
  onClose,
  onOpenManualMatch,
}: {
  selected: ReconciliationResult | null;
  onClose: () => void;
  onOpenManualMatch?: (item: ReconciliationResult) => void;
}) {
  if (!selected) return null;

  const ledgers: LedgerRecord[] = selected.ledgers ?? (selected.ledger ? [selected.ledger] : []);
  const statements: StatementRecord[] = selected.statements ?? (selected.statement ? [selected.statement] : []);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">Detalhamento e Evidência</span>
            <h3>{resultStatusLabel(selected.status)}</h3>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {(selected.status === "AMBIGUOUS_MATCH" || selected.ambiguityGroup) && onOpenManualMatch && (
              <button
                type="button"
                className="button btn-sm"
                onClick={() => {
                  onClose();
                  onOpenManualMatch(selected);
                }}
              >
                Conciliar manual
              </button>
            )}
            {(selected.status === "STATEMENT_WITHOUT_LEDGER" || selected.status === "LEDGER_WITHOUT_STATEMENT") && onOpenManualMatch && (
              <button
                type="button"
                className="button btn-sm"
                onClick={() => {
                  onClose();
                  onOpenManualMatch(selected);
                }}
              >
                {selected.status === "STATEMENT_WITHOUT_LEDGER" ? "Buscar no Razão" : "Buscar no Extrato"}
              </button>
            )}
            <button type="button" className="close-button" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="drawer-body">
          {/* Metadata Card */}
          <div className="info-card">
            <h4>Critérios de Correspondência</h4>
            <div className="info-grid">
              <div>
                <span className="label">Regra Aplicada</span>
                <strong>{reconciliationRuleLabel(selected.rule)}</strong>
              </div>
              <div>
                <span className="label">Diferença de Valor</span>
                <strong>
                  {selected.valueDifference !== undefined
                    ? `R$ ${Number(selected.valueDifference).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span className="label">Diferença de Data</span>
                <strong>
                  {selected.dateDifference !== undefined
                    ? `${selected.dateDifference} ${Math.abs(selected.dateDifference) === 1 ? "dia" : "dias"}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span className="label">Decisão</span>
                <strong>{selected.decisionLevel === "AUTOMATIC" ? "Automática (Auditável)" : "Manual / Requer Revisão"}</strong>
              </div>
              {selected.score !== undefined && selected.rule === "AI-ADVISOR-V1" && (
                <div>
                  <span className="label">Confiança da IA</span>
                  <strong style={{ color: "#2563EB" }}>{(selected.score * 100).toFixed(1)}%</strong>
                </div>
              )}
            </div>
            {selected.rule === "AI-ADVISOR-V1" && (
              <div style={{ marginTop: "8px", display: "inline-block", padding: "2px 8px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "4px", fontSize: "11px", fontWeight: 600, color: "#1D4ED8" }}>
                ✨ Sugestão da IA (Revisão Humana Obrigatória)
              </div>
            )}
            {selected.reason && (
              <p style={{ margin: "12px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                <strong>Justificativa Técnica:</strong> {selected.reason}
              </p>
            )}
          </div>

          {/* Side by side comparison */}
          <div className="comparison-columns">
            {/* Lançamentos Contábeis (Razão) */}
            <div className="comparison-col">
              <div className="col-header">
                <span className="badge-type">Razão Contábil (Protheus)</span>
                <span className="badge-count">{ledgers.length} registro(s)</span>
              </div>
              {ledgers.length > 0 ? (
                ledgers.map((ledger: LedgerRecord, idx: number) => (
                  <div key={ledger.id || idx} className="entry-details statement-card">
                    <div className="entry-row">
                      <span className="label">Data</span>
                      <span>{formatDateForDisplay(ledger.date)}</span>
                    </div>
                    <div className="entry-row">
                      <span className="label">Valor</span>
                      <strong className={Number(ledger.value) < 0 ? "amount-debit" : "amount-credit"}>
                        {formatCurrency(Number(ledger.value))}
                      </strong>
                    </div>
                    <div className="entry-row">
                      <span className="label">Documento</span>
                      <span>{ledger.document || "—"}</span>
                    </div>
                    <div className="entry-row">
                      <span className="label">Conta Contábil</span>
                      <code>{ledger.ledgerAccount}</code>
                    </div>
                    <div className="entry-row">
                      <span className="label">Histórico</span>
                      <p className="entry-desc">{ledger.history || "—"}</p>
                    </div>
                    <div className="entry-source">
                      <span className="label">Origem</span>
                      <small>
                        {ledger.evidence.originalName}
                        {ledger.evidence.line ? ` · Linha ${ledger.evidence.line}` : ""}
                        {ledger.evidence.parser ? ` · Parser ${parserLabel(ledger.evidence.parser)}` : ""}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-entry">Nenhum lançamento no razão vinculado a este extrato.</div>
              )}
            </div>

            {/* Lançamentos Bancários (Extrato) */}
            <div className="comparison-col">
              <div className="col-header">
                <span className="badge-type">Extrato Bancário</span>
                <span className="badge-count">{statements.length} registro(s)</span>
              </div>

              {statements.length > 0 ? (
                statements.map((stmt: StatementRecord, idx: number) => (
                  <div key={stmt.id || idx} className="entry-details statement-card">
                    <div className="entry-row">
                      <span className="label">Data</span>
                      <span>{formatDateForDisplay(stmt.date)}</span>
                    </div>
                    <div className="entry-row">
                      <span className="label">Valor</span>
                      <strong className={Number(stmt.value) < 0 ? "amount-debit" : "amount-credit"}>
                        {formatCurrency(Number(stmt.value))}
                      </strong>
                    </div>
                    <div className="entry-row">
                      <span className="label">Banco / Conta</span>
                      <span>{bankLabel(stmt.bank)} · {[stmt.agency, stmt.bankAccount].filter(Boolean).join("/") || "—"}</span>
                    </div>
                    <div className="entry-row">
                      <span className="label">Documento</span>
                      <span>{stmt.document || "—"}</span>
                    </div>
                    <div className="entry-row">
                      <span className="label">Histórico</span>
                      <p className="entry-desc">{stmt.history || "—"}</p>
                    </div>
                    <div className="entry-source">
                      <span className="label">Evidência de Extração</span>
                      <small>
                        {parserLabel(stmt.evidence.parser)} · {extractionMethodLabel(stmt.evidence.extractionMethod)}
                        {stmt.evidence.confidence ? ` · Confiança: ${(Number(stmt.evidence.confidence) * 100).toFixed(0)}%` : ""}
                        {stmt.evidence.page ? ` · Página ${stmt.evidence.page}` : ""}
                        {stmt.evidence.line ? ` · Linha ${stmt.evidence.line}` : ""}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-entry">Nenhum lançamento de extrato bancário correspondente.</div>
              )}
            </div>
          </div>
        </div>

        <div className="drawer-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Fechar Detalhes
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
