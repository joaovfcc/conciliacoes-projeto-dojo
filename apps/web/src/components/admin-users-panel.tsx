"use client";

import { useEffect, useState } from "react";
import type { AuthorizedCompany } from "./reconciliation-app";

type UserItem = {
  id: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  isOwner: boolean;
  passwordChangeRequired: boolean;
  createdAt: string;
  updatedAt: string;
  companyAccesses: Array<{
    companyId: string;
    companyName: string;
    roles: Array<"ADMIN" | "PREPARER" | "REVIEWER" | "AUDITOR">;
  }>;
};

type AuthenticatedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function AdminUsersPanel({
  companies,
  currentUserEmail,
  authenticatedFetch,
}: {
  companies: AuthorizedCompany[];
  currentUserEmail: string;
  authenticatedFetch: AuthenticatedFetch;
}) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  // Form states
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsOwner, setNewIsOwner] = useState(false);
  const [newRoles, setNewRoles] = useState<Array<"ADMIN" | "PREPARER" | "REVIEWER" | "AUDITOR">>([
    "PREPARER",
    "REVIEWER",
  ]);
  const [newCompanyIds, setNewCompanyIds] = useState<string[]>([]);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authenticatedFetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Erro ao carregar lista de usuários");
      }
      const data = (await res.json()) as { users: UserItem[] };
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na comunicação com o servidor");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionBusy(true);
      setError("");
      const res = await authenticatedFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          password: newPassword,
          roles: newRoles,
          companyIds: newIsOwner ? companies.map((c) => c.id) : newCompanyIds,
          isOwner: newIsOwner,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Não foi possível cadastrar o usuário. Verifique os dados informados.");
      }
      setSuccessMessage(`Usuário ${newEmail} cadastrado com sucesso.`);
      setIsCreateOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewIsOwner(false);
      setNewCompanyIds([]);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cadastrar o usuário no momento.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleStatus = async (user: UserItem) => {
    const nextStatus = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      setActionBusy(true);
      const res = await authenticatedFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Não foi possível atualizar a situação do usuário.");
      }
      setSuccessMessage(`O acesso de ${user.email} foi ${nextStatus === "ACTIVE" ? "ativado" : "desativado"}.`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível alterar a situação do usuário.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      setActionBusy(true);
      setError("");
      const res = await authenticatedFetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPasswordValue }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Não foi possível atualizar a senha.");
      }
      setSuccessMessage(`Senha de ${selectedUser.email} atualizada com sucesso.`);
      setIsResetPasswordOpen(false);
      setResetPasswordValue("");
      setSelectedUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a nova senha.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    try {
      setActionBusy(true);
      setError("");
      const res = await authenticatedFetch(`/api/admin/users/${selectedUser.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Não foi possível remover o usuário.");
      }
      setSuccessMessage(`Usuário ${selectedUser.email} removido com sucesso.`);
      setIsDeleteOpen(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover o usuário.");
    } finally {
      setActionBusy(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.companyAccesses.some((ca) => ca.companyName.toLowerCase().includes(search.toLowerCase())),
  );

  function formatRoleLabel(user: UserItem): string {
    if (user.isOwner) return "Administrador global";
    const roles = user.companyAccesses[0]?.roles ?? [];
    if (roles.includes("ADMIN")) return "Administrador da empresa";
    if (roles.includes("PREPARER") || roles.includes("REVIEWER")) return "Analista contábil";
    if (roles.includes("AUDITOR")) return "Auditor";
    return "Analista contábil";
  }

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Usuários</h2>
          <p>Controle de acesso e operadores do sistema.</p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => {
            setError("");
            setIsCreateOpen(true);
          }}
        >
          Novo usuário
        </button>
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

      <div className="card panel">
        <div className="table-controls">
          <input
            type="search"
            className="search-input"
            style={{ maxWidth: "320px" }}
            placeholder="Buscar por e-mail ou empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="table-counter">{filteredUsers.length} usuários cadastrados</span>
        </div>

        {loading ? (
          <div className="table-loading">
            <span className="spinner spinner-lg" />
            <span>Carregando lista de usuários...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="table-empty">Nenhum usuário encontrado.</div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Empresas vinculadas</th>
                  <th>Criado em</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const isCurrent = user.email.toLowerCase() === currentUserEmail.toLowerCase();
                  return (
                    <tr key={user.id} style={{ opacity: user.status === "DISABLED" ? 0.6 : 1 }}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span className="user-identity-avatar" style={{ width: "24px", height: "24px", fontSize: "10px" }}>
                            {user.email.slice(0, 2).toUpperCase()}
                          </span>
                          <strong>{user.email}</strong>
                          {isCurrent && <span className="badge badge-secondary">(Você)</span>}
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-primary">{formatRoleLabel(user)}</span>
                      </td>
                      <td>
                        {user.isOwner ? (
                          <span className="text-muted text-sm">Todas as Empresas</span>
                        ) : user.companyAccesses.length > 0 ? (
                          <div className="tag-list">
                            {user.companyAccesses.map((ca) => (
                              <span key={ca.companyId} className="tag">
                                {ca.companyName}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted text-sm">Nenhuma</span>
                        )}
                      </td>
                      <td className="text-muted text-sm">
                        {new Date(user.createdAt).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </td>
                      <td>
                        <span className={`status-pill ${user.status === "ACTIVE" ? "status-active" : "status-inactive"}`}>
                          {user.status === "ACTIVE" ? "Ativo" : "Desativado"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div className="actions" style={{ justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="button secondary btn-sm"
                            title="Redefinir Senha"
                            onClick={() => {
                              setSelectedUser(user);
                              setResetPasswordValue("");
                              setIsResetPasswordOpen(true);
                            }}
                          >
                            Senha
                          </button>
                          {!isCurrent && (
                            <>
                              <button
                                type="button"
                                className="button secondary btn-sm"
                                disabled={actionBusy}
                                onClick={() => handleToggleStatus(user)}
                              >
                                {user.status === "ACTIVE" ? "Desativar" : "Ativar"}
                              </button>
                              <button
                                type="button"
                                className="button danger btn-sm"
                                title="Excluir Usuário"
                                disabled={actionBusy}
                                onClick={() => {
                                  setSelectedUser(user);
                                  setIsDeleteOpen(true);
                                }}
                              >
                                Excluir
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Novo Usuário */}
      {isCreateOpen && (
        <div className="modal-backdrop" onClick={() => setIsCreateOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Cadastrar Novo Usuário</h3>
              <button type="button" className="close-button" onClick={() => setIsCreateOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="user-email-input">
                    E-mail do Usuário *
                  </label>
                  <input
                    id="user-email-input"
                    type="email"
                    className="form-control"
                    required
                    placeholder="usuario@empresa.com.br"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="user-password-input">
                    Senha Temporária (Mínimo 12 caracteres) *
                  </label>
                  <input
                    id="user-password-input"
                    type="password"
                    className="form-control"
                    required
                    minLength={12}
                    placeholder="••••••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      checked={newIsOwner}
                      onChange={(e) => setNewIsOwner(e.target.checked)}
                    />
                    <span>Administrador Global (Acesso a todas as empresas)</span>
                  </label>
                </div>

                {!newIsOwner && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Perfil de Acesso</label>
                      <select
                        className="form-control"
                        value={newRoles[0] || "PREPARER"}
                        onChange={(e) => {
                          const val = e.target.value as "ADMIN" | "PREPARER" | "REVIEWER" | "AUDITOR";
                          setNewRoles(val === "ADMIN" ? ["ADMIN", "PREPARER", "REVIEWER"] : [val]);
                        }}
                      >
                        <option value="PREPARER">Analista contábil (Preparador / Revisor)</option>
                        <option value="ADMIN">Administrador da empresa</option>
                        <option value="AUDITOR">Auditor (Somente leitura)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Empresas com Acesso</label>
                      <div style={{ display: "grid", gap: "6px", maxHeight: "140px", overflowY: "auto", border: "1px solid var(--border)", padding: "8px", borderRadius: "6px" }}>
                        {companies.map((c) => (
                          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                            <input
                              type="checkbox"
                              checked={newCompanyIds.includes(c.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewCompanyIds([...newCompanyIds, c.id]);
                                } else {
                                  setNewCompanyIds(newCompanyIds.filter((id) => id !== c.id));
                                }
                              }}
                            />
                            <span>{c.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="button secondary" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button" disabled={actionBusy}>
                  {actionBusy ? "Salvando..." : "Criar Usuário"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Redefinir Senha */}
      {isResetPasswordOpen && selectedUser && (
        <div className="modal-backdrop" onClick={() => setIsResetPasswordOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Redefinir Senha ({selectedUser.email})</h3>
              <button type="button" className="close-button" onClick={() => setIsResetPasswordOpen(false)}>
                ×
              </button>
            </div>
            <form onSubmit={handleResetPassword}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="reset-password-input">
                    Nova Senha Temporária *
                  </label>
                  <input
                    id="reset-password-input"
                    type="password"
                    className="form-control"
                    required
                    minLength={12}
                    placeholder="Mínimo 12 caracteres"
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="button secondary" onClick={() => setIsResetPasswordOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button" disabled={actionBusy || resetPasswordValue.length < 12}>
                  {actionBusy ? "Salvando..." : "Salvar Senha"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Excluir Usuário */}
      {isDeleteOpen && selectedUser && (
        <div className="modal-backdrop" onClick={() => setIsDeleteOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirmar exclusão de usuário</h3>
              <button type="button" className="close-button" onClick={() => setIsDeleteOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Tem certeza que deseja excluir o usuário <strong>{selectedUser.email}</strong>?
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setIsDeleteOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="button danger" disabled={actionBusy} onClick={handleDeleteUser}>
                {actionBusy ? "Excluindo..." : "Excluir usuário"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
