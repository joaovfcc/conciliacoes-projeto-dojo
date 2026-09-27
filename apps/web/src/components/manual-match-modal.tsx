"use client";

import { useId, useState } from "react";
import type { LedgerRecord, ReconciliationResult, StatementRecord } from "@conciliacao/core";
import {
  bankLabel,
  formatDateForDisplay,
  parserLabel,
} from "@conciliacao/core/presentation";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function ManualMatchModal({
  item,
  onClose,
  onConfirm,
}: {
  item: ReconciliationResult;
  onClose: () => void;
  onConfirm: (selectedLedgerId: string, selectedStatementId: string, autoMatchRemaining: boolean) => void;
}) {
  const ledgers: LedgerRecord[] = item.ledgers ?? (item.ledger ? [item.ledger] : []);
  const statements: StatementRecord[] = item.statements ?? (item.statement ? [item.statement] : []);

  const [selectedLedgerId, setSelectedLedgerId] = useState<string>(() =>
    ledgers.length === 1 ? (ledgers[0]?.id ?? "") : "",
  );
  const [selectedStatementId, setSelectedStatementId] = useState<string>(() =>
    statements.length === 1 ? (statements[0]?.id ?? "") : "",
  );
  const [autoMatchRemaining, setAutoMatchRemaining] = useState(true);

  const groupAmount =
    item.ambiguityGroup?.amount ?? item.ledger?.value ?? item.statement?.value ?? "0.00";

  const selectedLedger = ledgers.find((l) => l.id === selectedLedgerId);
  const selectedStatement = statements.find((s) => s.id === selectedStatementId);
  const isValid = Boolean(selectedLedgerId && selectedStatementId);

  // Se restar exatamente 1 razão e 1 extrato após parear o escolhido
  const remainingLedgersCount = ledgers.filter((l) => l.id !== selectedLedgerId).length;
  const remainingStatementsCount = statements.filter((s) => s.id !== selectedStatementId).length;
  const canAutoMatchRemaining =
    isValid && remainingLedgersCount === 1 && remainingStatementsCount === 1;

  const autoMatchCheckboxId = useId();

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="manual-match-title">
      <div
        className="modal-content"
        style={{ width: "min(920px, 96vw)", maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 id="manual-match-title">Conciliação Manual de Ambiguidade</h3>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
              Selecione 1 lançamento do razão e 1 movimento do extrato para efetivar a conciliação.
            </p>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Fechar modal">
            ×
          </button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="notice warning" style={{ margin: 0, fontSize: "13px" }}>
            <strong>Valor de referência: {formatCurrency(Number(groupAmount))}</strong> · Ambos os lados possuem o mesmo
            valor monetário. A conciliação manual garante a associação contábil auditada com tolerância zero centavos.
          </div>

          <div className="comparison-columns" style={{ gap: "16px" }}>
            {/* Coluna Razão */}
            <div className="comparison-col" style={{ display: "flex", flexDirection: "column" }}>
              <div className="col-header">
                <span className="badge-type">Razão Protheus</span>
                <span className="badge-count">
                  {ledgers.length} candidato{ledgers.length > 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", maxHeight: "380px" }}>
                {ledgers.map((l) => {
                  const isSelected = selectedLedgerId === l.id;
                  return (
                    <label
                      key={l.id}
                      className={`statement-card ${isSelected ? "selected" : ""}`}
                      style={{
                        cursor: "pointer",
                        display: "block",
                        borderColor: isSelected ? "var(--blue-600)" : undefined,
                        background: isSelected ? "#EFF6FF" : "var(--surface)",
                        boxShadow: isSelected ? "0 0 0 1px var(--blue-600)" : undefined,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                        <input
                          type="radio"
                          name="manual-match-ledger"
                          value={l.id}
                          checked={isSelected}
                          onChange={() => setSelectedLedgerId(l.id)}
                          style={{ marginTop: "3px" }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                            <strong style={{ fontSize: "14px", color: "var(--blue-950)" }}>
                              {formatCurrency(Number(l.value))}
                            </strong>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              {formatDateForDisplay(l.date)}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginTop: "2px" }}>
                            {l.document ? `Doc: ${l.document}` : "Sem documento"}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--text-muted)",
                              marginTop: "2px",
                              wordBreak: "break-word",
                            }}
                          >
                            {l.history || "Sem histórico"}
                          </div>
                          <div className="entry-source" style={{ marginTop: "6px" }}>
                            {l.evidence.originalName} · linha {l.evidence.line ?? "—"}
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Coluna Extrato */}
            <div className="comparison-col" style={{ display: "flex", flexDirection: "column" }}>
              <div className="col-header">
                <span className="badge-type">Extrato Bancário</span>
                <span className="badge-count">
                  {statements.length} candidato{statements.length > 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", maxHeight: "380px" }}>
                {statements.map((s) => {
                  const isSelected = selectedStatementId === s.id;
                  return (
                    <label
                      key={s.id}
                      className={`statement-card ${isSelected ? "selected" : ""}`}
                      style={{
                        cursor: "pointer",
                        display: "block",
                        borderColor: isSelected ? "var(--blue-600)" : undefined,
                        background: isSelected ? "#EFF6FF" : "var(--surface)",
                        boxShadow: isSelected ? "0 0 0 1px var(--blue-600)" : undefined,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                        <input
                          type="radio"
                          name="manual-match-statement"
                          value={s.id}
                          checked={isSelected}
                          onChange={() => setSelectedStatementId(s.id)}
                          style={{ marginTop: "3px" }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                            <strong style={{ fontSize: "14px", color: "var(--blue-950)" }}>
                              {formatCurrency(Number(s.value))}
                            </strong>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                              {formatDateForDisplay(s.date)}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginTop: "2px" }}>
                            {s.document ? `Doc: ${s.document}` : "Sem documento"}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--text-muted)",
                              marginTop: "2px",
                              wordBreak: "break-word",
                            }}
                          >
                            {s.history || "Sem descrição"}
                          </div>
                          <div className="entry-source" style={{ marginTop: "6px" }}>
                            {[bankLabel(s.bank), s.agency, s.bankAccount].filter(Boolean).join(" · ") ||
                              s.evidence.originalName}
                            {s.evidence.parser ? ` · ${parserLabel(s.evidence.parser)}` : ""}
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Resumo da Associação Selecionada */}
          {isValid && selectedLedger && selectedStatement ? (
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #86EFAC",
                borderRadius: "8px",
                padding: "12px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>
                  ✓ Par selecionado para conciliação
                </span>
                <span className="badge" style={{ background: "#DCFCE7", color: "#166534", border: "1px solid #86EFAC" }}>
                  Diferença: R$ 0,00 (Exato)
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "#15803D", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <strong>Razão:</strong> {formatDateForDisplay(selectedLedger.date)} · Doc:{" "}
                  {selectedLedger.document || "—"} · {formatCurrency(Number(selectedLedger.value))}
                </div>
                <div>
                  <strong>Extrato:</strong> {formatDateForDisplay(selectedStatement.date)} · Doc:{" "}
                  {selectedStatement.document || "—"} · {formatCurrency(Number(selectedStatement.value))}
                </div>
              </div>

              {canAutoMatchRemaining && (
                <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed #86EFAC" }}>
                  <label
                    htmlFor={autoMatchCheckboxId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      fontSize: "12px",
                      color: "#166534",
                      fontWeight: 600,
                    }}
                  >
                    <input
                      id={autoMatchCheckboxId}
                      type="checkbox"
                      checked={autoMatchRemaining}
                      onChange={(e) => setAutoMatchRemaining(e.target.checked)}
                    />
                    Conciliar também o par restante automaticamente (1 razão e 1 extrato restantes)
                  </label>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                background: "#F8FAFC",
                border: "1px dashed var(--border)",
                borderRadius: "8px",
                padding: "12px 16px",
                textAlign: "center",
                fontSize: "12px",
                color: "var(--text-muted)",
              }}
            >
              Selecione 1 lançamento do razão (à esquerda) e 1 movimento do extrato (à direita) para habilitar a confirmação.
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="button"
            disabled={!isValid}
            onClick={() => onConfirm(selectedLedgerId, selectedStatementId, autoMatchRemaining && canAutoMatchRemaining)}
          >
            Confirmar conciliação manual
          </button>
        </div>
      </div>
    </div>
  );
}
