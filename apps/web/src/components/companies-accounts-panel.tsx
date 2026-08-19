"use client";

import { useEffect, useState } from "react";
import type { AuthorizedCompany } from "./reconciliation-app";

type BankAccountItem = {
  id: string;
  companyId: string;
  bankCode: string | null;
  bankName: string | null;
  agency: string | null;
  accountNumber: string | null;
  accountDigit: string | null;
  accountType: string;
  currency: string;
  status: string;
  createdAt: string;
};

type LedgerAccountItem = {
  id: string;
  companyId: string;
  code: string;
  description: string;
  sourceSystem: string;
  status: string;
  createdAt: string;
};

type LinkedAccountRow = {
  id: string;
  ledgerId?: string | undefined;
  bankId?: string | undefined;
  ledgerCode: string;
  description: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  type: string;
  statementFormat: string;
  tolerance: string;
  status: string;
};

type AuthenticatedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function CompaniesAccountsPanel({
  companies,
  selectedCompanyId,
  onCompanySelect,
  onRefreshCompanies,
  authenticatedFetch,
}: {
  companies: AuthorizedCompany[];
  selectedCompanyId: string;
  onCompanySelect: (id: string) => void;
  onRefreshCompanies: () => Promise<void>;
  authenticatedFetch: AuthenticatedFetch;
}) {
  const [activeTab, setActiveTab] = useState<"ACCOUNTS" | "COMPANIES">("ACCOUNTS");
  const [bankAccounts, setBankAccounts] = useState<BankAccountItem[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Modal: Nova Empresa
  const [isNewCompanyOpen, setIsNewCompanyOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyDoc, setNewCompanyDoc] = useState("");

  // Modal: Nova Conta Vinculada
  const [isNewAccountOpen, setIsNewAccountOpen] = useState(false);
  const [accountKind, setAccountKind] = useState<"MAPPING" | "LEDGER" | "BANK">("MAPPING");
  const [ledgerCode, setLedgerCode] = useState("");
  const [ledgerDescription, setLedgerDescription] = useState("");
  const [bankCode, setBankCode] = useState("341");
  const [bankName, setBankName] = useState("Banco Itaú");
  const [agency, setAgency] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  // Modal: Exclusão
  const [isDeleteCompanyOpen, setIsDeleteCompanyOpen] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState<AuthorizedCompany | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<{ id: string; type: "BANK" | "LEDGER"; name: string } | null>(
    null,
  );

  const [actionBusy, setActionBusy] = useState(false);

  const currentCompany = companies.find((c) => c.id === selectedCompanyId) ?? companies[0];

  const loadCompanyAccounts = async (compCompanyId: string) => {
    if (!compCompanyId) return;
    try {
      setLoading(true);
      setError("");
      const res = await authenticatedFetch(`/api/companies/${compCompanyId}/accounts`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Erro ao carregar contas da empresa");
      }
      const data = (await res.json()) as {
        bankAccounts: BankAccountItem[];
        ledgerAccounts: LedgerAccountItem[];
      };
      setBankAccounts(data.bankAccounts ?? []);
      setLedgerAccounts(data.ledgerAccounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar contas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentCompany?.id) {
      void loadCompanyAccounts(currentCompany.id);
    }
  }, [currentCompany?.id]);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionBusy(true);
      setError("");
      const res = await authenticatedFetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCompanyName.trim(),
          documentNumber: newCompanyDoc.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Não foi possível cadastrar a empresa. Verifique os dados informados.");
      }
      setSuccessMessage(`Empresa "${newCompanyName}" cadastrada com sucesso.`);
      setIsNewCompanyOpen(false);
      setNewCompanyName("");
      setNewCompanyDoc("");
      await onRefreshCompanies();
      if (data.company?.id) {
        onCompanySelect(data.company.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cadastrar a empresa no momento.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!companyToDelete) return;
    try {
      setActionBusy(true);
      setError("");
      const res = await authenticatedFetch(`/api/companies/${companyToDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Não foi possível remover a empresa.");
      }
      setSuccessMessage(`Empresa "${companyToDelete.name}" removida com sucesso.`);
      setIsDeleteCompanyOpen(false);
      setCompanyToDelete(null);
      await onRefreshCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a empresa.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany) return;
    try {
      setActionBusy(true);
      setError("");
      const res = await authenticatedFetch(`/api/companies/${currentCompany.id}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: accountKind,
          ledgerCode,
          description: ledgerDescription,
          bankCode,
          bankName,
          agency,
          accountNumber,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Não foi possível cadastrar a conta.");
      }
      setSuccessMessage("Conta vinculada cadastrada com sucesso.");
      setIsNewAccountOpen(false);
      setLedgerCode("");
      setLedgerDescription("");
      setAgency("");
      setAccountNumber("");
      await loadCompanyAccounts(currentCompany.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cadastrar a conta no momento.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountToDelete || !currentCompany) return;
    try {
      setActionBusy(true);
      setError("");
      const res = await authenticatedFetch(
        `/api/companies/${currentCompany.id}/accounts/${accountToDelete.id}?type=${accountToDelete.type}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Não foi possível remover a conta.");
      }
      setSuccessMessage(`Conta "${accountToDelete.name}" removida com sucesso.`);
      setAccountToDelete(null);
      await loadCompanyAccounts(currentCompany.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a conta.");
    } finally {
      setActionBusy(false);
    }
  };

  const bankPresets = [
    { code: "341", name: "Banco Itaú" },
    { code: "237", name: "Banco Bradesco" },
    { code: "001", name: "Banco do Brasil" },
    { code: "033", name: "Banco Santander" },
    { code: "104", name: "Caixa Econômica Federal" },
    { code: "077", name: "Banco Inter" },
    { code: "260", name: "Nu Pagamentos (Nubank)" },
    { code: "422", name: "Banco Safra" },
    { code: "000", name: "Outro Banco" },
  ];

  // Construir tabela de contas vinculadas consolidada
  const linkedRows: LinkedAccountRow[] = [];
  const maxRows = Math.max(ledgerAccounts.length, bankAccounts.length);

  for (let i = 0; i < maxRows; i++) {
    const l = ledgerAccounts[i];
    const b = bankAccounts[i];
    linkedRows.push({
      id: l?.id || b?.id || String(i),
      ledgerId: l?.id,
      bankId: b?.id,
      ledgerCode: l?.code || "—",
      description: l?.description || "—",
      bankName: b?.bankName || (b?.bankCode ? `Banco ${b.bankCode}` : "—"),
      agency: b?.agency || "—",
      accountNumber: b?.accountNumber ? `${b.accountNumber}${b.accountDigit ? `-${b.accountDigit}` : ""}` : "—",
      type: b?.accountType === "CHECKING" ? "Conta Corrente" : b?.accountType || "Ativo",
      statementFormat: "Automático (OFX/XLSX/PDF)",
      tolerance: "R$ 0,01 / 2 dias",
      status: l?.status === "ACTIVE" || b?.status === "ACTIVE" ? "Ativa" : "Ativa",
    });
  }

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Empresas & Contas</h2>
          <p>Configure o vínculo entre contas contábeis e contas bancárias para conciliação.</p>
        </div>
        <div className="actions">
          {activeTab === "COMPANIES" ? (
            <button type="button" className="button" onClick={() => setIsNewCompanyOpen(true)}>
              Nova empresa
            </button>
          ) : (
            <button type="button" className="button" onClick={() => setIsNewAccountOpen(true)}>
              Nova conta vinculada
            </button>
          )}
        </div>
      </div>

      {successMessage && (
        <div className="notice success">
          <span>{successMessage}</span>
          <button type="button" className="btn-close" onClick={() => setSuccessMessage("")}>
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="notice error">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}

      {/* Subtabs de navegação */}
      <div className="subtabs-bar">
        <button
          type="button"
          className={`subtab-btn ${activeTab === "ACCOUNTS" ? "active" : ""}`}
          onClick={() => setActiveTab("ACCOUNTS")}
        >
          Contas vinculadas ({currentCompany?.name ?? "Empresa"})
        </button>
        <button
          type="button"
          className={`subtab-btn ${activeTab === "COMPANIES" ? "active" : ""}`}
          onClick={() => setActiveTab("COMPANIES")}
        >
          Empresas cadastradas ({companies.length})
        </button>
      </div>

      {/* Aba de Contas Vinculadas */}
      {activeTab === "ACCOUNTS" && (
        <div className="card panel">
          <div className="table-controls" style={{ marginBottom: "20px" }}>
            <label className="field" style={{ margin: 0, flexDirection: "row", alignItems: "center", gap: "10px" }}>
              <span>Empresa selecionada:</span>
              <select
                style={{ width: "auto", height: "38px" }}
                value={currentCompany?.id ?? ""}
                onChange={(e) => onCompanySelect(e.target.value)}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <span className="table-counter">
              {ledgerAccounts.length} contas contábeis · {bankAccounts.length} contas bancárias
            </span>
          </div>

          {loading ? (
            <div className="table-loading">
              <span className="spinner spinner-lg" />
              <span>Carregando catálogo de contas...</span>
            </div>
          ) : linkedRows.length === 0 ? (
            <div className="table-empty">
              <strong>Nenhuma conta vinculada para esta empresa.</strong>
              <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "13px" }}>
                Cadastre uma conta contábil e uma conta bancária para permitir a conciliação.
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Conta contábil</th>
                    <th>Descrição</th>
                    <th>Banco</th>
                    <th>Agência</th>
                    <th>Conta bancária</th>
                    <th>Tipo</th>
                    <th>Formato do extrato</th>
                    <th>Tolerância</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.ledgerCode}</strong>
                      </td>
                      <td>{row.description}</td>
                      <td>{row.bankName}</td>
                      <td>{row.agency}</td>
                      <td>{row.accountNumber}</td>
                      <td>
                        <span className="badge badge-secondary">{row.type}</span>
                      </td>
                      <td className="text-muted text-sm">{row.statementFormat}</td>
                      <td className="text-muted text-sm">{row.tolerance}</td>
                      <td>
                        <span className="status-pill status-active">{row.status}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="button danger btn-sm"
                          title="Remover conta"
                          onClick={() => {
                            if (row.ledgerId) {
                              setAccountToDelete({ id: row.ledgerId, type: "LEDGER", name: row.ledgerCode });
                            } else if (row.bankId) {
                              setAccountToDelete({ id: row.bankId, type: "BANK", name: `${row.bankName} ${row.accountNumber}` });
                            }
                          }}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Aba de Empresas Cadastradas */}
      {activeTab === "COMPANIES" && (
        <div className="card panel">
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nome da Empresa</th>
                  <th>ID do Sistema</th>
                  <th>Papéis</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((comp) => (
                  <tr key={comp.id}>
                    <td>
                      <strong>{comp.name}</strong>
                    </td>
                    <td className="text-monospace text-sm text-muted">{comp.id}</td>
                    <td>
                      <span className="badge badge-secondary">{comp.roles.join(", ")}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="button secondary btn-sm"
                          onClick={() => {
                            onCompanySelect(comp.id);
                            setActiveTab("ACCOUNTS");
                          }}
                        >
                          Ver contas
                        </button>
                        <button
                          type="button"
                          className="button danger btn-sm"
                          title="Excluir Empresa"
                          disabled={actionBusy}
                          onClick={() => {
                            setCompanyToDelete(comp);
                            setIsDeleteCompanyOpen(true);
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Nova Empresa */}
      {isNewCompanyOpen && (
        <div className="modal-backdrop" onClick={() => setIsNewCompanyOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Cadastrar Nova Empresa</h3>
              <button type="button" className="close-button" onClick={() => setIsNewCompanyOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreateCompany}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="company-name-input">
                    Razão Social / Nome da Empresa *
                  </label>
                  <input
                    id="company-name-input"
                    type="text"
                    className="form-control"
                    required
                    placeholder="Ex.: Filial São Paulo Ltda"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="company-doc-input">
                    CNPJ ou Identificador Fiscal (Opcional)
                  </label>
                  <input
                    id="company-doc-input"
                    type="text"
                    className="form-control"
                    placeholder="Ex.: 00.000.000/0001-00"
                    value={newCompanyDoc}
                    onChange={(e) => setNewCompanyDoc(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="button secondary" onClick={() => setIsNewCompanyOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button" disabled={actionBusy}>
                  {actionBusy ? "Salvando..." : "Criar Empresa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nova Conta Vinculada */}
      {isNewAccountOpen && (
        <div className="modal-backdrop" onClick={() => setIsNewAccountOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nova conta vinculada ({currentCompany?.name})</h3>
              <button type="button" className="close-button" onClick={() => setIsNewAccountOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreateAccount}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tipo de Cadastro</label>
                  <div className="kind-selector-tabs">
                    <button
                      type="button"
                      className={`kind-btn ${accountKind === "MAPPING" ? "active" : ""}`}
                      onClick={() => setAccountKind("MAPPING")}
                    >
                      Conta contábil + bancária (Vinculadas)
                    </button>
                    <button
                      type="button"
                      className={`kind-btn ${accountKind === "LEDGER" ? "active" : ""}`}
                      onClick={() => setAccountKind("LEDGER")}
                    >
                      Apenas conta contábil
                    </button>
                    <button
                      type="button"
                      className={`kind-btn ${accountKind === "BANK" ? "active" : ""}`}
                      onClick={() => setAccountKind("BANK")}
                    >
                      Apenas conta bancária
                    </button>
                  </div>
                </div>

                {(accountKind === "MAPPING" || accountKind === "LEDGER") && (
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label" htmlFor="ledger-code-input">
                        Código contábil no Protheus *
                      </label>
                      <input
                        id="ledger-code-input"
                        type="text"
                        className="form-control"
                        required
                        placeholder="Ex.: 11102027"
                        value={ledgerCode}
                        onChange={(e) => setLedgerCode(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="ledger-desc-input">
                        Descrição da conta
                      </label>
                      <input
                        id="ledger-desc-input"
                        type="text"
                        className="form-control"
                        placeholder="Ex.: Banco Itaú C/C 26775-6"
                        value={ledgerDescription}
                        onChange={(e) => setLedgerDescription(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {(accountKind === "MAPPING" || accountKind === "BANK") && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="bank-select">
                        Instituição Bancária
                      </label>
                      <select
                        id="bank-select"
                        className="form-control"
                        value={bankCode}
                        onChange={(e) => {
                          const code = e.target.value;
                          setBankCode(code);
                          const preset = bankPresets.find((p) => p.code === code);
                          if (preset) setBankName(preset.name);
                        }}
                      >
                        {bankPresets.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.code} - {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label" htmlFor="agency-input">
                          Agência (sem dígito)
                        </label>
                        <input
                          id="agency-input"
                          type="text"
                          className="form-control"
                          placeholder="Ex.: 0191"
                          value={agency}
                          onChange={(e) => setAgency(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="account-num-input">
                          Número da conta corrente
                        </label>
                        <input
                          id="account-num-input"
                          type="text"
                          className="form-control"
                          placeholder="Ex.: 0026775-6"
                          value={accountNumber}
                          onChange={(e) => setAccountNumber(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="button secondary" onClick={() => setIsNewAccountOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button" disabled={actionBusy}>
                  {actionBusy ? "Salvando..." : "Salvar conta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Excluir Empresa */}
      {isDeleteCompanyOpen && companyToDelete && (
        <div className="modal-backdrop" onClick={() => setIsDeleteCompanyOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirmar exclusão da empresa</h3>
              <button type="button" className="close-button" onClick={() => setIsDeleteCompanyOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Tem certeza que deseja excluir a empresa <strong>{companyToDelete.name}</strong>?
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setIsDeleteCompanyOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="button danger" disabled={actionBusy} onClick={handleDeleteCompany}>
                {actionBusy ? "Excluindo..." : "Excluir empresa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Excluir Conta */}
      {accountToDelete && (
        <div className="modal-backdrop" onClick={() => setAccountToDelete(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirmar exclusão da conta</h3>
              <button type="button" className="close-button" onClick={() => setAccountToDelete(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Tem certeza que deseja remover a conta <strong>{accountToDelete.name}</strong>?
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setAccountToDelete(null)}>
                Cancelar
              </button>
              <button type="button" className="button danger" disabled={actionBusy} onClick={handleDeleteAccount}>
                {actionBusy ? "Removendo..." : "Remover conta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
