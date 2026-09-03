"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  AccountMapping,
  InvestmentEntry,
  PreflightResult,
  ProcessingResult,
  ReconciliationResult,
  SignProfile,
} from "@conciliacao/core";
import { bankAccountsMatch, compareBankAccountIdentities } from "@conciliacao/core/normalization";
import {
  bankLabel,
  documentKindLabel,
  extractionMethodLabel,
  formatDateForDisplay,
  investmentKindLabel,
  issueCategoryLabel,
  parserLabel,
  reconciliationRuleLabel,
  resultStatusLabel,
} from "@conciliacao/core/presentation";
import type { PublicSession, StoredFile } from "@conciliacao/runtime";
import { CompanyModal } from "./company-modal";
import { EvidenceDrawer } from "./evidence-drawer";
import { AdminUsersPanel } from "./admin-users-panel";
import { CompaniesAccountsPanel } from "./companies-accounts-panel";

type View = "RECONCILIATION" | "HISTORY" | "COMPANIES_ACCOUNTS" | "USERS";
type Stage = "WELCOME" | "FILES" | "PREFLIGHT" | "CONFIRM" | "PROCESSING" | "RESULTS";
type SessionCredential = { id: string; token: string };
type ApiError = { error?: { code?: string; message?: string } };
type AuthenticatedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AuthorizedCompany = {
  id: string;
  organizationId: string;
  name: string;
  roles: Array<"PREPARER" | "REVIEWER" | "ADMIN" | "AUDITOR">;
};

type HistoryItem = {
  id: string;
  companyId: string;
  companyName: string;
  status: "COMPLETED" | "COMPLETED_WITH_ISSUES";
  period: string;
  completedAt: string;
  expiresAt: string;
};

const sessionTokenHeader = "X-Reconciliation-Session-Token";

