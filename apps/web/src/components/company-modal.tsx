"use client";

import { useState } from "react";

export function CompanyModal({
  isOpen,
  onClose,
  onCreated,
  authenticatedFetch,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (company: { id: string; name: string; organizationId: string; roles: Array<"PREPARER" | "REVIEWER" | "ADMIN" | "AUDITOR"> }) => void;
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const [name, setName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const response = await authenticatedFetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          documentNumber: documentNumber.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Não foi possível criar a empresa");
      }

      const data = await response.json() as { company: { id: string; name: string; organizationId: string; roles: Array<"PREPARER" | "REVIEWER" | "ADMIN" | "AUDITOR"> } };
      onCreated(data.company);
      setName("");
      setDocumentNumber("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar empresa");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Cadastrar Nova Empresa</h3>
            <p>Adicione uma empresa operacional para executar conciliações bancárias.</p>
          </div>
          <button type="button" className="close-button" onClick={onClose}>×</button>
        </div>

        {error ? <div className="notice error" role="alert">{error}</div> : null}

        <form onSubmit={handleSubmit}>
          <label className="field">
            Razão Social / Nome da Empresa
            <input
              type="text"
              placeholder="Ex.: Filial Rio de Janeiro Ltda"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>

          <label className="field">
            CNPJ / Documento (Opcional)
            <input
              type="text"
              placeholder="Ex.: 00.000.000/0002-72"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
          </label>

          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="button" disabled={busy || !name.trim()}>
              {busy ? "Cadastrando..." : "Cadastrar Empresa"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
