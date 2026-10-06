"use client";

import { useId, useMemo, useState } from "react";
import type { LedgerRecord, ReconciliationResult, StatementRecord } from "@conciliacao/core";
import {
  bankLabel,
  formatDateForDisplay,
  parserLabel,
} from "@conciliacao/core/presentation";

function formatCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

function getDaysDiff(d1: string, d2: string): number {
  const t1 = new Date(`${d1.slice(0, 10)}T00:00:00.000Z`).getTime();
  const t2 = new Date(`${d2.slice(0, 10)}T00:00:00.000Z`).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 0;
  return Math.round(Math.abs(t1 - t2) / (1000 * 60 * 60 * 24));
}

export interface BidirectionalMatchModalProps {
  /** Item selecionado para conciliação manual (âncora contextual), ou null para busca livre */
  anchorItem?: ReconciliationResult | null;
  /** Todos os resultados da conciliação para extração das pendências */
  allResults: ReconciliationResult[];
  /** Callback para fechar o modal */
  onClose: () => void;
  /** Callback para confirmar a conciliação manual */
  onConfirm: (
    selectedStatementId: string,
    selectedLedgerId: string,
    justification?: string
  ) => void | Promise<void>;
}

export function BidirectionalMatchModal({
  anchorItem,
  allResults,
  onClose,
  onConfirm,
}: BidirectionalMatchModalProps) {
  // 1. Extrair todos os extratos e razões pendentes de allResults
  const { allStatements, allLedgers } = useMemo(() => {
    const stmts: StatementRecord[] = [];
    const ledgs: LedgerRecord[] = [];
    const seenS = new Set<string>();
    const seenL = new Set<string>();

    // Se houver âncora, adicioná-la com prioridade
    if (anchorItem?.statement && !seenS.has(anchorItem.statement.id)) {
      seenS.add(anchorItem.statement.id);
      stmts.push(anchorItem.statement);
    }
    if (anchorItem?.statements) {
      for (const s of anchorItem.statements) {
        if (!seenS.has(s.id)) {
          seenS.add(s.id);
          stmts.push(s);
        }
      }
    }
    if (anchorItem?.ledger && !seenL.has(anchorItem.ledger.id)) {
      seenL.add(anchorItem.ledger.id);
      ledgs.push(anchorItem.ledger);
    }
    if (anchorItem?.ledgers) {
      for (const l of anchorItem.ledgers) {
        if (!seenL.has(l.id)) {
          seenL.add(l.id);
          ledgs.push(l);
        }
      }
    }

    // Coletar pendências de STATEMENT_WITHOUT_LEDGER e LEDGER_WITHOUT_STATEMENT
    for (const r of allResults) {
      if (r.status === "STATEMENT_WITHOUT_LEDGER" || r.rule === "RULE_8_STATEMENT_WITHOUT_LEDGER") {
        const itemStmts = r.statements ?? (r.statement ? [r.statement] : []);
        for (const s of itemStmts) {
          if (!seenS.has(s.id)) {
            seenS.add(s.id);
            stmts.push(s);
          }
        }
      } else if (r.status === "LEDGER_WITHOUT_STATEMENT" || r.rule === "RULE_7_LEDGER_WITHOUT_STATEMENT") {
        const itemLedgs = r.ledgers ?? (r.ledger ? [r.ledger] : []);
        for (const l of itemLedgs) {
          if (!seenL.has(l.id)) {
            seenL.add(l.id);
            ledgs.push(l);
          }
        }
      }
    }

    return { allStatements: stmts, allLedgers: ledgs };
  }, [allResults, anchorItem]);

  // Identificar se a âncora é Extrato ou Razão
  const anchorIsStatement = Boolean(anchorItem?.statement || (anchorItem?.statements && anchorItem.statements.length > 0));
  const anchorIsLedger = Boolean(anchorItem?.ledger || (anchorItem?.ledgers && anchorItem.ledgers.length > 0));

  const initialStatementId = anchorItem?.statement?.id ?? anchorItem?.statements?.[0]?.id ?? "";
  const initialLedgerId = anchorItem?.ledger?.id ?? anchorItem?.ledgers?.[0]?.id ?? "";

  const [selectedStatementId, setSelectedStatementId] = useState<string>(initialStatementId);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string>(initialLedgerId);
  const [justification, setJustification] = useState<string>("");

  // Estado dos filtros
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [amountFilterMode, setAmountFilterMode] = useState<"ALL" | "EXACT" | "TOLERANCE">(() => {
    // Se veio de âncora, inicializa preferindo EXACT se houver correspondência exata
    return anchorItem ? "EXACT" : "ALL";
  });
  const [amountTolerance, setAmountTolerance] = useState<string>("0.05");
  const [dateToleranceDays, setDateToleranceDays] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "DEBIT" | "CREDIT">("ALL");

  const justificationInputId = useId();
  const searchInputId = useId();

  // Objeto de referência para filtros comparativos
  const referenceRecord = useMemo(() => {
    if (anchorIsStatement && selectedStatementId) {
      return allStatements.find((s) => s.id === selectedStatementId);
    }
    if (anchorIsLedger && selectedLedgerId) {
      return allLedgers.find((l) => l.id === selectedLedgerId);
    }
    if (selectedStatementId) {
      return allStatements.find((s) => s.id === selectedStatementId);
    }
    if (selectedLedgerId) {
      return allLedgers.find((l) => l.id === selectedLedgerId);
    }
    return null;
  }, [anchorIsStatement, anchorIsLedger, selectedStatementId, selectedLedgerId, allStatements, allLedgers]);

  // Filtragem dos Extratos
  const filteredStatements = useMemo(() => {
    return allStatements.filter((stmt) => {
      // Se este for o selecionado, sempre manter na lista
      if (stmt.id === selectedStatementId) return true;

      // Filtro de texto (histórico, doc, banco, agência, conta, valor)
      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const matchesHistory = stmt.history?.toLowerCase().includes(term);
        const matchesDoc = stmt.document?.toLowerCase().includes(term);
        const matchesBank = stmt.bank?.toLowerCase().includes(term);
        const matchesAccount = stmt.bankAccount?.toLowerCase().includes(term);
        const matchesVal = String(stmt.value).includes(term);
        if (!matchesHistory && !matchesDoc && !matchesBank && !matchesAccount && !matchesVal) {
          return false;
        }
      }

      // Filtro de tipo (D/C)
      const stmtType = (stmt as { type?: string }).type;
      if (typeFilter !== "ALL" && stmtType) {
        if (stmtType !== typeFilter) return false;
      }

      // Filtros em relação à referência (se a referência for um Razão)
      if (referenceRecord && "ledgerAccount" in referenceRecord) {
        const refVal = Math.round(Number(referenceRecord.value) * 100);
        const stmtVal = Math.round(Number(stmt.value) * 100);
        const diffCents = Math.abs(refVal - stmtVal);

        if (amountFilterMode === "EXACT" && diffCents !== 0) {
          return false;
        }
        if (amountFilterMode === "TOLERANCE") {
          const maxDiffCents = Math.round((parseFloat(amountTolerance) || 0) * 100);
          if (diffCents > maxDiffCents) return false;
        }

        if (dateToleranceDays !== "ALL") {
          const days = getDaysDiff(stmt.date, referenceRecord.date);
          const maxDays = parseInt(dateToleranceDays, 10);
          if (days > maxDays) return false;
        }
      }

      return true;
    });
  }, [allStatements, selectedStatementId, searchTerm, typeFilter, referenceRecord, amountFilterMode, amountTolerance, dateToleranceDays]);

  // Filtragem dos Razões
  const filteredLedgers = useMemo(() => {
    return allLedgers.filter((ledg) => {
      // Se este for o selecionado, sempre manter na lista
      if (ledg.id === selectedLedgerId) return true;

      // Filtro de texto (histórico, doc, conta, valor)
      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const matchesHistory = ledg.history?.toLowerCase().includes(term);
        const matchesDoc = ledg.document?.toLowerCase().includes(term);
        const matchesAccount = ledg.ledgerAccount?.toLowerCase().includes(term);
        const matchesVal = String(ledg.value).includes(term);
        if (!matchesHistory && !matchesDoc && !matchesAccount && !matchesVal) {
          return false;
        }
      }

      // Filtro de tipo (D/C)
      const ledgType = (ledg as { type?: string }).type;
      if (typeFilter !== "ALL" && ledgType) {
        if (ledgType !== typeFilter) return false;
      }

      // Filtros em relação à referência (se a referência for um Extrato)
      if (referenceRecord && "bank" in referenceRecord) {
        const refVal = Math.round(Number(referenceRecord.value) * 100);
        const ledgVal = Math.round(Number(ledg.value) * 100);
        const diffCents = Math.abs(refVal - ledgVal);

        if (amountFilterMode === "EXACT" && diffCents !== 0) {
          return false;
        }
        if (amountFilterMode === "TOLERANCE") {
          const maxDiffCents = Math.round((parseFloat(amountTolerance) || 0) * 100);
          if (diffCents > maxDiffCents) return false;
        }

        if (dateToleranceDays !== "ALL") {
          const days = getDaysDiff(ledg.date, referenceRecord.date);
          const maxDays = parseInt(dateToleranceDays, 10);
          if (days > maxDays) return false;
        }
      }

      return true;
    });
  }, [allLedgers, selectedLedgerId, searchTerm, typeFilter, referenceRecord, amountFilterMode, amountTolerance, dateToleranceDays]);

  const selectedStatement = allStatements.find((s) => s.id === selectedStatementId);
  const selectedLedger = allLedgers.find((l) => l.id === selectedLedgerId);
  const isValid = Boolean(selectedStatementId && selectedLedgerId && selectedStatement && selectedLedger);

  // Cálculos de comparação
  const comparison = useMemo(() => {
    if (!selectedStatement || !selectedLedger) return null;
    const stmtCents = Math.round(Number(selectedStatement.value) * 100);
    const ledgCents = Math.round(Number(selectedLedger.value) * 100);
    const diffCents = Math.abs(stmtCents - ledgCents);
    const diffAmount = (diffCents / 100).toFixed(2);
    const daysDiff = getDaysDiff(selectedStatement.date, selectedLedger.date);

    return {
      isExactAmount: diffCents === 0,
      diffAmount,
      daysDiff,
      sameDate: daysDiff === 0,
    };
  }, [selectedStatement, selectedLedger]);

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bidirectional-match-title"
    >
      <div
        className="modal-content"
        style={{ width: "min(1080px, 96vw)", maxHeight: "94vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="modal-header">
          <div>
            <h3 id="bidirectional-match-title">
              {anchorItem ? "Conciliação Manual com Filtros Inteligentes" : "Busca Livre de Pendências e Match Manual"}
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
              {anchorIsStatement
                ? "Extrato selecionado como âncora. Localize o lançamento correspondente no razão Protheus."
                : anchorIsLedger
                ? "Razão selecionado como âncora. Localize o movimento correspondente no extrato bancário."
                : "Selecione 1 movimento do extrato à esquerda e 1 lançamento do razão à direita para efetivar a conciliação manual."}
            </p>
          </div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Fechar modal">
            ×
          </button>
        </div>

        {/* Corpo com scroll */}
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto" }}>
          {/* Barra de Filtros Inteligentes */}
          <div
            style={{
              background: "#F8FAFC",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              {/* Campo de Busca Textual */}
              <div style={{ flex: 1, minWidth: "240px", display: "flex", alignItems: "center", gap: "6px" }}>
                <label htmlFor={searchInputId} style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>
                  Busca:
                </label>
                <input
                  id={searchInputId}
                  type="text"
                  placeholder="Pesquisar por histórico, doc, banco, conta..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                  }}
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: "var(--text-muted)",
                      padding: "2px 6px",
                    }}
                    title="Limpar busca"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Filtro de Valor */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>Valor:</span>
                <div style={{ display: "inline-flex", borderRadius: "6px", border: "1px solid var(--border)", overflow: "hidden" }}>
                  <button
                    type="button"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      border: "none",
                      background: amountFilterMode === "ALL" ? "var(--blue-600)" : "var(--surface)",
                      color: amountFilterMode === "ALL" ? "#FFF" : "var(--text-main)",
                      cursor: "pointer",
                    }}
                    onClick={() => setAmountFilterMode("ALL")}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      border: "none",
                      borderLeft: "1px solid var(--border)",
                      background: amountFilterMode === "EXACT" ? "var(--blue-600)" : "var(--surface)",
                      color: amountFilterMode === "EXACT" ? "#FFF" : "var(--text-main)",
                      cursor: "pointer",
                    }}
                    onClick={() => setAmountFilterMode("EXACT")}
                    title="Apenas lançamentos com o mesmo valor da referência"
                  >
                    Exato
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      border: "none",
                      borderLeft: "1px solid var(--border)",
                      background: amountFilterMode === "TOLERANCE" ? "var(--blue-600)" : "var(--surface)",
                      color: amountFilterMode === "TOLERANCE" ? "#FFF" : "var(--text-main)",
                      cursor: "pointer",
                    }}
                    onClick={() => setAmountFilterMode("TOLERANCE")}
                    title="Filtrar com tolerância monetária"
                  >
                    Tolerância
                  </button>
                </div>

                {amountFilterMode === "TOLERANCE" && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>± R$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={amountTolerance}
                      onChange={(e) => setAmountTolerance(e.target.value)}
                      style={{
                        width: "60px",
                        padding: "3px 6px",
                        fontSize: "11px",
                        borderRadius: "4px",
                        border: "1px solid var(--border)",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Filtro de Janela de Datas */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>Data:</span>
                <select
                  value={dateToleranceDays}
                  onChange={(e) => setDateToleranceDays(e.target.value)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                  }}
                >
                  <option value="ALL">Todo o período</option>
                  <option value="0">Mesma data</option>
                  <option value="2">± 2 dias</option>
                  <option value="5">± 5 dias</option>
                  <option value="10">± 10 dias</option>
                </select>
              </div>

              {/* Filtro por Tipo */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>Tipo:</span>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as "ALL" | "DEBIT" | "CREDIT")}
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                  }}
                >
                  <option value="ALL">Todos</option>
                  <option value="DEBIT">Débito</option>
                  <option value="CREDIT">Crédito</option>
                </select>
              </div>
            </div>
          </div>

          {/* Colunas Comparativas */}
          <div className="comparison-columns" style={{ gap: "16px" }}>
            {/* Coluna Extrato Bancário */}
            <div className="comparison-col" style={{ display: "flex", flexDirection: "column" }}>
              <div className="col-header">
                <span className="badge-type">Extrato Bancário</span>
                <span className="badge-count">
                  {filteredStatements.length} de {allStatements.length} pendência{allStatements.length > 1 ? "s" : ""}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  overflowY: "auto",
                  maxHeight: "360px",
                  paddingRight: "4px",
                }}
              >
                {filteredStatements.length === 0 ? (
                  <div className="empty" style={{ padding: "20px 12px", fontSize: "12px" }}>
                    Nenhum movimento do extrato corresponde aos filtros.
                  </div>
                ) : (
                  filteredStatements.map((s) => {
                    const isSelected = selectedStatementId === s.id;
                    const isAnchor = anchorIsStatement && anchorItem?.statement?.id === s.id;
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
                            name="bidirectional-statement"
                            value={s.id}
                            checked={isSelected}
                            onChange={() => setSelectedStatementId(s.id)}
                            style={{ marginTop: "3px" }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <strong style={{ fontSize: "14px", color: "var(--blue-950)" }}>
                                  {formatCurrency(s.value)}
                                </strong>
                                {isAnchor && (
                                  <span
                                    className="badge"
                                    style={{
                                      fontSize: "10px",
                                      background: "#DBEAFE",
                                      color: "#1D4ED8",
                                      padding: "1px 6px",
                                    }}
                                  >
                                    Âncora
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                {formatDateForDisplay(s.date)}
                              </span>
                            </div>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginTop: "2px" }}>
                              {s.document ? `Doc: ${s.document}` : "Sem documento"}
                              {(s as { type?: string }).type && <span style={{ marginLeft: "6px", fontSize: "11px", color: "var(--text-muted)" }}>({(s as { type?: string }).type})</span>}
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
                  })
                )}
              </div>
            </div>

            {/* Coluna Razão Protheus */}
            <div className="comparison-col" style={{ display: "flex", flexDirection: "column" }}>
              <div className="col-header">
                <span className="badge-type">Razão Protheus</span>
                <span className="badge-count">
                  {filteredLedgers.length} de {allLedgers.length} pendência{allLedgers.length > 1 ? "s" : ""}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  overflowY: "auto",
                  maxHeight: "360px",
                  paddingRight: "4px",
                }}
              >
                {filteredLedgers.length === 0 ? (
                  <div className="empty" style={{ padding: "20px 12px", fontSize: "12px" }}>
                    Nenhum lançamento do razão corresponde aos filtros.
                  </div>
                ) : (
                  filteredLedgers.map((l) => {
                    const isSelected = selectedLedgerId === l.id;
                    const isAnchor = anchorIsLedger && anchorItem?.ledger?.id === l.id;
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
                            name="bidirectional-ledger"
                            value={l.id}
                            checked={isSelected}
                            onChange={() => setSelectedLedgerId(l.id)}
                            style={{ marginTop: "3px" }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <strong style={{ fontSize: "14px", color: "var(--blue-950)" }}>
                                  {formatCurrency(l.value)}
                                </strong>
                                {isAnchor && (
                                  <span
                                    className="badge"
                                    style={{
                                      fontSize: "10px",
                                      background: "#DBEAFE",
                                      color: "#1D4ED8",
                                      padding: "1px 6px",
                                    }}
                                  >
                                    Âncora
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                {formatDateForDisplay(l.date)}
                              </span>
                            </div>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginTop: "2px" }}>
                              {l.document ? `Doc: ${l.document}` : "Sem documento"}
                              {(l as { type?: string }).type && <span style={{ marginLeft: "6px", fontSize: "11px", color: "var(--text-muted)" }}>({(l as { type?: string }).type})</span>}
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
                              {l.ledgerAccount ? `Conta: ${l.ledgerAccount} · ` : ""}
                              {l.evidence.originalName} · linha {l.evidence.line ?? "—"}
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Painel de Conferência do Par Selecionado */}
          {isValid && selectedStatement && selectedLedger && comparison ? (
            <div
              style={{
                background: comparison.isExactAmount ? "#F0FDF4" : "#FFFBEB",
                border: `1px solid ${comparison.isExactAmount ? "#86EFAC" : "#FCD34D"}`,
                borderRadius: "8px",
                padding: "12px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: comparison.isExactAmount ? "#166534" : "#92400E",
                  }}
                >
                  ✓ Par selecionado para conciliação
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <span
                    className="badge"
                    style={{
                      background: comparison.isExactAmount ? "#DCFCE7" : "#FEF3C7",
                      color: comparison.isExactAmount ? "#166534" : "#92400E",
                      border: `1px solid ${comparison.isExactAmount ? "#86EFAC" : "#FCD34D"}`,
                    }}
                  >
                    {comparison.isExactAmount
                      ? "Diferença: R$ 0,00 (Exato)"
                      : `Diferença de valor: R$ ${Number(comparison.diffAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                  </span>
                  <span
                    className="badge"
                    style={{
                      background: comparison.sameDate ? "#DCFCE7" : "#F1F5F9",
                      color: comparison.sameDate ? "#166534" : "var(--text-main)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {comparison.sameDate ? "Mesma data" : `${comparison.daysDiff} dia(s) de diferença`}
                  </span>
                </div>
              </div>

              <div
                style={{
                  fontSize: "12px",
                  color: comparison.isExactAmount ? "#15803D" : "#78350F",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "10px",
                }}
              >
                <div>
                  <strong>Extrato:</strong> {formatDateForDisplay(selectedStatement.date)} · Doc:{" "}
                  {selectedStatement.document || "—"} · {formatCurrency(selectedStatement.value)}
                  <div style={{ fontSize: "11px", opacity: 0.9, marginTop: "2px" }}>
                    {selectedStatement.history || "Sem descrição"}
                  </div>
                </div>
                <div>
                  <strong>Razão:</strong> {formatDateForDisplay(selectedLedger.date)} · Doc:{" "}
                  {selectedLedger.document || "—"} · {formatCurrency(selectedLedger.value)}
                  <div style={{ fontSize: "11px", opacity: 0.9, marginTop: "2px" }}>
                    {selectedLedger.history || "Sem histórico"}
                  </div>
                </div>
              </div>

              {/* Justificativa contábil */}
              <div style={{ borderTop: `1px dashed ${comparison.isExactAmount ? "#86EFAC" : "#FCD34D"}`, paddingTop: "8px" }}>
                <label
                  htmlFor={justificationInputId}
                  style={{
                    display: "block",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: comparison.isExactAmount ? "#166534" : "#92400E",
                    marginBottom: "4px",
                  }}
                >
                  Observação contábil / Justificativa da conciliação manual:
                </label>
                <input
                  id={justificationInputId}
                  type="text"
                  placeholder="Ex: TED Itaú autorizada referente resgate BB Rende Fácil"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                  }}
                />
              </div>
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
              {!selectedStatementId && !selectedLedgerId
                ? "Selecione 1 movimento do extrato à esquerda e 1 lançamento do razão à direita para conferir e confirmar o pareamento."
                : !selectedStatementId
                ? "Selecione 1 movimento do extrato à esquerda para completar o par."
                : "Selecione 1 lançamento do razão à direita para completar o par."}
            </div>
          )}
        </div>

        {/* Rodapé / Ações */}
        <div className="modal-actions" style={{ borderTop: "1px solid var(--border)", padding: "12px 20px" }}>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="button"
            disabled={!isValid}
            onClick={() => {
              if (selectedStatementId && selectedLedgerId) {
                void onConfirm(selectedStatementId, selectedLedgerId, justification);
              }
            }}
          >
            Confirmar conciliação manual
          </button>
        </div>
      </div>
    </div>
  );
}
