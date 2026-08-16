"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { AccountMapping, InvestmentEntry, PreflightResult, ProcessingResult, ReconciliationResult } from "@conciliacao/core";
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

type Stage = "WELCOME" | "FILES" | "PREFLIGHT" | "CONFIRM" | "PROCESSING" | "RESULTS";
type SessionCredential = { id: string; token: string };
type ApiError = { error?: { code?: string; message?: string } };
type AuthenticatedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type AuthorizedCompany = {
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

const tabs = [
  { id: "EXATOS", label: "Exatos", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_EXACT" },
  { id: "PROXIMIDADE", label: "Proximidade", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_DATE_TOLERANCE" },
  { id: "GRUPOS", label: "Grupos", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_GROUP" },
  { id: "TOTAL_DIARIO", label: "Total diário", test: (item: ReconciliationResult) => item.status === "AUTO_MATCH_DAILY_TOTAL" },
  { id: "COMPENSADOS", label: "Compensados", test: (item: ReconciliationResult) => item.status === "BANK_NET_ZERO" },
  { id: "APLICACOES", label: "Aplicações automáticas", test: (item: ReconciliationResult) => item.status === "AUTO_APPLICATION_EXCLUDED" },
  { id: "RAZAO_SEM_EXTRATO", label: "Razão sem extrato", test: (item: ReconciliationResult) => item.status === "LEDGER_WITHOUT_STATEMENT" },
  { id: "EXTRATO_SEM_RAZAO", label: "Extrato sem razão", test: (item: ReconciliationResult) => item.status === "STATEMENT_WITHOUT_LEDGER" },
  { id: "AMBIGUIDADES", label: "Ambiguidades e duplicidades", test: (item: ReconciliationResult) => item.status === "AMBIGUOUS_MATCH" || item.status === "POSSIBLE_DUPLICATE" },
  { id: "INVESTIMENTOS", label: "Investimentos", test: (_item: ReconciliationResult) => false },
  { id: "ARQUIVOS_ERROS", label: "Arquivos e erros", test: (_item: ReconciliationResult) => false },
] as const;

export function ReconciliationApp({ companies, userEmail, logout, authenticatedFetch }: {
  companies: AuthorizedCompany[];
  userEmail: string;
  logout: () => Promise<void>;
  authenticatedFetch: AuthenticatedFetch;
}) {
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState<Stage>("WELCOME");
  const [credential, setCredential] = useState<SessionCredential | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [ledgerFile, setLedgerFile] = useState<File | null>(null);
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [valueTolerance, setValueTolerance] = useState("");
  const [dateToleranceDays, setDateToleranceDays] = useState("2");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [statementMappings, setStatementMappings] = useState<Record<string, string>>({});
  const [company, setCompany] = useState("");
  const [branch, setBranch] = useState("");
  const [period, setPeriod] = useState("");
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("EXATOS");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReconciliationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => companies.find(canPrepare)?.id ?? "");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyRecordId, setHistoryRecordId] = useState<string | null>(null);
  const effectAuthenticatedFetch = useEffectEvent(authenticatedFetch);

  useEffect(() => {
    void effectAuthenticatedFetch("/api/reconciliation-history?size=20", { cache: "no-store" })
      .then((response) => readResponse<{ items: HistoryItem[] }>(response))
      .then((body) => setHistory(body.items ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!credential) return;
    const timer = window.setInterval(() => {
      void effectAuthenticatedFetch(`/api/sessions/${credential.id}/heartbeat`, { method: "POST", headers: sessionHeaders(credential), cache: "no-store" });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [credential]);

  useEffect(() => {
    if (!credential || (stage !== "PROCESSING" && stage !== "PREFLIGHT")) return;
    const timer = window.setInterval(() => {
      void effectAuthenticatedFetch(`/api/sessions/${credential.id}/status`, { headers: sessionHeaders(credential), cache: "no-store" })
        .then((response) => readResponse<{ session: PublicSession }>(response))
        .then(({ session: current }) => {
          setSession(current);
          if (stage === "PREFLIGHT" && current.preflight) showPreflight(current.preflight);
          else if (current.result) { setResult(current.result); setStage("RESULTS"); }
          else if (current.status === "FAILED") {
            setError(current.errorMessage ?? "O processamento falhou e a sessão foi encerrada.");
            void effectAuthenticatedFetch(`/api/sessions/${credential.id}/close`, { method: "POST", headers: sessionHeaders(credential), keepalive: true });
            setCredential(null); setStage("WELCOME");
          }
        }).catch((exception) => setError(messageOf(exception)));
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
    return result.results.filter(tab.test).filter((item) => !normalized || JSON.stringify(item).toLocaleUpperCase("pt-BR").includes(normalized));
  }, [result, activeTab, search]);

  function showPreflight(detected: PreflightResult): void {
    setPreflight(detected);
    setCompany(detected.companies[0] ?? "");
    setBranch(detected.branches[0] ?? "");
    setPeriod(detected.detectedPeriods.length === 1 ? detected.detectedPeriods[0]!.period : "");
    setStatementMappings({});
    setStage("CONFIRM");
  }

  async function begin(): Promise<void> {
    setError(""); setBusy(true);
    try {
      setStage("FILES");
    } catch (exception) { setError(messageOf(exception)); }
    finally { setBusy(false); }
  }

  async function uploadAndAnalyze(): Promise<void> {
    if (!ledgerFile || statementFiles.length < 1 || !valueTolerance) return;
    setBusy(true); setError(""); setStage("PREFLIGHT");
    try {
      const initResponse = await authenticatedFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });
      const initBody = await readResponse<{ session: PublicSession; token: string }>(initResponse);
      const activeCredential = { id: initBody.session.id, token: initBody.token };
      setCredential(activeCredential);

      await uploadFile(authenticatedFetch, activeCredential, ledgerFile, "LEDGER");
      for (const file of statementFiles) await uploadFile(authenticatedFetch, activeCredential, file, "STATEMENT");
      const response = await authenticatedFetch(`/api/sessions/${activeCredential.id}/preflight`, { method: "POST", headers: sessionHeaders(activeCredential) });
      const body = await readResponse<{ session: PublicSession }>(response);
      setSession(body.session);
      const detected = body.session.preflight;
      if (detected) showPreflight(detected);
    } catch (exception) { setError(messageOf(exception)); setStage("FILES"); }
    finally { setBusy(false); }
  }

  async function confirmAndProcess(): Promise<void> {
    if (!credential || !preflight) return;
    const mappings = confirmedMappings(preflight, statementMappings);
    if (!period) { setError("Confirme a competência antes de iniciar a conciliação."); return; }
    if (!Number.isInteger(Number(dateToleranceDays)) || Number(dateToleranceDays) < 0 || Number(dateToleranceDays) > 3) { setError("Informe uma tolerância de data inteira entre 0 e 3 dias."); return; }
    if (mappings.length !== preflight.statements.filter((item) => item.reconciliationEligible).length) { setError("Selecione uma conta contábil para cada extrato elegível."); return; }
    setBusy(true); setError(""); setStage("PROCESSING");
    try {
      const response = await authenticatedFetch(`/api/sessions/${credential.id}/confirm-and-process`, {
        method: "POST", headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
        body: JSON.stringify({ company, branch: branch || undefined, period, valueTolerance: valueTolerance.replace(",", "."), dateToleranceDays: Number(dateToleranceDays), mappings, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await readResponse<{ session: PublicSession }>(response);
      setSession(body.session); setResult(body.session.result ?? null); setStage(body.session.result ? "RESULTS" : "PROCESSING");
    } catch (exception) { setError(messageOf(exception)); setStage("CONFIRM"); }
    finally { setBusy(false); }
  }

  async function download(): Promise<void> {
    if (!credential && !historyRecordId) return;
    setBusy(true); setError("");
    try {
      const response = historyRecordId
        ? await authenticatedFetch(`/api/reconciliation-history/${historyRecordId}/export.xlsx`)
        : await authenticatedFetch(`/api/sessions/${credential!.id}/export.xlsx`, { headers: sessionHeaders(credential!) });
      if (!response.ok) await readResponse(response);
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `CONCILIACAO_${result?.period ?? "RESULTADO"}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
    } catch (exception) { setError(messageOf(exception)); }
    finally { setBusy(false); }
  }

  async function closeSession(): Promise<void> {
    if (credential) await authenticatedFetch(`/api/sessions/${credential.id}/close`, { method: "POST", headers: sessionHeaders(credential), keepalive: true }).catch(() => undefined);
    setCredential(null); setSession(null); setResult(null); setPreflight(null); setLedgerFile(null); setStatementFiles([]); setStage("WELCOME"); setConsent(false); setError("");
    setHistoryRecordId(null);
    void reloadHistory();
  }

  async function reloadHistory(): Promise<void> {
    const response = await authenticatedFetch("/api/reconciliation-history?size=20", { cache: "no-store" });
    if (response.ok) setHistory((await response.json() as { items?: HistoryItem[] }).items ?? []);
  }

  async function openHistory(id: string): Promise<void> {
    setBusy(true); setError("");
    try {
      const response = await authenticatedFetch(`/api/reconciliation-history/${id}`, { cache: "no-store" });
      const body = await readResponse<{ record: { result: ProcessingResult } }>(response);
      setHistoryRecordId(id); setResult(body.record.result); setCredential(null); setStage("RESULTS");
    } catch (exception) { setError(messageOf(exception)); }
    finally { setBusy(false); }
  }

  return <>
    <header className="topbar">
      <div className="brand"><div className="brand-mark">CB</div><div><h1>Conciliação Bancária</h1><p>Razão Protheus × Extratos bancários</p></div></div>
      <div className="topbar-actions"><span className="privacy-pill">{userEmail}</span><button className="topbar-button" onClick={() => void logout()}>Sair</button></div>
    </header>
    <div className="shell">
      {stage === "WELCOME" && <Welcome companies={companies} selectedCompanyId={selectedCompanyId} setSelectedCompanyId={setSelectedCompanyId} history={history} openHistory={openHistory} consent={consent} setConsent={setConsent} begin={begin} busy={busy} />}
      {stage !== "WELCOME" && <Stepper stage={stage} />}
      {error && <div className="notice error" role="alert">{error}</div>}
      {stage === "FILES" && <FileStep ledgerFile={ledgerFile} setLedgerFile={setLedgerFile} statementFiles={statementFiles} setStatementFiles={setStatementFiles} valueTolerance={valueTolerance} setValueTolerance={setValueTolerance} dateToleranceDays={dateToleranceDays} setDateToleranceDays={setDateToleranceDays} submit={uploadAndAnalyze} busy={busy} />}
      {stage === "PREFLIGHT" && <Progress title="Analisando os arquivos" message="Validando conteúdo, identificando contas e preparando o relacionamento." progress={25} />}
      {stage === "CONFIRM" && preflight && <Confirmation preflight={preflight} company={company} setCompany={setCompany} branch={branch} setBranch={setBranch} period={period} setPeriod={setPeriod} statementMappings={statementMappings} setStatementMappings={setStatementMappings} submit={confirmAndProcess} busy={busy} />}
      {stage === "PROCESSING" && <Progress title="Executando a conciliação" message={session?.progressMessage ?? "Aplicando as regras com segurança."} progress={session?.progress ?? 65} />}
      {stage === "RESULTS" && result && <Results result={result} visible={visibleResults} activeTab={activeTab} setActiveTab={setActiveTab} search={search} setSearch={setSearch} selected={selected} setSelected={setSelected} download={download} close={closeSession} busy={busy} />}
      {stage !== "WELCOME" && <p className="footer-note">Os arquivos são eliminados após o processamento. O resultado autenticado permanece no histórico por um ano.</p>}
    </div>
  </>;
}

function Welcome({ companies, selectedCompanyId, setSelectedCompanyId, history, openHistory, consent, setConsent, begin, busy }: { companies: AuthorizedCompany[]; selectedCompanyId: string; setSelectedCompanyId: (value: string) => void; history: HistoryItem[]; openHistory: (id: string) => void; consent: boolean; setConsent: (value: boolean) => void; begin: () => void; busy: boolean }) {
  const preparerCompanies = companies.filter(canPrepare);
  return <><section className="hero"><article className="card intro"><span className="eyebrow">Conferência simples e auditável</span><h2>Compare seu razão com os extratos, direto no navegador.</h2><p>Envie um razão do Protheus e até cinco extratos. A aplicação identifica contas e competências, apresenta o relacionamento para confirmação e mostra cada resultado com sua evidência.</p><label className="field company-selector">Empresa operacional<select value={selectedCompanyId} onChange={(event) => setSelectedCompanyId(event.target.value)}><option value="">Selecione</option>{preparerCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><button className="button" disabled={!selectedCompanyId || !consent || busy} onClick={begin}>{busy ? "Preparando..." : "Iniciar nova conciliação"}</button></article><aside className="card privacy-card"><h3>Retenção controlada</h3><ul><li>Arquivos são eliminados após o processamento.</li><li>Resultados e evidências ficam disponíveis por um ano.</li><li>O acesso respeita sua organização, empresa e papel.</li><li>O XLSX é criado apenas quando você solicitar.</li></ul><label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Confirmo que tenho autorização para processar estes documentos financeiros.</span></label></aside></section><section className="card panel history-panel"><div className="panel-header"><div><h2>Histórico recente</h2><p>Resultados disponíveis conforme seu acesso atual às empresas.</p></div></div>{history.length ? <div className="history-list">{history.map((item) => <button className="history-item" key={item.id} onClick={() => openHistory(item.id)}><strong>{item.companyName}</strong><span>{formatPeriod(item.period)} · {new Date(item.completedAt).toLocaleDateString("pt-BR")}</span></button>)}</div> : <div className="empty">Nenhuma conciliação retida disponível.</div>}</section></>;
}

function canPrepare(company: AuthorizedCompany): boolean { return company.roles.some((role) => role === "PREPARER" || role === "ADMIN"); }

function Stepper({ stage }: { stage: Stage }) {
  const order: Array<{ stage: Stage; label: string }> = [{ stage: "FILES", label: "Arquivos" }, { stage: "PREFLIGHT", label: "Pré-análise" }, { stage: "CONFIRM", label: "Confirmação" }, { stage: "PROCESSING", label: "Conciliação" }, { stage: "RESULTS", label: "Resultado" }];
  const current = order.findIndex((item) => item.stage === stage);
  return <nav className="card stepper" aria-label="Etapas">{order.map((item, index) => <div className={`step ${index === current ? "active" : ""} ${index < current ? "done" : ""}`} key={item.stage}><span className="step-number">{index < current ? "✓" : index + 1}</span>{item.label}</div>)}</nav>;
}

function FileStep(props: { ledgerFile: File | null; setLedgerFile: (file: File | null) => void; statementFiles: File[]; setStatementFiles: (files: File[]) => void; valueTolerance: string; setValueTolerance: (value: string) => void; dateToleranceDays: string; setDateToleranceDays: (value: string) => void; submit: () => void; busy: boolean }) {
  const valid = props.ledgerFile && props.statementFiles.length > 0 && props.statementFiles.length <= 5 && props.valueTolerance !== "" && props.dateToleranceDays !== "";
  return <section className="card panel"><div className="panel-header"><div><h2>Selecione os arquivos</h2><p>Um razão do Protheus e de um a cinco extratos. Os nomes podem ser livres.</p></div></div><div className="upload-grid"><UploadBox title="Razão Protheus" hint="CSV, XLSX, XLS ou XLSM · exatamente um arquivo" accept=".csv,.xlsx,.xls,.xlsm" multiple={false} files={props.ledgerFile ? [props.ledgerFile] : []} onFiles={(files) => props.setLedgerFile(files[0] ?? null)} /><UploadBox title="Extratos bancários" hint="CSV, XLSX, XLS, XLSM, OFX ou PDF · até cinco arquivos" accept=".csv,.xlsx,.xls,.xlsm,.ofx,.pdf" multiple files={props.statementFiles} onFiles={(files) => props.setStatementFiles(files.slice(0, 5))} /></div><div className="form-grid"><label className="field">Tolerância de valor (R$)<input min="0" step="0.01" inputMode="decimal" value={props.valueTolerance} onChange={(event) => props.setValueTolerance(event.target.value)} placeholder="Ex.: 0,01" /></label><label className="field">Tolerância de data (dias)<input min="0" max="3" step="1" inputMode="numeric" value={props.dateToleranceDays} onChange={(event) => props.setDateToleranceDays(event.target.value)} /></label></div><div className="notice info">Somente lançamentos da conta contábil vinculada ao extrato serão comparados. Igualdade isolada de valor será exibida como sugestão, nunca como conciliação automática.</div><div className="actions"><button className="button" disabled={!valid || props.busy} onClick={props.submit}>{props.busy ? "Enviando…" : "Analisar arquivos"}</button></div></section>;
}

function UploadBox({ title, hint, accept, multiple, files, onFiles }: { title: string; hint: string; accept: string; multiple: boolean; files: File[]; onFiles: (files: File[]) => void }) {
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
  return <div className="dropzone"><h3>{title}</h3><p>{hint}</p><input className="file-input" aria-label={title} type="file" accept={accept} multiple={multiple} onChange={handleChange} />{files.length > 0 && <div className="file-list">{files.map((file, i) => <div className="file-item" key={`${file.name}-${file.size}-${i}`}><span>{file.name}</span><span>{formatSize(file.size)}</span><button type="button" className="button danger" style={{ padding: "4px 8px", fontSize: "12px", marginLeft: "8px" }} onClick={() => handleRemove(i)}>Remover</button></div>)}</div>}</div>;
}

function Progress({ title, message, progress }: { title: string; message: string; progress: number }) { return <section className="card progress-wrap"><span className="eyebrow">Processamento temporário</span><h2>{title}</h2><p>{message}</p><div className="progress" aria-label={`${progress}%`}><span style={{ width: `${progress}%` }} /></div><small>{progress}%</small></section>; }

function Confirmation(props: { preflight: PreflightResult; company: string; setCompany: (value: string) => void; branch: string; setBranch: (value: string) => void; period: string; setPeriod: (value: string) => void; statementMappings: Record<string, string>; setStatementMappings: (value: Record<string, string>) => void; submit: () => void; busy: boolean }) {
  const currentAccountStatements = props.preflight.statements.filter((item) => item.reconciliationEligible);
  const investmentStatements = props.preflight.statements.filter((item) => !item.reconciliationEligible);
  const blocked = props.preflight.issues.some((item) => item.severity === "ERROR");
  const mappingsComplete = confirmedMappings(props.preflight, props.statementMappings).length === currentAccountStatements.length;
  return <section className="card panel"><div className="panel-header"><div><h2>Confirme o que foi identificado</h2><p>Selecione a conta contábil correspondente a cada extrato. Contas incompatíveis são bloqueadas antes da conciliação.</p></div></div><div className="detected-grid"><Metric label="Empresas detectadas" value={props.preflight.companies.length || "—"} /><Metric label="Contas contábeis" value={props.preflight.ledgerAccounts.length} /><Metric label="Extratos de conta" value={currentAccountStatements.length} /><Metric label="Documentos de investimento" value={investmentStatements.length} /></div>{props.preflight.issues.map((item, index) => <div className={`notice ${item.severity === "ERROR" ? "error" : "warning"}`} key={`${item.code}-${index}`}><strong>{issueCategoryLabel(item.code, item.severity)}</strong> — {item.message}</div>)}<div className="form-grid"><label className="field">Empresa<input value={props.company} onChange={(event) => props.setCompany(event.target.value)} placeholder="Informe se não detectada" /></label><label className="field">Filial<input value={props.branch} onChange={(event) => props.setBranch(event.target.value)} placeholder="Opcional" /></label><label className="field">Competência<select value={props.period} onChange={(event) => props.setPeriod(event.target.value)}><option value="">Selecione</option>{props.preflight.detectedPeriods.map((item) => <option key={item.period} value={item.period}>{formatPeriod(item.period)} · {item.recordCount} registros</option>)}</select></label></div><h3>Mapeamento obrigatório dos extratos</h3>{currentAccountStatements.map((statement) => <div className="mapping" key={statement.fileId}><div><strong>{statement.originalName}</strong><div>{[bankLabel(statement.bank), statement.agency, statement.account].filter(Boolean).join(" · ") || "Conta não identificada"}</div></div><label className="field"><span className="sr-only">Conta contábil para {statement.originalName}</span><select aria-label={`Conta contábil para ${statement.originalName}`} value={props.statementMappings[statement.fileId] ?? ""} onChange={(event) => props.setStatementMappings({ ...props.statementMappings, [statement.fileId]: event.target.value })}><option value="">Selecione a conta contábil</option>{props.preflight.ledgerAccounts.map((account) => <option key={`${account.company}-${account.branch}-${account.account}`} value={account.account}>{account.account} · {[bankLabel(account.bank), account.agency, account.bankAccount].filter(Boolean).join("/") || "conta bancária não identificada"}</option>)}</select></label></div>)}{investmentStatements.length > 0 && <><h3>Investimentos para conferência</h3><div className="notice info">Estes documentos são informativos e não participam da conciliação de conta corrente.</div>{investmentStatements.map((statement) => <div className="mapping" key={statement.fileId}><div><strong>{statement.originalName}</strong><div>{[bankLabel(statement.bank), statement.agency, statement.account].filter(Boolean).join(" · ") || "Conta não identificada"}</div></div><span>{documentKindLabel(statement.classification)}</span></div>)}</>}<div className="actions"><button className="button" disabled={props.busy || blocked || !mappingsComplete} onClick={props.submit}>{props.busy ? "Processando…" : "Confirmar e conciliar"}</button></div></section>;
}

function Results(props: { result: ProcessingResult; visible: ReconciliationResult[]; activeTab: string; setActiveTab: (value: (typeof tabs)[number]["id"]) => void; search: string; setSearch: (value: string) => void; selected: ReconciliationResult | null; setSelected: (value: ReconciliationResult | null) => void; download: () => void; close: () => void; busy: boolean }) {
  const [visibleCount, setVisibleCount] = useState(25);
  useEffect(() => { setVisibleCount(25); }, [props.activeTab, props.search]);
  const controls = props.result.controls;
  const totals = props.result.summaries.reduce((sum, item) => ({ reconciled: sum.reconciled + item.reconciledCount, divergences: sum.divergences + item.divergenceCount, missing: sum.missing + item.ledgerWithoutStatementCount + item.statementWithoutLedgerCount, difference: sum.difference + Number(item.balanceDifference) }), { reconciled: 0, divergences: 0, missing: 0, difference: 0 });
  if (controls) return <><section className="card panel"><div className="results-head"><div><span className="eyebrow">Conciliação concluída</span><h2>{props.result.company} · {formatPeriod(props.result.period)}</h2></div><div className="actions"><button className="button secondary" disabled={props.busy} onClick={props.download}>Baixar XLSX completo</button><button className="button danger" onClick={props.close}>Encerrar sessão</button></div></div><div className="summary-grid"><Metric label="Movimento bancário conciliável" value={formatCurrency(Number(controls.movements.bankConciliable))} /><Metric label="Movimento do razão" value={formatCurrency(Number(controls.movements.ledger))} /><Metric label="Diferença banco × razão" value={formatCurrency(Number(controls.movements.difference))} /><Metric label="Cobertura de linhas" value={`${controls.coverage.lines.percentage}%`} /><Metric label="Cobertura de valor absoluto" value={`${controls.coverage.absoluteValue.percentage}%`} /><Metric label="Diferença de saldo final" value={controls.balances.closingDifference === undefined ? "Não disponível" : formatCurrency(Number(controls.balances.closingDifference))} /></div></section><section className="card panel" style={{ marginTop: 16 }}><div className="tabs" role="tablist">{tabs.map((tab) => <button role="tab" aria-selected={props.activeTab === tab.id} className={`tab ${props.activeTab === tab.id ? "active" : ""}`} key={tab.id} onClick={() => props.setActiveTab(tab.id)}>{tab.label}</button>)}</div>{props.activeTab === "ARQUIVOS_ERROS" ? <FilesAndErrors result={props.result} /> : props.activeTab === "INVESTIMENTOS" ? <Investments entries={props.result.investments} /> : <><div className="table-tools"><input className="filter" value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Filtrar por conta, documento, histórico ou valor" /></div>{props.activeTab === "TOTAL_DIARIO" && <div className="notice warning">O total diário comprova o fechamento do lote; não representa pareamento individual entre as linhas.</div>}<div className="table-wrap">{props.visible.length ? <table><thead><tr><th>Status</th><th>Linhas do razão</th><th>Linhas do extrato</th><th>Totais</th><th>Regra</th><th></th></tr></thead><tbody>{props.visible.slice(0, visibleCount).map((item) => <tr key={item.id}><td><span className={`status ${item.decisionLevel === "AUTOMATIC" ? "ok" : "problem"}`}>{resultStatusLabel(item.status)}</span></td><td>{groupLines(item.ledgers ?? (item.ledger ? [item.ledger] : []))}</td><td>{groupLines(item.statements ?? (item.statement ? [item.statement] : []))}</td><td>{item.matchGroup ? `${formatCurrency(Number(item.matchGroup.ledgerTotalCents) / 100)} × ${formatCurrency(Number(item.matchGroup.bankTotalCents) / 100)}` : "—"}</td><td>{reconciliationRuleLabel(item.rule)}</td><td><button className="link-button" onClick={() => props.setSelected(item)}>Ver evidência</button></td></tr>)}</tbody></table> : <div className="empty">Nenhum item nesta categoria.</div>}</div>{props.visible.length > visibleCount && <div className="actions"><button className="button secondary" onClick={() => setVisibleCount((count) => count + 25)}>Mostrar mais</button></div>}</>}</section>{props.selected && <Evidence item={props.selected} close={() => props.setSelected(null)} />}</>;
  return <><section className="card panel"><div className="results-head"><div><span className="eyebrow">Conciliação concluída</span><h2>{props.result.company} · {formatPeriod(props.result.period)}</h2></div><div className="actions"><button className="button secondary" disabled={props.busy} onClick={props.download}>Baixar XLSX completo</button><button className="button danger" onClick={props.close}>Encerrar sessão</button></div></div><div className="summary-grid"><Metric label="Conciliados automáticos" value={totals.reconciled} /><Metric label="Divergências" value={totals.divergences} /><Metric label="Pendências" value={totals.missing} /><Metric label="Diferença de saldo" value={formatCurrency(totals.difference)} /></div></section><section className="card panel" style={{ marginTop: 16 }}><div className="tabs" role="tablist">{tabs.map((tab) => <button role="tab" aria-selected={props.activeTab === tab.id} className={`tab ${props.activeTab === tab.id ? "active" : ""}`} key={tab.id} onClick={() => props.setActiveTab(tab.id)}>{tab.label}</button>)}</div>{props.activeTab === "ARQUIVOS_ERROS" ? <FilesAndErrors result={props.result} /> : props.activeTab === "INVESTIMENTOS" ? <Investments entries={props.result.investments} /> : <><div className="table-tools"><input className="filter" value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Filtrar por conta, documento, histórico ou valor" /></div><div className="table-wrap">{props.visible.length ? <table><thead><tr><th>Status</th><th>Data</th><th>Documento</th><th>Histórico</th><th>Valor razão</th><th>Valor extrato</th><th>Regra</th><th></th></tr></thead><tbody>{props.visible.slice(0, visibleCount).map((item) => <tr key={item.id}><td><span className={`status ${item.decisionLevel === "AUTOMATIC" ? "ok" : "problem"}`}>{resultStatusLabel(item.status)}</span></td><td>{formatDateForDisplay(item.ledger?.date ?? item.statement?.date) || "—"}</td><td>{item.ledger?.document || item.statement?.document || "—"}</td><td>{item.ledger?.history || item.statement?.history || "—"}</td><td>{item.ledger ? formatCurrency(Number(item.ledger.value)) : "—"}</td><td>{item.statement ? formatCurrency(Number(item.statement.value)) : "—"}</td><td>{reconciliationRuleLabel(item.rule)}</td><td><button id={`evidence-trigger-${item.id}`} type="button" className="button secondary" aria-controls={`evidence-${item.id}`} aria-expanded={props.selected?.id === item.id} onClick={() => props.setSelected(item)}>Ver evidência</button></td></tr>)}</tbody></table> : <div className="empty">Nenhum resultado nesta categoria.</div>}</div>{props.visible.length > visibleCount && <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}><button className="button secondary" onClick={() => setVisibleCount((prev) => prev + 25)}>Carregar mais resultados</button></div>}{props.visible.length > 0 && <p className="footer-note">Mostrando {Math.min(visibleCount, props.visible.length)} de {props.visible.length} resultados filtrados.</p>}</>}</section>{props.selected && <Evidence item={props.selected} close={() => props.setSelected(null)} />}</>;
}

function Investments({ entries }: { entries: InvestmentEntry[] }) {
  if (!entries.length) return <div className="empty">Nenhum documento de investimento foi enviado nesta execução.</div>;
  return <div className="table-wrap"><table><thead><tr><th>Arquivo</th><th>Banco</th><th>Conta</th><th>Data</th><th>Tipo</th><th>Valor</th><th>Descrição</th><th>Evidência</th></tr></thead><tbody>{entries.map((item) => <tr key={item.id}><td>{item.originalName}</td><td>{bankLabel(item.bank)}</td><td>{[item.agency, item.account].filter(Boolean).join("/") || "—"}</td><td>{formatDateForDisplay(item.date) || "—"}</td><td>{investmentKindLabel(item.kind)}</td><td>{formatCurrency(Number(item.amount))}</td><td>{item.description}</td><td>{item.evidence.page ? `Página ${item.evidence.page}` : "—"} · {parserLabel(item.evidence.parser)} · {extractionMethodLabel(item.evidence.extractionMethod)}</td></tr>)}</tbody></table></div>;
}

function FilesAndErrors({ result }: { result: ProcessingResult }) {
  return <div className="files-errors"><h3>Arquivos processados</h3>{result.files.length ? <div className="table-wrap"><table><thead><tr><th>Arquivo</th><th>Banco</th><th>Agência/conta</th><th>Registros</th><th>Método</th><th>Leitor</th></tr></thead><tbody>{result.files.map((file) => <tr key={file.fileId}><td>{file.originalName}</td><td>{bankLabel(file.bank) || "—"}</td><td>{[file.agency, file.account].filter(Boolean).join("/") || "—"}</td><td>{file.recordCount}</td><td>{extractionMethodLabel(file.extractionMethod)}</td><td>{parserLabel(file.parser)}</td></tr>)}</tbody></table></div> : <div className="empty">Nenhum arquivo disponível.</div>}<h3>Alertas e rejeições</h3>{result.issues.length ? result.issues.map((issue, index) => <div className={`notice ${issue.severity === "ERROR" ? "error" : "warning"}`} key={`${issue.code}-${index}`}><strong>{issueCategoryLabel(issue.code, issue.severity)}</strong> — {issue.message}{issue.sourcePosition ? ` · posição ${issue.sourcePosition}` : ""}</div>) : <div className="notice info">Nenhum alerta técnico nesta execução.</div>}</div>;
}

function Evidence({ item, close }: { item: ReconciliationResult; close: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    panel.current?.focus({ preventScroll: true });
  }, [item.id]);
  const ledgers = item.ledgers ?? (item.ledger ? [item.ledger] : []);
  const statements = item.statements ?? (item.statement ? [item.statement] : []);
  return <section ref={panel} id={`evidence-${item.id}`} role="region" aria-label={`Evidência da conciliação ${item.id}`} tabIndex={-1} className="card panel" style={{ marginTop: 16, scrollMarginTop: 16 }}><div className="panel-header"><div><h3>Evidência · identificador técnico {item.id}</h3><p>{item.reason}</p>{item.status === "AUTO_MATCH_DAILY_TOTAL" && <p>Fechamento no nível do lote diário, sem pareamento individual.</p>}</div><button type="button" className="button secondary" onClick={close}>Fechar</button></div><div className="upload-grid"><div>{ledgers.map((record) => <EvidenceSide key={record.id} title="Razão" record={record} />)}</div><div>{statements.map((record) => <EvidenceSide key={record.id} title="Extrato" record={record} />)}</div></div></section>;
}
function EvidenceSide({ title, record }: { title: string; record: ReconciliationResult["ledger"] | ReconciliationResult["statement"] }) { return <div className="metric"><span>{title}</span>{record ? <><strong>{record.value}</strong><p>{formatDateForDisplay(record.date)} · {record.document || "sem documento"}</p><p>{record.history}</p><small>{record.evidence.originalName} · {record.evidence.page ? `página ${record.evidence.page}` : `linha ${record.evidence.line ?? "—"}`} · {parserLabel(record.evidence.parser)} · {extractionMethodLabel(record.evidence.extractionMethod)}</small></> : <p>Sem registro correspondente.</p>}</div>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }

async function uploadFile(authenticatedFetch: AuthenticatedFetch, credential: SessionCredential, file: File, kind: StoredFile["kind"]): Promise<void> {
  const authorized = await readResponse<{ file: StoredFile; upload: { mode: "local" | "presigned"; url: string } }>(await authenticatedFetch(`/api/sessions/${credential.id}/uploads/authorize`, { method: "POST", headers: { ...sessionHeaders(credential), "Content-Type": "application/json" }, body: JSON.stringify({ kind, originalName: file.name, contentType: file.type || "application/octet-stream", size: file.size }) }));
  const uploadResponse = authorized.upload.mode === "local"
    ? await authenticatedFetch(authorized.upload.url, { method: "PUT", headers: { ...sessionHeaders(credential), "Content-Type": file.type || "application/octet-stream" }, body: file })
    : await fetch(authorized.upload.url, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!uploadResponse.ok) await readResponse(uploadResponse);
  await readResponse(await authenticatedFetch(`/api/sessions/${credential.id}/uploads/complete`, { method: "POST", headers: { ...sessionHeaders(credential), "Content-Type": "application/json" }, body: JSON.stringify({ fileId: authorized.file.id }) }));
}

function sessionHeaders(credential: SessionCredential): Record<string, string> { return { [sessionTokenHeader]: credential.token }; }
async function readResponse<T = unknown>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  let body: T & ApiError | undefined;
  try {
    if (contentType.includes("application/json")) body = await response.json() as T & ApiError;
    else await response.text();
  } catch {
    // A resposta inválida não deve ocultar o código HTTP que ajuda a orientar o usuário.
  }
  if (!response.ok) throw new Error(body?.error?.message ?? fallbackHttpMessage(response.status));
  return body as T;
}

function fallbackHttpMessage(status: number): string {
  if (status === 401) return "A sessão expirou ou não está mais disponível neste navegador. Inicie uma nova conciliação.";
  if (status === 404) return "O recurso solicitado não foi encontrado (HTTP 404). Isso pode ocorrer se a sessão já foi encerrada ou se houve um erro de conexão temporário com o servidor.";
  if (status === 413) return "Um dos arquivos excede o limite permitido para a sessão.";
  if (status === 429) return "Este endereço já possui uma sessão ativa ou atingiu o limite temporário. Encerre a sessão anterior e tente novamente.";
  if (status >= 500) return "A aplicação encontrou uma falha temporária ao processar a solicitação. Atualize a página e tente novamente.";
  return `A solicitação foi recusada pela aplicação (HTTP ${status}). Tente novamente.`;
}

function messageOf(value: unknown): string {
  if (value instanceof TypeError) return "Não foi possível comunicar com a aplicação local. Atualize a página e tente novamente.";
  return value instanceof Error ? value.message : "A operação não pôde ser concluída.";
}
export function confirmedMappings(preflight: PreflightResult, selected: Record<string, string>): AccountMapping[] {
  return preflight.statements
    .filter((item) => item.reconciliationEligible)
    .flatMap((statement) => {
      const ledgerAccount = selected[statement.fileId];
      return ledgerAccount ? [{ ledgerAccount, statementFileIds: [statement.fileId], signProfile: "BANK_ASSET" as const }] : [];
    });
}
function formatSize(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function formatPeriod(period: string): string { return period.length === 6 ? `${period.slice(4, 6)}/${period.slice(0, 4)}` : period; }
function formatCurrency(value: number): string { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value); }
function groupLines(records: Array<NonNullable<ReconciliationResult["ledger"] | ReconciliationResult["statement"]>>): string {
  return records.length ? records.map((record) => `${formatDateForDisplay(record.date)} · ${record.history} · ${formatCurrency(Number(record.value))}`).join(" | ") : "—";
}