export const tabs = [
  { id: "EXATOS", label: "Automáticos", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_EXACT" || item.status === "AUTO_MATCH_UNIQUE_VALUE" },
  { id: "PROXIMIDADE", label: "Proximidade", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_DATE_TOLERANCE" },
  { id: "GRUPOS", label: "Grupos", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_GROUP" },
  { id: "SUGESTOES_GRUPOS", label: "Sugestões de grupos", test: (item: ReconciliationResult) => item.status === "GROUP_SUGGESTION" },
  { id: "TOTAL_DIARIO", label: "Total diário", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_DAILY_TOTAL" },
  { id: "COMPENSADOS", label: "Compensados", test: (item: ReconciliationResult) => item.status === "BANK_NET_ZERO" },
  { id: "APLICACOES", label: "Aplicações automáticas", test: (item: ReconciliationResult) => item.status === "AUTO_APPLICATION_EXCLUDED" },
  { id: "RAZAO_SEM_EXTRATO", label: "Razão sem extrato", test: (item: ReconciliationResult) => item.status === "LEDGER_WITHOUT_STATEMENT" },
  { id: "EXTRATO_SEM_RAZAO", label: "Extrato sem razão", test: (item: ReconciliationResult) => item.status === "STATEMENT_WITHOUT_LEDGER" },
  { id: "AMBIGUIDADES", label: "Ambiguidades e duplicidades", test: (item: ReconciliationResult) => item.status === "AMBIGUOUS_MATCH" || item.status === "POSSIBLE_DUPLICATE" },
  { id: "INVESTIMENTOS", label: "Investimentos", test: (_item: ReconciliationResult) => false },
  { id: "ARQUIVOS_ERROS", label: "Arquivos e erros", test: (_item: ReconciliationResult) => false },
] as const;

export function ReconciliationApp({
  companies: initialCompanies,
  userEmail,
  logout,
  authenticatedFetch,
}: {
  companies: AuthorizedCompany[];
  userEmail: string;
  logout: () => Promise<void>;
  authenticatedFetch: AuthenticatedFetch;
}) {
  const [view, setView] = useState<View>("RECONCILIATION");
  const [companies, setCompanies] = useState<AuthorizedCompany[]>(initialCompanies);
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("WELCOME");
  const [credential, setCredential] = useState<SessionCredential | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [ledgerFile, setLedgerFile] = useState<File | null>(null);
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [valueTolerance, setValueTolerance] = useState("0.01");
  const [dateToleranceDays, setDateToleranceDays] = useState("2");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [statementMappings, setStatementMappings] = useState<Record<string, string>>({});
  const [linkedPhysicalStatementIds, setLinkedPhysicalStatementIds] = useState<Record<string, boolean>>({});
  const [company, setCompany] = useState("");
  const [branch, setBranch] = useState("");
  const [period, setPeriod] = useState("");
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("EXATOS");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReconciliationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => initialCompanies.find(canPrepare)?.id ?? "");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyRecordId, setHistoryRecordId] = useState<string | null>(null);
  const [preflightStatusText, setPreflightStatusText] = useState("Validando conteúdo e identificando contas contábeis e bancárias.");
  const [preflightProgress, setPreflightProgress] = useState(20);
  const [preflightActiveStep, setPreflightActiveStep] = useState<"UPLOAD" | "PARSING" | "MAPPING">("UPLOAD");
  const effectAuthenticatedFetch = useEffectEvent(authenticatedFetch);

  const isAdmin = useMemo(
    () => companies.some((c) => c.roles.includes("ADMIN")),
    [companies],
  );

  // Sincronizar seleção quando a lista de empresas for atualizada
  useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
      const eligible = companies.find(canPrepare) ?? companies[0];
      if (eligible) setSelectedCompanyId(eligible.id);
    }
  }, [companies, selectedCompanyId]);

  // Carregar histórico recente
  const reloadHistory = async () => {
    try {
      const response = await effectAuthenticatedFetch("/api/reconciliation-history?size=50", { cache: "no-store" });
      if (response.ok) {
        const body = (await response.json()) as { items?: HistoryItem[] };
        setHistory(body.items ?? []);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void reloadHistory();
  }, []);

  const reloadCompanies = async () => {
    try {
      const res = await authenticatedFetch("/api/companies", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { companies?: AuthorizedCompany[] };
        if (data.companies) setCompanies(data.companies);
      }
    } catch {
      // Ignore
    }
  };

  // Heartbeat de sessão
  useEffect(() => {
    if (!credential) return;
    const timer = window.setInterval(() => {
      void effectAuthenticatedFetch(`/api/sessions/${credential.id}/heartbeat`, {
        method: "POST",
        headers: sessionHeaders(credential),
        cache: "no-store",
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [credential]);

  // Polling de status do processamento
  useEffect(() => {
    if (!credential || (stage !== "PROCESSING" && stage !== "PREFLIGHT")) return;
    const timer = window.setInterval(() => {
      void effectAuthenticatedFetch(`/api/sessions/${credential.id}/status`, {
        headers: sessionHeaders(credential),
        cache: "no-store",
      })
        .then((response) => readResponse<{ session: PublicSession }>(response))
        .then(({ session: current }) => {
          setSession(current);
          if (stage === "PREFLIGHT" && current.preflight) showPreflight(current.preflight);
          else if (current.result) {
            setResult(current.result);
            setStage("RESULTS");
          } else if (current.status === "FAILED") {
            setError(current.errorMessage ?? "O processamento falhou e a sessão foi encerrada.");
            void effectAuthenticatedFetch(`/api/sessions/${credential.id}/close`, {
              method: "POST",
              headers: sessionHeaders(credential),
              keepalive: true,
            });
            setCredential(null);
            setStage("WELCOME");
          }
        })
        .catch((exception) => setError(messageOf(exception)));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [credential, stage]);

  useEffect(() => {
    if (!credential) return;
    const close = () => {
      void effectAuthenticatedFetch(`/api/sessions/${credential.id}/close`, {
        method: "POST",
        headers: sessionHeaders(credential),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, [credential]);

  const visibleResults = useMemo(() => {
    if (!result) return [];
    const tab = tabs.find((item) => item.id === activeTab)!;
    const normalized = search.trim().toLocaleUpperCase("pt-BR");
    return result.results
      .filter(tab.test)
      .filter((item) => !normalized || JSON.stringify(item).toLocaleUpperCase("pt-BR").includes(normalized));
  }, [result, activeTab, search]);

  function showPreflight(detected: PreflightResult): void {
    setPreflight(detected);
    setCompany(detected.companies[0] ?? "");
    setBranch(detected.branches[0] ?? "");
    const detectedPeriod =
      detected.detectedPeriods.length === 1
        ? detected.detectedPeriods[0]!.period
        : (detected.detectedPeriods[0]?.period ?? "");
    setPeriod(detectedPeriod);

    setStatementMappings(proposeStatementMappings(detected));
    setLinkedPhysicalStatementIds({});
    setStage("CONFIRM");
  }

  function handleCompanyCreated(newCompany: AuthorizedCompany) {
    setCompanies((prev) => {
      const exists = prev.some((c) => c.id === newCompany.id);
      return exists ? prev : [...prev, newCompany];
    });
    setSelectedCompanyId(newCompany.id);
  }

  async function begin(): Promise<void> {
    setError("");
    setBusy(true);
    try {
      setStage("FILES");
    } catch (exception) {
      setError(messageOf(exception));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAndAnalyze(): Promise<void> {
    if (!ledgerFile || statementFiles.length < 1 || !valueTolerance) return;
    setBusy(true);
    setError("");
    setPreflightProgress(12);
    setPreflightActiveStep("UPLOAD");
    setPreflightStatusText("Iniciando sessão de conciliação...");
    setStage("PREFLIGHT");
    try {
      const initResponse = await authenticatedFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId || companies[0]?.id }),
      });
      const initBody = await readResponse<{ session: PublicSession; token: string }>(initResponse);
      const activeCredential = { id: initBody.session.id, token: initBody.token };
      setCredential(activeCredential);

      setPreflightProgress(25);
      setPreflightStatusText(`Enviando Razão Protheus (${ledgerFile.name})...`);
      await uploadFile(authenticatedFetch, activeCredential, ledgerFile, "LEDGER");

      const totalStatements = statementFiles.length;
      for (let i = 0; i < totalStatements; i++) {
        const file = statementFiles[i]!;
        const percent = 30 + Math.round(((i + 1) / totalStatements) * 45);
        setPreflightProgress(percent);
        setPreflightStatusText(`Enviando extrato bancário ${i + 1} de ${totalStatements} (${file.name})...`);
        await uploadFile(authenticatedFetch, activeCredential, file, "STATEMENT");
      }

      setPreflightActiveStep("PARSING");
      setPreflightProgress(80);
      setPreflightStatusText("Identificando estrutura, leiautes e contas...");

      const response = await authenticatedFetch(`/api/sessions/${activeCredential.id}/preflight`, {
        method: "POST",
        headers: sessionHeaders(activeCredential),
      });

      setPreflightActiveStep("MAPPING");
      setPreflightProgress(95);
      setPreflightStatusText("Cruzando contas contábeis com extratos bancários...");

      const body = await readResponse<{ session: PublicSession }>(response);
      setSession(body.session);
      const detected = body.session.preflight;
      if (detected) showPreflight(detected);
    } catch (exception) {
      setError(messageOf(exception));
      setStage("FILES");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndProcess(): Promise<void> {
    if (!credential || !preflight) return;
    const mappings = confirmedMappings(preflight, statementMappings, linkedPhysicalStatementIds);
    if (!period) {
      setError("Confirme a competência antes de iniciar a conciliação.");
      return;
    }
    if (!Number.isInteger(Number(dateToleranceDays)) || Number(dateToleranceDays) < 0 || Number(dateToleranceDays) > 3) {
      setError("Informe uma tolerância de data inteira entre 0 e 3 dias.");
      return;
    }
    const mappedStatementCount = mappings.reduce((acc, m) => acc + m.statementFileIds.length, 0);
    if (mappedStatementCount !== preflight.statements.filter((item) => item.reconciliationEligible).length) {
      setError("Selecione uma conta contábil para cada extrato elegível.");
      return;
    }
    setBusy(true);
    setError("");
    setStage("PROCESSING");
    try {
      const response = await authenticatedFetch(`/api/sessions/${credential.id}/confirm-and-process`, {
        method: "POST",
        headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          branch: branch || undefined,
          period,
          valueTolerance: valueTolerance.replace(",", "."),
          dateToleranceDays: Number(dateToleranceDays),
          mappings,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = await readResponse<{ session: PublicSession }>(response);
      setSession(body.session);
      setResult(body.session.result ?? null);
      setStage(body.session.result ? "RESULTS" : "PROCESSING");
      void reloadHistory();
    } catch (exception) {
      setError(messageOf(exception));
      setStage("CONFIRM");
    } finally {
      setBusy(false);
    }
  }

  async function download(): Promise<void> {
    if (!credential && !historyRecordId) return;
    setBusy(true);
    setError("");
    try {
      const response = historyRecordId
        ? await authenticatedFetch(`/api/reconciliation-history/${historyRecordId}/export.xlsx`)
        : await authenticatedFetch(`/api/sessions/${credential!.id}/export.xlsx`, {
          headers: sessionHeaders(credential!),
        });
      if (!response.ok) await readResponse(response);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `CONCILIACAO_${result?.period ?? "RESULTADO"}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exception) {
      setError(messageOf(exception));
    } finally {
      setBusy(false);
    }
  }


  async function closeSession(): Promise<void> {
    if (credential) {
      await authenticatedFetch(`/api/sessions/${credential.id}/close`, {
        method: "POST",
        headers: sessionHeaders(credential),
        keepalive: true,
      }).catch(() => undefined);
    }
    setCredential(null);
    setSession(null);
    setResult(null);
    setPreflight(null);
    setLedgerFile(null);
    setStatementFiles([]);
    setStage("WELCOME");
    setError("");
    setHistoryRecordId(null);
    void reloadHistory();
  }

  async function openHistory(id: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/reconciliation-history/${id}`, { cache: "no-store" });
      const body = await readResponse<{ record: { result: ProcessingResult } }>(response);
      setHistoryRecordId(id);
      setResult(body.record.result);
      setCredential(null);
      setStage("RESULTS");
      setView("RECONCILIATION");
    } catch (exception) {
      setError(messageOf(exception));
    } finally {
      setBusy(false);
    }
  }

  async function deleteHistory(id: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/reconciliation-history/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Não foi possível excluir o registro do histórico.");
      }
      if (historyRecordId === id) {
        await closeSession();
      } else {
        await reloadHistory();
      }
      return true;
    } catch (exception) {
      setError(messageOf(exception));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? companies[0];

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="brand"
          onClick={() => void closeSession()}
          title="Ir para o painel inicial do Concilia"
          aria-label="Ir para a tela inicial do Concilia"
        >
          <div className="brand-mark">C</div>
          <div>
            <h1>Concilia</h1>
            <p>Razão Protheus × Extratos Bancários</p>
          </div>
        </button>

        {/* Central Top Navigation */}
        <nav className="topbar-nav" aria-label="Navegação Principal">
          <button
            type="button"
            className={`topbar-nav-btn ${view === "RECONCILIATION" ? "active" : ""}`}
            onClick={() => {
              setView("RECONCILIATION");
              if (stage !== "WELCOME") {
                void closeSession();
              }
            }}
          >
            Conciliação
          </button>
          <button
            type="button"
            className={`topbar-nav-btn ${view === "HISTORY" ? "active" : ""}`}
            onClick={() => setView("HISTORY")}
          >
            Histórico
          </button>
          <button
            type="button"
            className={`topbar-nav-btn ${view === "COMPANIES_ACCOUNTS" ? "active" : ""}`}
            onClick={() => setView("COMPANIES_ACCOUNTS")}
          >
            Empresas & Contas
          </button>
          {isAdmin && (
            <button
              type="button"
              className={`topbar-nav-btn ${view === "USERS" ? "active" : ""}`}
              onClick={() => setView("USERS")}
            >
              Usuários
            </button>
          )}
        </nav>

        <div className="topbar-actions">
          {selectedCompany && (
            <div className="company-badge">
              <span className="label">Empresa:</span>
              <strong>{selectedCompany.name}</strong>
            </div>
          )}
          <div className="user-identity-badge">
            <span className="user-identity-avatar">{userEmail.slice(0, 2).toUpperCase()}</span>
            <span>{userEmail}</span>
            {isAdmin && <span className="badge badge-primary">Admin</span>}
          </div>
          <button className="topbar-button" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>

      <main className="shell">
        {/* VIEW 1: CONCILIAÇÃO OPERACIONAL */}
        {view === "RECONCILIATION" && (
          <>
            {stage === "WELCOME" && (
              <WelcomeDashboard
                companies={companies}
                selectedCompanyId={selectedCompanyId}
                setSelectedCompanyId={setSelectedCompanyId}
                history={history}
                openHistory={openHistory}
                onDeleteHistory={deleteHistory}
                onStartNew={begin}
                busy={busy}
              />
            )}

            {stage !== "WELCOME" && <Stepper stage={stage} />}

            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}

            {stage === "FILES" && (
              <FileStep
                selectedCompany={selectedCompany}
                ledgerFile={ledgerFile}
                setLedgerFile={setLedgerFile}
                statementFiles={statementFiles}
                setStatementFiles={setStatementFiles}
                valueTolerance={valueTolerance}
                setValueTolerance={setValueTolerance}
                dateToleranceDays={dateToleranceDays}
                setDateToleranceDays={setDateToleranceDays}
                submit={uploadAndAnalyze}
                onBack={() => void closeSession()}
                busy={busy}
              />
            )}

            {stage === "PREFLIGHT" && (
              <Progress
                title="Analisando os arquivos"
                message={preflightStatusText}
                progress={preflightProgress}
                activeStep={preflightActiveStep}
              />
            )}

            {stage === "CONFIRM" && preflight && (
              <Confirmation
                preflight={preflight}
                company={company}
                setCompany={setCompany}
                branch={branch}
                setBranch={setBranch}
                period={period}
                setPeriod={setPeriod}
                statementMappings={statementMappings}
                setStatementMappings={setStatementMappings}
                linkedPhysicalStatementIds={linkedPhysicalStatementIds}
                setLinkedPhysicalStatementIds={setLinkedPhysicalStatementIds}
                valueTolerance={valueTolerance}
                setValueTolerance={setValueTolerance}
                dateToleranceDays={dateToleranceDays}
                setDateToleranceDays={setDateToleranceDays}
                submit={confirmAndProcess}
                onBack={() => setStage("FILES")}
                busy={busy}
              />
            )}

            {stage === "PROCESSING" && (
              <Progress
                title="Executando a conciliação"
                message={session?.progressMessage ?? "Aplicando regras de conciliação."}
                progress={session?.progress ?? 65}
                activeStep="MAPPING"
              />
            )}

            {stage === "RESULTS" && result && (
              <Results
                result={result}
                visible={visibleResults}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                search={search}
                setSearch={setSearch}
                selected={selected}
                setSelected={setSelected}
                download={download}
                close={closeSession}
                busy={busy}
                historyRecordId={historyRecordId}
                onDeleteHistory={deleteHistory}
              />
            )}
          </>
        )}

        {/* VIEW 2: HISTÓRICO */}
        {view === "HISTORY" && (
          <HistoryFullPanel
            history={history}
            openHistory={openHistory}
            onDeleteHistory={deleteHistory}
            onStartNew={() => {
              setView("RECONCILIATION");
              setStage("FILES");
            }}
            authenticatedFetch={authenticatedFetch}
          />
        )}

        {/* VIEW 3: EMPRESAS & CONTAS */}
        {view === "COMPANIES_ACCOUNTS" && (
          <CompaniesAccountsPanel
            companies={companies}
            selectedCompanyId={selectedCompanyId}
            onCompanySelect={setSelectedCompanyId}
            onRefreshCompanies={reloadCompanies}
            authenticatedFetch={authenticatedFetch}
          />
        )}

        {/* VIEW 4: USUÁRIOS */}
        {view === "USERS" && isAdmin && (
          <AdminUsersPanel
            companies={companies}
            currentUserEmail={userEmail}
            authenticatedFetch={authenticatedFetch}
          />
        )}
      </main>

      {/* Modal de criação de empresa */}
      <CompanyModal
        isOpen={isCompanyModalOpen}
        onClose={() => setIsCompanyModalOpen(false)}
        onCreated={handleCompanyCreated}
        authenticatedFetch={authenticatedFetch}
      />

      {/* Gaveta de inspeção de evidência */}
      <EvidenceDrawer selected={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function WelcomeDashboard({
  companies,
  selectedCompanyId,
  setSelectedCompanyId,
  history,
  openHistory,
  onDeleteHistory,
  onStartNew,
  busy,
}: {
  companies: AuthorizedCompany[];
  selectedCompanyId: string;
  setSelectedCompanyId: (value: string) => void;
  history: HistoryItem[];
  openHistory: (id: string) => void;
  onDeleteHistory?: (id: string) => Promise<boolean>;
  onStartNew: () => void;
  busy: boolean;
}) {
  const [confirmDeleteDashboardId, setConfirmDeleteDashboardId] = useState<string | null>(null);
  const [deletingDashboardId, setDeletingDashboardId] = useState<string | null>(null);
  const preparerCompanies = companies.filter(canPrepare);
  const pendingCount = history.filter((h) => h.status === "COMPLETED_WITH_ISSUES").length;

  return (
    <>
      {/* Header Operacional com Seletor e Ação Principal */}
      <div className="operational-dashboard-head">
        <div className="operational-head-title">
          <h2>Conciliação</h2>
          <p className="text-muted text-sm">Painel operacional para conferência contábil e bancária.</p>
        </div>

        <div className="operational-head-actions">
          <div className="company-select-inline">
            <label htmlFor="company-quick-select">Empresa atual:</label>
            <select
              id="company-quick-select"
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              disabled={preparerCompanies.length === 0}
            >
              {preparerCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="button"
            disabled={busy || !selectedCompanyId}
            onClick={onStartNew}
          >
            Nova conciliação
          </button>
        </div>
      </div>

      {/* 4 Cards Obrigatórios de Métricas */}
      <div className="metrics-banner">
        <div className="metric-card">
          <span className="metric-title">Empresas</span>
          <strong className="metric-number">{companies.length}</strong>
          <span className="metric-desc">Cadastradas no sistema</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Conciliações</span>
          <strong className="metric-number">{history.length}</strong>
          <span className="metric-desc">Total no histórico</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Com pendências</span>
          <strong className="metric-number" style={{ color: pendingCount > 0 ? "var(--warning)" : "inherit" }}>
            {pendingCount}
          </strong>
          <span className="metric-desc">Requerem revisão contábil</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Retenção</span>
          <strong className="metric-number">365 dias</strong>
          <span className="metric-desc">Histórico e relatórios</span>
        </div>
      </div>

      {/* Grid: Últimos Processamentos e Regras Aplicadas */}
      <div className="dashboard-grid-2col">
        {/* Bloco: Últimos processamentos */}
        <section className="card panel">
          <div className="panel-header">
            <div>
              <h3>Últimos processamentos</h3>
              <p>Histórico recente de conciliações executadas.</p>
            </div>
          </div>

          {history.length > 0 ? (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Competência</th>
                    <th>Status</th>
                    <th>Data</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 5).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.companyName}</strong>
                      </td>
                      <td>{formatPeriod(item.period)}</td>
                      <td>
                        <span
                          className={`status-pill ${item.status === "COMPLETED" ? "status-active" : "status-inactive"}`}
                        >
                          {item.status === "COMPLETED" ? "Concluída" : "Com Pendências"}
                        </span>
                      </td>
                      <td className="text-muted text-sm">
                        {new Date(item.completedAt).toLocaleDateString("pt-BR")}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px", alignItems: "center", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="button secondary btn-sm"
                            onClick={() => openHistory(item.id)}
                          >
                            Ver resultado
                          </button>
                          {confirmDeleteDashboardId === item.id ? (
                            <>
                              <button
                                type="button"
                                className="button danger btn-sm"
                                disabled={deletingDashboardId === item.id}
                                onClick={async () => {
                                  if (onDeleteHistory) {
                                    setDeletingDashboardId(item.id);
                                    await onDeleteHistory(item.id);
                                    setDeletingDashboardId(null);
                                    setConfirmDeleteDashboardId(null);
                                  }
                                }}
                              >
                                {deletingDashboardId === item.id ? "Excluindo..." : "Confirmar"}
                              </button>
                              <button
                                type="button"
                                className="button secondary btn-sm"
                                disabled={deletingDashboardId === item.id}
                                onClick={() => setConfirmDeleteDashboardId(null)}
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="button secondary btn-sm"
                              style={{ color: "var(--danger)" }}
                              onClick={() => setConfirmDeleteDashboardId(item.id)}
                              title="Excluir este resultado do histórico"
                            >
                              Excluir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-empty">Nenhum processamento recente.</div>
          )}
        </section>

        {/* Bloco: Regras aplicadas no processamento */}
        <section className="card panel">
          <div className="panel-header">
            <div>
              <h3>Regras aplicadas no processamento</h3>
              <p>Parâmetros automáticos de cruzamento.</p>
            </div>
          </div>

          <div className="rules-list">
            <div className="rule-item">
              <span className="rule-label">Tolerância de valor</span>
              <span className="rule-value">R$ 0,01 por padrão</span>
            </div>
            <div className="rule-item">
              <span className="rule-label">Tolerância de data</span>
              <span className="rule-value">Até 3 dias</span>
            </div>
            <div className="rule-item">
              <span className="rule-label">Comparação</span>
              <span className="rule-value">Exatos, proximidade, grupos e total diário</span>
            </div>
            <div className="rule-item">
              <span className="rule-label">Saída</span>
              <span className="rule-value">Relatório XLSX auditável e evidências</span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function HistoryFullPanel({
  history,
  openHistory,
  onDeleteHistory,
  onStartNew,
  authenticatedFetch,
}: {
  history: HistoryItem[];
  openHistory: (id: string) => void;
  onDeleteHistory?: (id: string) => Promise<boolean>;
  onStartNew: () => void;
  authenticatedFetch: AuthenticatedFetch;
}) {
  const [search, setSearch] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState<"ALL" | "COMPLETED" | "COMPLETED_WITH_ISSUES">("ALL");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Lista única de empresas no histórico
  const companiesInHistory = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of history) map.set(h.companyId, h.companyName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [history]);

  const filtered = useMemo(() => {
    return history.filter((item) => {
      const matchesSearch =
        !search ||
        item.companyName.toLowerCase().includes(search.toLowerCase()) ||
        item.period.toLowerCase().includes(search.toLowerCase());
      const matchesCompany = selectedCompany === "ALL" || item.companyId === selectedCompany;
      const matchesStatus = selectedStatus === "ALL" || item.status === selectedStatus;
      return matchesSearch && matchesCompany && matchesStatus;
    });
  }, [history, search, selectedCompany, selectedStatus]);

  const pendingCount = filtered.filter((h) => h.status === "COMPLETED_WITH_ISSUES").length;
  const lastExecution = filtered[0]?.completedAt
    ? new Date(filtered[0].completedAt).toLocaleDateString("pt-BR")
    : "—";

  async function handleDownloadXlsx(id: string, period: string) {
    setDownloadingId(id);
    try {
      const response = await authenticatedFetch(`/api/reconciliation-history/${id}/export.xlsx`);
      if (!response.ok) throw new Error("Erro ao baixar arquivo");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `CONCILIACAO_${period || "RESULTADO"}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      // Ignore
    } finally {
      setDownloadingId(null);
    }
  }


  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Histórico</h2>
          <p>Consulte conciliações anteriores e baixe os relatórios XLSX gerados.</p>
        </div>
        <button type="button" className="button" onClick={onStartNew}>
          Nova conciliação
        </button>
      </div>

      {/* Cards de resumo */}
      <div className="metrics-banner" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="metric-card">
          <span className="metric-title">Registros</span>
          <strong className="metric-number">{filtered.length}</strong>
          <span className="metric-desc">Conciliações filtradas</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Pendentes</span>
          <strong className="metric-number" style={{ color: pendingCount > 0 ? "var(--warning)" : "inherit" }}>
            {pendingCount}
          </strong>
          <span className="metric-desc">Com divergências</span>
        </div>
        <div className="metric-card">
          <span className="metric-title">Última carga</span>
          <strong className="metric-number" style={{ fontSize: "20px" }}>
            {lastExecution}
          </strong>
          <span className="metric-desc">Data mais recente</span>
        </div>
      </div>

      <div className="card panel">
        {/* Filtros Operacionais */}
        <div className="table-controls" style={{ flexWrap: "wrap", gap: "10px" }}>
          <input
            type="search"
            className="search-input"
            style={{ maxWidth: "320px" }}
            placeholder="Buscar por empresa ou competência..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              className="field select"
              style={{ width: "auto", height: "38px", margin: 0 }}
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
            >
              <option value="ALL">Todas as empresas</option>
              {companiesInHistory.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              className="field select"
              style={{ width: "auto", height: "38px", margin: 0 }}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
            >
              <option value="ALL">Todos os status</option>
              <option value="COMPLETED">Concluída</option>
              <option value="COMPLETED_WITH_ISSUES">Com pendências</option>
            </select>
          </div>

          <span className="table-counter">{filtered.length} registros</span>
        </div>

        {filtered.length === 0 ? (
          <div className="table-empty">Nenhuma conciliação encontrada com os filtros informados.</div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Competência</th>
                  <th>Status</th>
                  <th>Concluído em</th>
                  <th>Retenção até</th>
                  <th>Resultado</th>
                  <th>Relatório</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.companyName}</strong>
                    </td>
                    <td>{formatPeriod(item.period)}</td>
                    <td>
                      <span
                        className={`status-pill ${item.status === "COMPLETED" ? "status-active" : "status-inactive"}`}
                      >
                        {item.status === "COMPLETED" ? "Concluída" : "Com Pendências"}
                      </span>
                    </td>
                    <td>
                      {new Date(item.completedAt).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="text-muted">{new Date(item.expiresAt).toLocaleDateString("pt-BR")}</td>
                    <td>
                      <button
                        type="button"
                        className="button secondary btn-sm"
                        onClick={() => openHistory(item.id)}
                      >
                        Ver resultado
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button secondary btn-sm"
                        disabled={downloadingId === item.id}
                        onClick={() => handleDownloadXlsx(item.id, item.period)}
                      >
                        {downloadingId === item.id ? "Baixando..." : "Baixar XLSX"}
                      </button>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {confirmDeleteId === item.id ? (
                        <div style={{ display: "inline-flex", gap: "6px", alignItems: "center", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="button danger btn-sm"
                            disabled={deletingId === item.id}
                            onClick={async () => {
                              if (onDeleteHistory) {
                                setDeletingId(item.id);
                                const ok = await onDeleteHistory(item.id);
                                setDeletingId(null);
                                if (ok) setConfirmDeleteId(null);
                              }
                            }}
                          >
                            {deletingId === item.id ? "Excluindo..." : "Confirmar"}
                          </button>
                          <button
                            type="button"
                            className="button secondary btn-sm"
                            disabled={deletingId === item.id}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="button secondary btn-sm"
                          style={{ color: "var(--danger)" }}
                          onClick={() => setConfirmDeleteId(item.id)}
                          title="Excluir este resultado do histórico"
                        >
                          Excluir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function canPrepare(company: AuthorizedCompany): boolean {
  return company.roles.some((role) => role === "PREPARER" || role === "ADMIN");
}

function Stepper({ stage }: { stage: Stage }) {
  const order: Array<{ stage: Stage; label: string }> = [
    { stage: "FILES", label: "Arquivos" },
    { stage: "PREFLIGHT", label: "Pré-análise" },
    { stage: "CONFIRM", label: "Confirmação" },
    { stage: "PROCESSING", label: "Processamento" },
    { stage: "RESULTS", label: "Resultado" },
  ];
  const current = order.findIndex((item) => item.stage === stage);
  return (
    <nav className="stepper" aria-label="Etapas">
      {order.map((item, index) => (
        <div
          className={`step ${index === current ? "active" : ""} ${index < current ? "done" : ""}`}
          key={item.stage}
        >
          <span className="step-number">{index < current ? "✓" : index + 1}</span>
          {item.label}
        </div>
      ))}
    </nav>
  );
}

function FileStep(props: {
  selectedCompany?: AuthorizedCompany | undefined;
  ledgerFile: File | null;
  setLedgerFile: (file: File | null) => void;
  statementFiles: File[];
  setStatementFiles: (files: File[]) => void;
  valueTolerance: string;
  setValueTolerance: (value: string) => void;
  dateToleranceDays: string;
  setDateToleranceDays: (value: string) => void;
  submit: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const valid = Boolean(
    props.ledgerFile &&
    props.statementFiles.length > 0 &&
    props.statementFiles.length <= 5 &&
    props.valueTolerance !== "" &&
    props.dateToleranceDays !== "",
  );

  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <h2>Nova conciliação</h2>
          <p>
            {props.selectedCompany ? `Empresa: ${props.selectedCompany.name}` : "Selecione os arquivos para cruzamento."}
          </p>
        </div>
        <button
          type="button"
          className="button secondary btn-sm"
          onClick={props.onBack}
          disabled={props.busy}
        >
          ← Voltar ao início
        </button>
      </div>

      <div className="upload-grid">
        <UploadBox
          title="Razão Protheus"
          hint="CSV, XLSX, XLS ou XLSM"
          buttonText="Selecionar razão"
          accept=".csv,.xlsx,.xls,.xlsm"
          multiple={false}
          files={props.ledgerFile ? [props.ledgerFile] : []}
          onFiles={(files) => props.setLedgerFile(files[0] ?? null)}
        />

        <UploadBox
          title="Extratos bancários"
          hint="CSV, XLSX, XLS, XLSM, OFX ou PDF · Até 5 arquivos"
          buttonText="Selecionar extratos"
          accept=".csv,.xlsx,.xls,.xlsm,.ofx,.pdf"
          multiple
          files={props.statementFiles}
          onFiles={(files) => props.setStatementFiles(files.slice(0, 5))}
        />
      </div>

      <div className="form-grid" style={{ marginTop: "20px" }}>
        <label className="field">
          Tolerância de valor (R$)
          <input
            min="0"
            step="0.01"
            inputMode="decimal"
            value={props.valueTolerance}
            onChange={(event) => props.setValueTolerance(event.target.value)}
            placeholder="Ex.: 0,01"
          />
        </label>

        <label className="field">
          Tolerância de data (dias)
          <input
            min="0"
            max="3"
            step="1"
            inputMode="numeric"
            value={props.dateToleranceDays}
            onChange={(event) => props.setDateToleranceDays(event.target.value)}
          />
        </label>
      </div>

      <div className="notice info" style={{ marginTop: "16px" }}>
        Somente lançamentos da conta contábil vinculada ao extrato serão conciliados.
      </div>

      <div className="actions" style={{ marginTop: "24px" }}>
        <button
          type="button"
          className="button secondary"
          onClick={props.onBack}
          disabled={props.busy}
        >
          Voltar
        </button>
        <button className="button" disabled={!valid || props.busy} onClick={props.submit}>
          {props.busy ? "Enviando…" : "Analisar arquivos"}
        </button>
      </div>
    </section>
  );
}

function UploadBox({
  title,
  hint,
  buttonText,
  accept,
  multiple,
  files,
  onFiles,
}: {
  title: string;
  hint: string;
  buttonText: string;
  accept: string;
  multiple: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleRemove = (index: number) => {
    const next = [...files];
    next.splice(index, 1);
    onFiles(next);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(event.target.files ?? []);
    if (multiple) {
      onFiles([...files, ...newFiles]);
    } else {
      onFiles(newFiles);
    }
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (multiple) {
      onFiles([...files, ...droppedFiles]);
    } else if (droppedFiles.length > 0) {
      onFiles([droppedFiles[0]!]);
    }
  };

  return (
    <div
      className={`dropzone ${isDragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className="dropzone-icon">📄</div>
      <h3>{title}</h3>
      <p>{hint}</p>

      <button
        type="button"
        className="dropzone-select-btn"
        onClick={() => inputRef.current?.click()}
      >
        {buttonText}
      </button>

      <input
        ref={inputRef}
        className="file-input-hidden"
        aria-label={title}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
      />

      {files.length > 0 && (
        <div className="file-list">
          {files.map((file, i) => (
            <div className="file-item" key={`${file.name}-${file.size}-${i}`}>
              <span className="file-item-name">{file.name}</span>
              <span className="file-item-size">{formatSize(file.size)}</span>
              <button
                type="button"
                className="button danger btn-sm"
                style={{ marginLeft: "8px", padding: "2px 6px" }}
                onClick={() => handleRemove(i)}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Progress({
  title,
  message,
  progress,
  activeStep = "UPLOAD",
}: {
  title: string;
  message: string;
  progress: number;
  activeStep?: "UPLOAD" | "PARSING" | "MAPPING";
}) {
  const [animatedProgress, setAnimatedProgress] = useState(progress);

  useEffect(() => {
    setAnimatedProgress(progress);
  }, [progress]);

  // Micro-incremento suave em etapas demoradas para evitar a sensação de barra parada
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimatedProgress((prev) => {
        if (prev < progress + 4 && prev < 98) {
          return prev + 1;
        }
        return prev;
      });
    }, 700);
    return () => clearInterval(interval);
  }, [progress]);

  return (
    <section className="card progress-wrap">
      <div className="progress-header-icon">
        <span className="spinner spinner-lg" />
      </div>
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="progress" aria-label={`${animatedProgress}%`}>
        <span style={{ width: `${animatedProgress}%` }} />
      </div>
      <div className="progress-info">
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="pulse-dot" />
          <span>Processamento ativo</span>
        </span>
        <strong>{animatedProgress}%</strong>
      </div>

      <div className="progress-steps-list">
        <div
          className={`progress-step-card ${activeStep === "UPLOAD" ? "active" : activeStep === "PARSING" || activeStep === "MAPPING" ? "done" : ""
            }`}
        >
          <span>{activeStep === "PARSING" || activeStep === "MAPPING" ? "✓" : "1."}</span>
          <span>Envio de arquivos</span>
        </div>
        <div
          className={`progress-step-card ${activeStep === "PARSING" ? "active" : activeStep === "MAPPING" ? "done" : ""
            }`}
        >
          <span>{activeStep === "MAPPING" ? "✓" : "2."}</span>
          <span>Leitura & Leiautes</span>
        </div>
        <div className={`progress-step-card ${activeStep === "MAPPING" ? "active" : ""}`}>
          <span>3.</span>
          <span>Vínculo de contas</span>
        </div>
      </div>
    </section>
  );
}

function Confirmation(props: {
  preflight: PreflightResult;
  company: string;
  setCompany: (value: string) => void;
  branch: string;
  setBranch: (value: string) => void;
  period: string;
  setPeriod: (value: string) => void;
  statementMappings: Record<string, string>;
  setStatementMappings: (value: Record<string, string>) => void;
  linkedPhysicalStatementIds: Record<string, boolean>;
  setLinkedPhysicalStatementIds: (value: Record<string, boolean>) => void;
  valueTolerance: string;
  setValueTolerance: (value: string) => void;
  dateToleranceDays: string;
  setDateToleranceDays: (value: string) => void;
  submit: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const currentAccountStatements = props.preflight.statements.filter((item) => item.reconciliationEligible);
  const investmentStatements = props.preflight.statements.filter((item) => !item.reconciliationEligible);
  const blocked = props.preflight.issues.some((item) => item.severity === "ERROR");
  const mappedStatementCount = confirmedMappings(props.preflight, props.statementMappings, props.linkedPhysicalStatementIds).reduce(
    (acc, m) => acc + m.statementFileIds.length,
    0,
  );
  const mappingsComplete = mappedStatementCount === currentAccountStatements.length;
  const identityMappingsConfirmed = confirmedIdentityMappings(props.preflight, props.statementMappings, props.linkedPhysicalStatementIds);
  const hasPartialIdentity = partialIdentityMappings(props.preflight, props.statementMappings);

  const isAutoMatched =
    mappingsComplete && identityMappingsConfirmed && props.period !== "" && currentAccountStatements.length > 0 && !blocked && !Object.values(props.linkedPhysicalStatementIds).some(Boolean);

  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <h2>Confirmação e Pré-Análise</h2>
          <p>Verifique o vínculo identificado entre os extratos bancários e as contas do razão.</p>
        </div>
        <button
          type="button"
          className="button secondary btn-sm"
          onClick={props.onBack}
          disabled={props.busy}
        >
          ← Voltar aos arquivos
        </button>
      </div>

      {/* Card de Auto-Match Instantâneo */}
      {isAutoMatched && (
        <div className="auto-match-card">
          <div className="auto-match-header">
            <div>
              <strong style={{ fontSize: "15px", color: "var(--success)" }}>
                Vínculo Automático Identificado
              </strong>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                Contas e competência identificadas com precisão.
              </div>
            </div>
            <span className="auto-match-badge">100% Identificado</span>
          </div>

          <div className="auto-match-items">
            <div className="auto-match-item">
              <span className="auto-match-label">Competência</span>
              <span className="auto-match-value">{formatPeriod(props.period)}</span>
            </div>
            <div className="auto-match-item">
              <span className="auto-match-label">Contas Contábeis</span>
              <span className="auto-match-value">
                {props.preflight.ledgerAccounts.map((a) => a.account).join(", ") || "—"}
              </span>
            </div>
            <div className="auto-match-item">
              <span className="auto-match-label">Extratos Vinculados</span>
              <span className="auto-match-value">
                {currentAccountStatements.length} arquivo(s)
              </span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              type="button"
              className="button secondary btn-sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "Ocultar Parâmetros" : "Ajustar Parâmetros"}
            </button>

            <button
              type="button"
              className="button"
              disabled={props.busy || blocked || !mappingsComplete || !identityMappingsConfirmed}
              onClick={props.submit}
            >
              {props.busy ? "Iniciando conciliação…" : "Iniciar conciliação expressa"}
            </button>
          </div>
        </div>
      )}

      {/* Grid de Métricas Detectadas */}
      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Metric label="Empresas detectadas" value={props.preflight.companies.length || "—"} />
        <Metric label="Contas contábeis" value={props.preflight.ledgerAccounts.length} />
        <Metric label="Extratos de conta" value={currentAccountStatements.length} />
        <Metric label="Documentos de investimento" value={investmentStatements.length} />
      </div>

      {mappingsComplete && !identityMappingsConfirmed && (
        <div className="notice error" role="alert">
          Confirme cada conta física divergente como parte do mesmo escopo lógico ou escolha outra conta contábil.
        </div>
      )}

      {mappingsComplete && identityMappingsConfirmed && hasPartialIdentity && (
        <div className="notice warning" role="status">
          Alguns dados bancários não foram encontrados. O relacionamento selecionado manualmente será usado nesta execução.
        </div>
      )}

      {props.preflight.issues.map((item, index) => (
        <div
          className={`notice ${item.severity === "ERROR" ? "error" : "warning"}`}
          key={`${item.code}-${index}`}
        >
          <strong>{issueCategoryLabel(item.code, item.severity)}</strong> — {item.message}
        </div>
      ))}

      <div className="form-grid" style={{ marginTop: "20px" }}>
        <label className="field">
          Empresa
          <input
            value={props.company}
            onChange={(event) => props.setCompany(event.target.value)}
            placeholder="Informe se não detectada"
          />
        </label>

        <label className="field">
          Filial
          <input
            value={props.branch}
            onChange={(event) => props.setBranch(event.target.value)}
            placeholder="Opcional"
          />
        </label>

        <label className="field">
          Competência
          <select value={props.period} onChange={(event) => props.setPeriod(event.target.value)}>
            <option value="">Selecione</option>
            {props.preflight.detectedPeriods.map((item) => (
              <option key={item.period} value={item.period}>
                {formatPeriod(item.period)} · {item.recordCount} registros
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3 style={{ marginTop: "24px", fontSize: "15px" }}>Vínculo dos Extratos Bancários</h3>
      {currentAccountStatements.map((statement) => {
        const selectedLedger = props.preflight.ledgerAccounts.find((item) => item.account === props.statementMappings[statement.fileId]);
        const identity = selectedLedger ? compareBankAccountIdentities(selectedLedger, statement) : undefined;
        const requiresLinkedConfirmation = identity?.status === "CONFLICT";
        const identityComplete = Boolean(statement.bank && statement.agency && statement.account);
        return (
        <div className="rule-item" style={{ marginBottom: "8px" }} key={statement.fileId}>
          <div>
            <strong>{statement.originalName}</strong>
            <div className="text-muted text-sm">
              {[bankLabel(statement.bank), statement.agency, statement.account].filter(Boolean).join(" · ") ||
                "Conta não identificada"}
            </div>
          </div>
          <label className="field" style={{ margin: 0, minWidth: "260px" }}>
            <span className="sr-only">Conta contábil para {statement.originalName}</span>
            <select
              aria-label={`Conta contábil para ${statement.originalName}`}
              value={props.statementMappings[statement.fileId] ?? ""}
              onChange={(event) => {
                props.setStatementMappings({
                  ...props.statementMappings,
                  [statement.fileId]: event.target.value,
                });
              }}
            >
              <option value="">Selecione a conta contábil</option>
              {props.preflight.ledgerAccounts.map((account) => (
                <option key={`${account.company}-${account.branch}-${account.account}`} value={account.account}>
                  {account.account} ·{" "}
                  {[bankLabel(account.bank), account.agency, account.bankAccount].filter(Boolean).join("/") ||
                    "conta bancária não identificada"}
                </option>
              ))}
            </select>
          </label>
          {requiresLinkedConfirmation && (
            <label className="field" style={{ margin: "8px 0 0", gridColumn: "1 / -1", fontSize: "13px" }}>
              <span style={{ display: "flex", alignItems: "start", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={Boolean(props.linkedPhysicalStatementIds[statement.fileId])}
                  disabled={!identityComplete}
                  onChange={(event) => props.setLinkedPhysicalStatementIds({
                    ...props.linkedPhysicalStatementIds,
                    [statement.fileId]: event.target.checked,
                  })}
                />
                <span>
                  Confirmo que {bankLabel(statement.bank)} / {statement.agency} / {statement.account} é uma conta física vinculada ao mesmo escopo lógico desta conta contábil nesta execução.
                  {!identityComplete && " A identidade completa da conta é obrigatória para essa confirmação."}
                </span>
              </span>
            </label>
          )}
        </div>
        );
      })}

      {investmentStatements.length > 0 && (
        <>
          <h3 style={{ marginTop: "20px", fontSize: "15px" }}>Investimentos para Conferência</h3>
          <div className="notice info">
            Estes documentos são informativos e não participam da conciliação de conta corrente.
          </div>
          {investmentStatements.map((statement) => (
            <div className="rule-item" style={{ marginBottom: "8px" }} key={statement.fileId}>
              <div>
                <strong>{statement.originalName}</strong>
                <div className="text-muted text-sm">
                  {[bankLabel(statement.bank), statement.agency, statement.account]
                    .filter(Boolean)
                    .join(" · ") || "Conta não identificada"}
                </div>
              </div>
              <span className="badge badge-secondary">{documentKindLabel(statement.classification)}</span>
            </div>
          ))}
        </>
      )}

      <div className="actions" style={{ marginTop: "24px" }}>
        <button
          type="button"
          className="button secondary"
          onClick={props.onBack}
          disabled={props.busy}
        >
          Voltar aos arquivos
        </button>
        <button
          className="button"
          disabled={props.busy || blocked || !mappingsComplete || !identityMappingsConfirmed}
          onClick={props.submit}
        >
          {props.busy ? "Processando…" : "Confirmar e conciliar"}
        </button>
      </div>
    </section>
  );
}

function Results(props: {
  result: ProcessingResult;
  visible: ReconciliationResult[];
  activeTab: string;
  setActiveTab: (value: (typeof tabs)[number]["id"]) => void;
  search: string;
  setSearch: (value: string) => void;
  selected: ReconciliationResult | null;
  setSelected: (value: ReconciliationResult | null) => void;
  download: () => void;
  close: () => void;
  busy: boolean;
  historyRecordId?: string | null;
  onDeleteHistory?: (id: string) => Promise<boolean>;
}) {
  const [visibleCount, setVisibleCount] = useState(25);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setVisibleCount(25);
  }, [props.activeTab, props.search]);

  const controls = props.result.controls;
  const countByStatus = (status: ReconciliationResult["status"]): string =>
    controls?.countsByStatus.find((item) => item.status === status)?.count ?? "0";
  const totals = props.result.summaries.reduce(
    (sum, item) => ({
      reconciled: sum.reconciled + item.reconciledCount,
      divergences: sum.divergences + item.divergenceCount,
      missing: sum.missing + item.ledgerWithoutStatementCount + item.statementWithoutLedgerCount,
      difference: sum.difference + Number(item.balanceDifference),
    }),
    { reconciled: 0, divergences: 0, missing: 0, difference: 0 },
  );

  return (
    <>
      <section className="card panel">
        <div className="results-head">
          <div>
            <span className="eyebrow">Resultado da conciliação</span>
            <h2>
              {props.result.company} · {formatPeriod(props.result.period)}
            </h2>
          </div>
          <div className="actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button className="button" disabled={props.busy || deleting} onClick={props.download}>
              Baixar XLSX
            </button>
            {props.historyRecordId && (
              confirmDelete ? (
                <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                  <button
                    type="button"
                    className="button danger"
                    disabled={props.busy || deleting}
                    onClick={async () => {
                      if (props.onDeleteHistory && props.historyRecordId) {
                        setDeleting(true);
                        await props.onDeleteHistory(props.historyRecordId);
                        setDeleting(false);
                        setConfirmDelete(false);
                      }
                    }}
                  >
                    {deleting ? "Excluindo..." : "Confirmar exclusão"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={props.busy || deleting}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button danger"
                  disabled={props.busy || deleting}
                  onClick={() => setConfirmDelete(true)}
                >
                  Excluir do histórico
                </button>
              )
            )}
            <button className="button secondary" disabled={deleting} onClick={props.close}>
              Nova conciliação
            </button>
          </div>
        </div>

        {/* Cards de Indicadores */}
        {controls ? (
          <div className="summary-grid">
            <Metric
              label="Movimentação do banco (líquida)"
              value={formatCurrency(Number(controls.movements.bankConciliable))}
            />
            <Metric label="Movimentação do razão (líquida)" value={formatCurrency(Number(controls.movements.ledger))} />
            <Metric
              label="Diferença banco × razão"
              value={formatCurrency(Number(controls.movements.difference))}
            />
            <Metric
              label="Cobertura confirmada"
              value={`${controls.coverage.overallOperational?.lines.percentage ?? controls.coverage.lines.percentage}% (${controls.coverage.overallOperational?.lines.covered ?? controls.coverage.lines.covered}/${controls.coverage.overallOperational?.lines.total ?? controls.coverage.lines.total})`}
            />
            <Metric
              label="Cobertura potencial"
              value={
                controls.coverage.potential?.overallOperational
                  ? `${controls.coverage.potential.overallOperational.lines.percentage}% (${controls.coverage.potential.overallOperational.lines.covered}/${controls.coverage.potential.overallOperational.lines.total})`
                  : "Não disponível"
              }
            />
            <Metric
              label="Linhas em sugestões"
              value={
                controls.coverage.suggested?.overallOperational
                  ? `${controls.coverage.suggested.overallOperational.lines.covered} para revisão`
                  : "0"
              }
            />
            <Metric label="Ambiguidades por valor" value={countByStatus("AMBIGUOUS_MATCH")} />
            <Metric
              label="Cobertura do razão"
              value={
                controls.coverage.ledger
                  ? `${controls.coverage.ledger.lines.percentage}% (${controls.coverage.ledger.lines.covered}/${controls.coverage.ledger.lines.total})`
                  : `${controls.coverage.lines.percentage}%`
              }
            />
            <Metric
              label="Cobertura do extrato operacional"
              value={
                controls.coverage.statementOperational
                  ? `${controls.coverage.statementOperational.lines.percentage}% (${controls.coverage.statementOperational.lines.covered}/${controls.coverage.statementOperational.lines.total})`
                  : `${controls.coverage.lines.percentage}%`
              }
            />
            <Metric
              label="Cobertura do extrato total"
              value={
                controls.coverage.statementTotal
                  ? `${controls.coverage.statementTotal.lines.percentage}% (${controls.coverage.statementTotal.lines.covered}/${controls.coverage.statementTotal.lines.total})`
                  : `${controls.coverage.lines.percentage}%`
              }
            />
            <Metric
              label="Cobertura de valor operacional"
              value={`${controls.coverage.overallOperational?.absoluteValue.percentage ?? controls.coverage.absoluteValue.percentage}%`}
            />
            <Metric
              label="Diferença de saldo final"
              value={
                controls.balances.closingDifference === undefined
                  ? "Não disponível"
                  : formatCurrency(Number(controls.balances.closingDifference))
              }
            />
          </div>
        ) : (
          <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <Metric label="Conciliados automáticos" value={totals.reconciled} />
            <Metric label="Divergências" value={totals.divergences} />
            <Metric label="Pendências" value={totals.missing} />
            <Metric label="Diferença de saldo" value={formatCurrency(totals.difference)} />
          </div>
        )}
      </section>

      <section className="card panel" style={{ marginTop: 16 }}>
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              role="tab"
              aria-selected={props.activeTab === tab.id}
              className={`tab ${props.activeTab === tab.id ? "active" : ""}`}
              key={tab.id}
              onClick={() => props.setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {props.activeTab === "ARQUIVOS_ERROS" ? (
          <FilesAndErrors result={props.result} />
        ) : props.activeTab === "INVESTIMENTOS" ? (
          <Investments entries={props.result.investments} />
        ) : (
          <>
            <div className="table-tools">
              <input
                className="filter"
                value={props.search}
                onChange={(event) => props.setSearch(event.target.value)}
                placeholder="Filtrar por conta, documento, histórico ou valor..."
              />
            </div>

            {props.activeTab === "TOTAL_DIARIO" && (
              <div className="notice warning">
                O total diário comprova o fechamento do lote; não representa pareamento individual entre as linhas.
              </div>
            )}

            {props.activeTab === "SUGESTOES_GRUPOS" && (
              <div className="notice warning">
                Estas combinações fecham em centavos e foram agrupadas de forma determinística, mas não entram nos totais conciliados até a conferência manual.
              </div>
            )}

            {props.activeTab === "AMBIGUIDADES" && (
              <div className="notice warning">
                Cada grupo reúne todos os candidatos com o mesmo valor. A aplicação não escolhe nenhum par enquanto a evidência não tornar a decisão inequívoca.
              </div>
            )}

            <div className="table-wrap">
              {props.visible.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Linhas do Razão</th>
                      <th>Linhas do Extrato</th>
                      <th>Totais</th>
                      <th>Regra Aplicada</th>
                      <th style={{ textAlign: "right" }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.visible.slice(0, visibleCount).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span className={`status ${item.decisionLevel === "AUTOMATIC" ? "ok" : "problem"}`}>
                            {resultStatusLabel(item.status)}
                          </span>
                        </td>
                        <td>{groupLines(item.ledgers ?? (item.ledger ? [item.ledger] : []))}</td>
                        <td>{groupLines(item.statements ?? (item.statement ? [item.statement] : []))}</td>
                        <td>
                          {item.matchGroup
                            ? `${formatCurrency(Number(item.matchGroup.ledgerTotalCents) / 100)} × ${formatCurrency(Number(item.matchGroup.bankTotalCents) / 100)}`
                            : "—"}
                        </td>
                        <td>{reconciliationRuleLabel(item.rule)}</td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            id={`evidence-trigger-${item.id}`}
                            type="button"
                            className="button secondary btn-sm"
                            aria-controls={`evidence-${item.id}`}
                            aria-expanded={props.selected?.id === item.id}
                            onClick={() => props.setSelected(item)}
                          >
                            Ver evidência
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">Nenhum item nesta categoria.</div>
              )}
            </div>

            {props.visible.length > visibleCount && (
              <div className="actions" style={{ marginTop: "16px" }}>
                <button className="button secondary" onClick={() => setVisibleCount((count) => count + 25)}>
                  Mostrar mais registros ({props.visible.length - visibleCount} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {props.selected && <Evidence item={props.selected} close={() => props.setSelected(null)} />}
    </>
  );
}

function FilesAndErrors({ result }: { result: ProcessingResult }) {
  return (
    <div className="files-errors">
      <h3 style={{ fontSize: "15px", marginBottom: "12px" }}>Arquivos processados</h3>
      {result.files.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Banco</th>
                <th>Agência/conta</th>
                <th>Registros</th>
                <th>Método</th>
                <th>Leitor</th>
              </tr>
            </thead>
            <tbody>
              {result.files.map((file) => (
                <tr key={file.fileId}>
                  <td>{file.originalName}</td>
                  <td>{bankLabel(file.bank) || "—"}</td>
                  <td>{[file.agency, file.account].filter(Boolean).join("/") || "—"}</td>
                  <td>{file.recordCount}</td>
                  <td>{extractionMethodLabel(file.extractionMethod)}</td>
                  <td>{parserLabel(file.parser)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">Nenhum arquivo disponível.</div>
      )}
      <h3 style={{ marginTop: "24px", fontSize: "15px", marginBottom: "12px" }}>Alertas e rejeições</h3>
      {result.issues.length ? (
        result.issues.map((issue, index) => (
          <div
            className={`notice ${issue.severity === "ERROR" ? "error" : "warning"}`}
            key={`${issue.code}-${index}`}
          >
            <strong>{issueCategoryLabel(issue.code, issue.severity)}</strong> — {issue.message}
            {issue.sourcePosition ? ` · posição ${issue.sourcePosition}` : ""}
          </div>
        ))
      ) : (
        <div className="notice info">Nenhum alerta técnico nesta execução.</div>
      )}
    </div>
  );
}

function Investments({ entries }: { entries: InvestmentEntry[] }) {
  if (!entries.length) {
    return <div className="empty">Nenhum investimento detectado nos arquivos.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Banco / Origem</th>
            <th>Valor</th>
            <th>Descrição</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={`${entry.fileId}-${index}`}>
              <td>{investmentKindLabel(entry.kind)}</td>
              <td>
                {bankLabel(entry.bank)} ({entry.originalName})
              </td>
              <td>{formatCurrency(Number(entry.amount))}</td>
              <td>{entry.description}</td>
              <td>{formatDateForDisplay(entry.date) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Evidence({ item, close }: { item: ReconciliationResult; close: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    panel.current?.focus({ preventScroll: true });
  }, [item.id]);
  const ledgers = item.ledgers ?? (item.ledger ? [item.ledger] : []);
  const statements = item.statements ?? (item.statement ? [item.statement] : []);
  return (
    <section
      ref={panel}
      id={`evidence-${item.id}`}
      role="region"
      aria-label={`Evidência da conciliação ${item.id}`}
      tabIndex={-1}
      className="card panel"
      style={{ marginTop: 16, scrollMarginTop: 16 }}
    >
      <div className="panel-header">
        <div>
          <h3>Evidência · identificador técnico {item.id}</h3>
          <p>{item.reason}</p>
          {item.ambiguityGroup && (
            <p>
              Grupo de ambiguidade: {item.ambiguityGroup.ledgerCandidateIds.length} linha(s) do razão e {item.ambiguityGroup.statementCandidateIds.length} linha(s) do extrato com o valor {formatCurrency(Number(item.ambiguityGroup.amount))}.
            </p>
          )}
          {item.status === "AUTO_MATCH_DAILY_TOTAL" && (
            <p>Fechamento no nível do lote diário, sem pareamento individual.</p>
          )}
        </div>
        <button type="button" className="button secondary" onClick={close}>
          Fechar
        </button>
      </div>
      <div className="upload-grid">
        <div>
          {ledgers.map((record) => (
            <EvidenceSide key={record.id} title="Razão" record={record} />
          ))}
        </div>
        <div>
          {statements.map((record) => (
            <EvidenceSide key={record.id} title="Extrato" record={record} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EvidenceSide({
  title,
  record,
}: {
  title: string;
  record: ReconciliationResult["ledger"] | ReconciliationResult["statement"];
}) {
  return (
    <div className="metric" style={{ marginBottom: "8px" }}>
      <span className="label">{title}</span>
      {record ? (
        <>
          <strong>{record.value}</strong>
          <p style={{ margin: "2px 0" }}>
            {formatDateForDisplay(record.date)} · {record.document || "sem documento"}
          </p>
          <p style={{ margin: "2px 0", color: "var(--text-muted)" }}>{record.history}</p>
          <small className="text-muted">
            {record.evidence.originalName} ·{" "}
            {record.evidence.page ? `página ${record.evidence.page}` : `linha ${record.evidence.line ?? "—"}`} ·{" "}
            {parserLabel(record.evidence.parser)} · {extractionMethodLabel(record.evidence.extractionMethod)}
          </small>
        </>
      ) : (
        <p className="text-muted">Sem registro correspondente.</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <strong className="value">{value}</strong>
    </div>
  );
}

export function confirmedMappings(
  preflight: PreflightResult,
  statementMappings: Record<string, string>,
  linkedPhysicalStatementIds: Record<string, boolean> = {},
): AccountMapping[] {
  const eligible = preflight.statements.filter((item) => item.reconciliationEligible);
  const byAccount = new Map<string, string[]>();

  for (const statement of eligible) {
    const account = statementMappings[statement.fileId];
    if (!account) continue;
    const current = byAccount.get(account) ?? [];
    current.push(statement.fileId);
    byAccount.set(account, current);
  }

  const mappings: AccountMapping[] = [];
  for (const [account, statementFileIds] of byAccount.entries()) {
    const ledgerAccount = preflight.ledgerAccounts.find((item) => item.account === account);
    const signProfile: SignProfile =
      ledgerAccount?.balanceMovementEffect === "SUBTRACTS_FROM_BALANCE"
        ? "BANK_LIABILITY"
        : "BANK_ASSET";

    const linkedPhysicalAccounts = statementFileIds.flatMap((fileId) => {
      const statement = preflight.statements.find((item) => item.fileId === fileId);
      return linkedPhysicalStatementIds[fileId] && statement && statement.bank && statement.agency && statement.account
        ? [{ statementFileId: fileId, bank: statement.bank, agency: statement.agency, account: statement.account, role: "LINKED" as const }]
        : [];
    });
    mappings.push({
      ledgerAccount: account,
      statementFileIds,
      signProfile,
      ...(linkedPhysicalAccounts.length ? { linkedPhysicalAccounts } : {}),
    });
  }

  return mappings;
}

export function proposeStatementMappings(preflight: PreflightResult): Record<string, string> {
  const mappings: Record<string, string> = {};
  for (const statement of preflight.statements.filter((item) => item.reconciliationEligible)) {
    const registeredAccounts = new Set(
      (preflight.registeredAccountMappings ?? [])
        .filter((mapping) => bankAccountsMatch(mapping, statement))
        .map((mapping) => mapping.ledgerAccount)
        .filter((account) => preflight.ledgerAccounts.some((ledgerAccount) => ledgerAccount.account === account)),
    );
    if (registeredAccounts.size === 1) {
      mappings[statement.fileId] = [...registeredAccounts][0]!;
      continue;
    }
    const compatibleAccounts = preflight.ledgerAccounts.filter((ledgerAccount) =>
      bankAccountsMatch(ledgerAccount, statement),
    );
    if (compatibleAccounts.length === 1) mappings[statement.fileId] = compatibleAccounts[0]!.account;
  }
  return mappings;
}

export function confirmedIdentityMappings(
  preflight: PreflightResult,
  statementMappings: Record<string, string>,
  linkedPhysicalStatementIds: Record<string, boolean> = {},
): boolean {
  const eligibleStatements = preflight.statements.filter((item) => item.reconciliationEligible);
  return eligibleStatements.length > 0 && eligibleStatements.every((statement) => {
    const ledgerAccountCode = statementMappings[statement.fileId];
    const ledgerAccount = preflight.ledgerAccounts.find((item) => item.account === ledgerAccountCode);
    const identity = ledgerAccount && compareBankAccountIdentities(ledgerAccount, statement);
    return Boolean(identity && (identity.status !== "CONFLICT" || (
      linkedPhysicalStatementIds[statement.fileId] && statement.bank && statement.agency && statement.account
    )));
  });
}

function partialIdentityMappings(
  preflight: PreflightResult,
  statementMappings: Record<string, string>,
): boolean {
  return preflight.statements.filter((item) => item.reconciliationEligible).some((statement) => {
    const ledgerAccountCode = statementMappings[statement.fileId];
    const ledgerAccount = preflight.ledgerAccounts.find((item) => item.account === ledgerAccountCode);
    return Boolean(ledgerAccount && compareBankAccountIdentities(ledgerAccount, statement).status === "PARTIAL");
  });
}

async function uploadFile(
  authenticatedFetch: AuthenticatedFetch,
  credential: SessionCredential,
  file: File,
  kind: StoredFile["kind"],
): Promise<void> {
  const authorized = await readResponse<{ file: StoredFile; upload: { mode: "local" | "presigned"; url: string } }>(
    await authenticatedFetch(`/api/sessions/${credential.id}/uploads/authorize`, {
      method: "POST",
      headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        originalName: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      }),
    }),
  );
  const uploadResponse =
    authorized.upload.mode === "local"
      ? await authenticatedFetch(authorized.upload.url, {
        method: "PUT",
        headers: { ...sessionHeaders(credential), "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      : await fetch(authorized.upload.url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
  if (!uploadResponse.ok) await readResponse(uploadResponse);
  await readResponse(
    await authenticatedFetch(`/api/sessions/${credential.id}/uploads/complete`, {
      method: "POST",
      headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: authorized.file.id }),
    }),
  );
}

function sessionHeaders(credential: SessionCredential): Record<string, string> {
  return { [sessionTokenHeader]: credential.token };
}

async function readResponse<T = unknown>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  let body: (T & ApiError) | undefined;
  try {
    if (contentType.includes("application/json")) body = (await response.json()) as T & ApiError;
    else await response.text();
  } catch {
    // A resposta inválida não deve ocultar o código HTTP que ajuda a orientar o usuário.
  }
  if (!response.ok) throw new Error(body?.error?.message ?? fallbackHttpMessage(response.status));
  return body as T;
}

function fallbackHttpMessage(status: number): string {
  if (status === 401)
    return "Sua sessão expirou por segurança. Por favor, acesse novamente para continuar.";
  if (status === 403)
    return "Você não possui permissão para executar esta ação nesta empresa.";
  if (status === 404)
    return "As informações solicitadas não foram encontradas. Elas podem ter sido concluídas ou movidas.";
  if (status === 413)
    return "Um dos arquivos enviados ultrapassa o limite de tamanho permitido. Por favor, envie arquivos menores ou menos itens por vez.";
  if (status === 429)
    return "Muitas tentativas em pouco tempo. Por favor, aguarde alguns instantes antes de tentar novamente.";
  if (status >= 500)
    return "O servidor encontrou uma instabilidade temporária ao processar a solicitação. Por favor, tente novamente em instantes.";
  return "Não foi possível concluir a operação no momento. Por favor, tente novamente.";
}

function messageOf(value: unknown): string {
  if (value instanceof TypeError)
    return "Não foi possível conectar ao servidor local. Verifique sua conexão e tente novamente.";
  return value instanceof Error ? value.message : "Ocorreu uma inconsistência temporária ao processar a solicitação.";
}

function formatPeriod(period: string): string {
  if (!period) return "—";
  if (period.length === 6 && /^\d{6}$/.test(period)) {
    return `${period.slice(4, 6)}/${period.slice(0, 4)}`;
  }
  return period;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function groupLines(
  records: Array<NonNullable<ReconciliationResult["ledger"] | ReconciliationResult["statement"]>>,
): string {
  return records.length
    ? records
      .map(
        (record) =>
          `${formatDateForDisplay(record.date)} · ${record.history} · ${formatCurrency(Number(record.value))}`,
      )
      .join(" | ")
    : "—";
}
