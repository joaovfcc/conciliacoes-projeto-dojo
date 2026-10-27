"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  AccountMapping,
  InvestmentEntry,
  LedgerRecord,
  PreflightResult,
  ProcessingResult,
  ReconciliationResult,
  SignProfile,
  StatementRecord,
} from "@conciliacao/core";
import { bankAccountsMatch, compareBankAccountIdentities, ledgerAccountsMatch } from "@conciliacao/core/normalization";
import {
  bankLabel,
  documentKindLabel,
  extractionMethodLabel,
  formatDateForDisplay,
  investmentKindLabel,
  issueCategoryLabel,
  knownCategoricalValueLabel,
  parserLabel,
  reconciliationRuleLabel,
  resultStatusLabel,
} from "@conciliacao/core/presentation";
import type { PublicSession, StoredFile } from "@conciliacao/runtime";
import { CompanyModal } from "./company-modal";
import { EvidenceDrawer } from "./evidence-drawer";
import { AdminUsersPanel } from "./admin-users-panel";
import { CompaniesAccountsPanel } from "./companies-accounts-panel";
import { ManualMatchModal } from "./manual-match-modal";
import { BidirectionalMatchModal } from "./bidirectional-match-modal";

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
const controlRequestTimeoutMs = 30_000;
const statusRequestTimeoutMs = 15_000;
const heavyOperationTimeoutMs = 180_000;
const maximumStatusFailures = 5;
const maximumProcessingWaitMs = 10 * 60_000;

export const tabs = [
  {
    id: "CONCILIADOS",
    label: "Conciliados",
    test: (item: ReconciliationResult) =>
      item.status === "AUTO_MATCH_EXACT" ||
      item.status === "AUTO_MATCH_UNIQUE_VALUE" ||
      item.status === "AUTO_MATCH_DATE_TOLERANCE" ||
      item.status === "AUTO_MATCH_GROUP" ||
      item.status === "GROUP_SUGGESTION" ||
      item.status === "AUTO_MATCH_DAILY_TOTAL" ||
      item.status === "BANK_NET_ZERO",
  },
  {
    id: "EXTRATO_SEM_RAZAO",
    label: "Extrato sem razão",
    test: (item: ReconciliationResult) => item.status === "STATEMENT_WITHOUT_LEDGER",
  },
  {
    id: "RAZAO_SEM_EXTRATO",
    label: "Razão sem extrato",
    test: (item: ReconciliationResult) => item.status === "LEDGER_WITHOUT_STATEMENT",
  },
  {
    id: "AMBIGUIDADES",
    label: "Ambiguidades",
    test: (item: ReconciliationResult) => item.status === "AMBIGUOUS_MATCH" || item.status === "POSSIBLE_DUPLICATE",
  },
  {
    id: "APLICACOES",
    label: "Aplicações automáticas",
    test: (item: ReconciliationResult) => item.status === "AUTO_APPLICATION_EXCLUDED",
  },
  {
    id: "ARQUIVOS_ERROS",
    label: "Arquivos e erros",
    test: (_item: ReconciliationResult) => false,
  },
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
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("CONCILIADOS");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReconciliationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => initialCompanies.find(canPrepare)?.id ?? "");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyRecordId, setHistoryRecordId] = useState<string | null>(null);
  const [manualMatchItem, setManualMatchItem] = useState<ReconciliationResult | null>(null);
  const [bidirectionalMatchAnchor, setBidirectionalMatchAnchor] = useState<ReconciliationResult | null>(null);
  const [isBidirectionalMatchOpen, setIsBidirectionalMatchOpen] = useState(false);
  const [preflightStatusText, setPreflightStatusText] = useState("Validando conteúdo e identificando contas contábeis e bancárias.");
  const [preflightProgress, setPreflightProgress] = useState(20);
  const [preflightActiveStep, setPreflightActiveStep] = useState<"UPLOAD" | "PARSING" | "MAPPING">("UPLOAD");
  const confirmationAttemptRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const pollingFailuresRef = useRef(0);
  const pollingInFlightRef = useRef(false);
  const processingDeadlineRef = useRef<number | null>(null);
  const effectAuthenticatedFetch = useEffectEvent(authenticatedFetch);

  const isAdmin = true;

  // Sincronizar lista de empresas a partir das props
  useEffect(() => {
    setCompanies(initialCompanies);
  }, [initialCompanies]);

  // Sincronizar seleção quando a lista de empresas for atualizada
  useEffect(() => {
    if ((!selectedCompanyId || !companies.some((c) => c.id === selectedCompanyId)) && companies.length > 0) {
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
    const poll = async () => {
      if (pollingInFlightRef.current) return;
      pollingInFlightRef.current = true;
      try {
        const response = await requestWithTimeout(
          effectAuthenticatedFetch,
          `/api/sessions/${credential.id}/status`,
          { headers: sessionHeaders(credential), cache: "no-store" },
          statusRequestTimeoutMs,
        );
        const { session: current } = await readResponse<{ session: PublicSession }>(response);
        pollingFailuresRef.current = 0;
        setSession(current);
        if (stage === "PREFLIGHT") {
          if (current.preflight) {
            showPreflight(current.preflight);
          } else {
            if (current.progressMessage) setPreflightStatusText(current.progressMessage);
            if (current.progress) setPreflightProgress((prev) => Math.max(prev, current.progress));
          }
        } else if (current.result) {
          confirmationAttemptRef.current = null;
          processingDeadlineRef.current = null;
          setHistoryRecordId(current.id);
          setResult(current.result);
          setStage("RESULTS");
        } else if (["FAILED", "CANCELLED", "EXPIRED"].includes(current.status)) {
          setError(current.errorMessage ?? "O processamento falhou ou a sessão expirou. Inicie uma nova tentativa.");
          setCredential(null);
          setStage("FILES");
        } else if (processingDeadlineRef.current && Date.now() >= processingDeadlineRef.current) {
          setError("O processamento excedeu o tempo máximo de espera. Verifique os arquivos e tente novamente.");
          setStage("CONFIRM");
        }
      } catch (exception) {
        pollingFailuresRef.current += 1;
        if (pollingFailuresRef.current >= maximumStatusFailures) {
          setError(`${messageOf(exception)} A verificação foi interrompida para evitar carregamento indefinido; tente novamente.`);
          setStage("CONFIRM");
        }
      } finally {
        pollingInFlightRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2_000);
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
    setPeriod(preferredPreflightPeriod(detected));

    setStatementMappings(proposeStatementMappings(detected));
    setLinkedPhysicalStatementIds({});
    confirmationAttemptRef.current = null;
    processingDeadlineRef.current = null;
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
      const previousCredential = credential;
      resetWorkflow("FILES");
      if (previousCredential) void closeCredential(effectAuthenticatedFetch, previousCredential);
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
    pollingFailuresRef.current = 0;
    processingDeadlineRef.current = Date.now() + maximumProcessingWaitMs;
    setStage("PREFLIGHT");
    let activeCredential: SessionCredential | null = null;
    try {
      const initResponse = await requestWithTimeout(
        authenticatedFetch,
        "/api/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: selectedCompanyId || companies[0]?.id }),
        },
        controlRequestTimeoutMs,
      );
      const initBody = await readResponse<{ session: PublicSession; token: string }>(initResponse);
      activeCredential = { id: initBody.session.id, token: initBody.token };
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

      const response = await requestWithTimeout(
        authenticatedFetch,
        `/api/sessions/${activeCredential.id}/preflight`,
        { method: "POST", headers: sessionHeaders(activeCredential) },
        heavyOperationTimeoutMs,
      );

      setPreflightActiveStep("MAPPING");
      setPreflightProgress(95);
      setPreflightStatusText("Cruzando contas contábeis com extratos bancários...");

      const body = await readResponse<{ session: PublicSession }>(response);
      setSession(body.session);
      const detected = body.session.preflight;
      if (detected) {
        showPreflight(detected);
      } else if (body.session.status === "QUEUED" || body.session.status === "PREFLIGHT") {
        setPreflightActiveStep("PARSING");
        setPreflightProgress((prev) => Math.max(prev, body.session.progress ?? 80));
        setPreflightStatusText(body.session.progressMessage || "Identificando estrutura, leiautes e contas...");
      }
    } catch (exception) {
      if (activeCredential) {
        try {
          const checkResponse = await authenticatedFetch(
            `/api/sessions/${activeCredential.id}/status`,
            { headers: sessionHeaders(activeCredential) },
          );
          if (checkResponse.ok) {
            const checkData = (await checkResponse.json()) as { session?: PublicSession };
            if (checkData.session?.preflight) {
              setSession(checkData.session);
              showPreflight(checkData.session.preflight);
              return;
            }
            if (["PREFLIGHT", "QUEUED", "EXTRACTING", "OCR_PROCESSING"].includes(checkData.session?.status ?? "")) {
              setPreflightStatusText(checkData.session?.progressMessage || "A leitura dos arquivos continua em andamento no servidor. Aguarde...");
              return;
            }
          }
        } catch {
          // ignora falha de verificação secundária
        }
      }
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
    const eligibleStatements = preflight.statements.filter((item) => item.reconciliationEligible);
    const ignoredCount = eligibleStatements.filter((item) => statementMappings[item.fileId] === "__IGNORE__").length;
    const mappedStatementCount = mappings.reduce((acc, m) => acc + m.statementFileIds.length, 0);
    if ((mappedStatementCount + ignoredCount) !== eligibleStatements.length) {
      setError("Selecione uma conta contábil para cada extrato elegível ou marque como ignorado.");
      return;
    }
    if (mappedStatementCount === 0) {
      setError("Ao menos um extrato deve ser mapeado para conciliação.");
      return;
    }
    setBusy(true);
    setError("");
    pollingFailuresRef.current = 0;
    processingDeadlineRef.current = Date.now() + maximumProcessingWaitMs;
    setStage("PROCESSING");
    try {
      const confirmation = {
        company,
        branch: branch || undefined,
        period,
        valueTolerance: valueTolerance.replace(",", "."),
        dateToleranceDays: Number(dateToleranceDays),
        mappings,
      };
      const fingerprint = JSON.stringify(confirmation);
      const idempotencyKey = confirmationAttemptRef.current?.fingerprint === fingerprint
        ? confirmationAttemptRef.current.idempotencyKey
        : crypto.randomUUID();
      confirmationAttemptRef.current = { fingerprint, idempotencyKey };
      const response = await requestWithTimeout(
        authenticatedFetch,
        `/api/sessions/${credential.id}/confirm-and-process`,
        {
          method: "POST",
          headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
          body: JSON.stringify({ ...confirmation, idempotencyKey }),
        },
        heavyOperationTimeoutMs,
      );
      const body = await readResponse<{ session: PublicSession }>(response);
      setSession(body.session);
      if (body.session.result) setHistoryRecordId(body.session.id);
      setResult(body.session.result ?? null);
      setStage(body.session.result ? "RESULTS" : "PROCESSING");
      void reloadHistory();
    } catch (exception) {
      if (credential) {
        try {
          const checkResponse = await authenticatedFetch(
            `/api/sessions/${credential.id}/status`,
            { headers: sessionHeaders(credential) },
          );
          if (checkResponse.ok) {
            const checkData = (await checkResponse.json()) as { session?: PublicSession };
            if (checkData.session?.result) {
              setSession(checkData.session);
              setHistoryRecordId(checkData.session.id);
              setResult(checkData.session.result);
              setStage("RESULTS");
              void reloadHistory();
              return;
            }
            if (["RECONCILING", "VALIDATING", "EXTRACTING", "OCR_PROCESSING", "QUEUED"].includes(checkData.session?.status ?? "")) {
              setStage("PROCESSING");
              return;
            }
          }
        } catch {
          // ignora falha secundária
        }
      }
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
    const previousCredential = credential;
    resetWorkflow("WELCOME");
    if (previousCredential) void closeCredential(authenticatedFetch, previousCredential);
    void reloadHistory();
  }

  function resetWorkflow(nextStage: Stage): void {
    setCredential(null);
    setSession(null);
    setResult(null);
    setPreflight(null);
    setLedgerFile(null);
    setStatementFiles([]);
    setStatementMappings({});
    setLinkedPhysicalStatementIds({});
    setCompany("");
    setBranch("");
    setPeriod("");
    setSelected(null);
    setSearch("");
    setActiveTab("CONCILIADOS");
    confirmationAttemptRef.current = null;
    pollingFailuresRef.current = 0;
    processingDeadlineRef.current = null;
    setStage(nextStage);
    setError("");
    setHistoryRecordId(null);
    setManualMatchItem(null);
    setBidirectionalMatchAnchor(null);
    setIsBidirectionalMatchOpen(false);
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

  async function handleManualMatch(
    selectedLedgerId: string,
    selectedStatementId: string,
    autoMatchRemaining: boolean,
  ): Promise<void> {
    if (!result || !manualMatchItem) return;

    const ambiguityGroup = manualMatchItem.ambiguityGroup;
    const allCandidateLedgers: LedgerRecord[] =
      manualMatchItem.ledgers && manualMatchItem.ledgers.length > 0
        ? [...manualMatchItem.ledgers]
        : manualMatchItem.ledger
        ? [manualMatchItem.ledger]
        : [];

    const allCandidateStatements: StatementRecord[] =
      manualMatchItem.statements && manualMatchItem.statements.length > 0
        ? [...manualMatchItem.statements]
        : manualMatchItem.statement
        ? [manualMatchItem.statement]
        : [];

    if (ambiguityGroup?.id) {
      const groupRows = result.results.filter((r) => r.ambiguityGroup?.id === ambiguityGroup.id);
      for (const r of groupRows) {
        const rLedgers = r.ledgers ?? (r.ledger ? [r.ledger] : []);
        for (const l of rLedgers) {
          if (!allCandidateLedgers.some((item) => item.id === l.id)) {
            allCandidateLedgers.push(l);
          }
        }
        const rStatements = r.statements ?? (r.statement ? [r.statement] : []);
        for (const s of rStatements) {
          if (!allCandidateStatements.some((item) => item.id === s.id)) {
            allCandidateStatements.push(s);
          }
        }
      }
    }

    const selectedLedger = allCandidateLedgers.find((l) => l.id === selectedLedgerId);
    const selectedStatement = allCandidateStatements.find((s) => s.id === selectedStatementId);

    if (!selectedLedger || !selectedStatement) return;

    const primaryReconciled: ReconciliationResult = {
      id: `MANUAL_${selectedStatement.id}_${selectedLedger.id}`,
      status: "AUTO_MATCH_EXACT",
      rule: "MANUAL",
      decisionLevel: "AUTOMATIC",
      reason: "Conciliado manualmente pelo usuário na conferência de ambiguidades.",
      ledger: selectedLedger,
      statement: selectedStatement,
      ledgers: [selectedLedger],
      statements: [selectedStatement],
      valueTolerance: "0.00",
      valueDifference: "0.00",
      ruleVersion: "1.0",
    };

    const remainingLedgers = allCandidateLedgers.filter((l) => l.id !== selectedLedgerId);
    const remainingStatements = allCandidateStatements.filter((s) => s.id !== selectedStatementId);

    const newResultsToAdd: ReconciliationResult[] = [primaryReconciled];

    if (autoMatchRemaining && remainingLedgers.length === 1 && remainingStatements.length === 1) {
      const remL = remainingLedgers[0]!;
      const remS = remainingStatements[0]!;
      newResultsToAdd.push({
        id: `MANUAL_${remS.id}_${remL.id}`,
        status: "AUTO_MATCH_EXACT",
        rule: "MANUAL",
        decisionLevel: "AUTOMATIC",
        reason: "Conciliado manualmente pelo usuário (par restante do grupo de ambiguidade).",
        ledger: remL,
        statement: remS,
        ledgers: [remL],
        statements: [remS],
        valueTolerance: "0.00",
        valueDifference: "0.00",
        ruleVersion: "1.0",
      });
    } else {
      if (remainingStatements.length === 0 && remainingLedgers.length > 0) {
        for (const remL of remainingLedgers) {
          newResultsToAdd.push({
            id: `LEDGER_WITHOUT_STATEMENT_${remL.id}`,
            status: "LEDGER_WITHOUT_STATEMENT",
            rule: "RF-09",
            decisionLevel: "REVIEW_REQUIRED",
            reason: "Lançamento do razão sem correspondência no extrato após conciliação manual.",
            ledger: remL,
            ledgers: [remL],
            valueTolerance: "0.00",
            ruleVersion: "1.0",
          });
        }
      } else if (remainingLedgers.length === 0 && remainingStatements.length > 0) {
        for (const remS of remainingStatements) {
          newResultsToAdd.push({
            id: `STATEMENT_WITHOUT_LEDGER_${remS.id}`,
            status: "STATEMENT_WITHOUT_LEDGER",
            rule: "RF-09",
            decisionLevel: "REVIEW_REQUIRED",
            reason: "Movimento de extrato sem correspondência no razão após conciliação manual.",
            statement: remS,
            statements: [remS],
            valueTolerance: "0.00",
            ruleVersion: "1.0",
          });
        }
      } else if (remainingLedgers.length > 0 && remainingStatements.length > 0) {
        const updatedGroup = ambiguityGroup
          ? {
              ...ambiguityGroup,
              ledgerCandidateIds: remainingLedgers.map((l) => l.id),
              statementCandidateIds: remainingStatements.map((s) => s.id),
              reason: `Há ${remainingLedgers.length} lançamento(s) no razão e ${remainingStatements.length} movimento(s) no extrato com o mesmo valor após conciliação manual parcial.`,
            }
          : undefined;

        for (const remL of remainingLedgers) {
          newResultsToAdd.push({
            id: `AMBIGUOUS_${updatedGroup?.id ?? "GRP"}_${remL.id}`,
            status: "AMBIGUOUS_MATCH",
            rule: "RF-02",
            decisionLevel: "REVIEW_REQUIRED",
            reason: updatedGroup?.reason ?? "Ambiguidade remanescente após conciliação manual parcial.",
            ledger: remL,
            ledgers: remainingLedgers,
            statements: remainingStatements,
            ...(updatedGroup ? { ambiguityGroup: updatedGroup } : {}),
            valueTolerance: "0.00",
            ruleVersion: "1.0",
          });
        }
        for (const remS of remainingStatements) {
          newResultsToAdd.push({
            id: `AMBIGUOUS_${updatedGroup?.id ?? "GRP"}_${remS.id}`,
            status: "AMBIGUOUS_MATCH",
            rule: "RF-02",
            decisionLevel: "REVIEW_REQUIRED",
            reason: updatedGroup?.reason ?? "Ambiguidade remanescente após conciliação manual parcial.",
            statement: remS,
            ledgers: remainingLedgers,
            statements: remainingStatements,
            ...(updatedGroup ? { ambiguityGroup: updatedGroup } : {}),
            valueTolerance: "0.00",
            ruleVersion: "1.0",
          });
        }
      }
    }

    const groupLedgerIds = new Set(allCandidateLedgers.map((l) => l.id));
    const groupStatementIds = new Set(allCandidateStatements.map((s) => s.id));
    const ambiguityGroupId = ambiguityGroup?.id;

    const filteredExistingResults = result.results.filter((r) => {
      if (ambiguityGroupId && r.ambiguityGroup?.id === ambiguityGroupId) {
        return false;
      }
      if (r.id === manualMatchItem.id) {
        return false;
      }
      if (
        r.status === "AMBIGUOUS_MATCH" &&
        ((r.ledger && groupLedgerIds.has(r.ledger.id)) ||
          (r.statement && groupStatementIds.has(r.statement.id)))
      ) {
        return false;
      }
      return true;
    });

    const updatedResultsList = [...filteredExistingResults, ...newResultsToAdd];

    const updatedProcessingResult: ProcessingResult = {
      ...result,
      results: updatedResultsList,
    };

    setResult(updatedProcessingResult);
    setManualMatchItem(null);
    if (selected?.id === manualMatchItem.id) {
      setSelected(null);
    }

    try {
      if (historyRecordId) {
        await authenticatedFetch(`/api/reconciliation-history/${historyRecordId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result: updatedProcessingResult }),
        });
      } else if (credential) {
        await authenticatedFetch(`/api/sessions/${credential.id}/results`, {
          method: "PATCH",
          headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
          body: JSON.stringify({ result: updatedProcessingResult }),
        });
      }
    } catch (err) {
      console.warn("Não foi possível persistir a conciliação manual no backend:", err);
    }
  }

  async function handleBidirectionalMatch(
    selectedStatementIds: string[],
    selectedLedgerIds: string[],
    justification?: string,
  ): Promise<void> {
    if (!result || selectedStatementIds.length === 0 || selectedLedgerIds.length === 0) return;

    const stmtIdSet = new Set(selectedStatementIds);
    const ledgIdSet = new Set(selectedLedgerIds);

    const foundStatements: StatementRecord[] = [];
    const foundLedgers: LedgerRecord[] = [];
    const seenS = new Set<string>();
    const seenL = new Set<string>();

    for (const r of result.results) {
      const rowStmts = r.statements ?? (r.statement ? [r.statement] : []);
      for (const s of rowStmts) {
        if (stmtIdSet.has(s.id) && !seenS.has(s.id)) {
          seenS.add(s.id);
          foundStatements.push(s);
        }
      }
      const rowLedgs = r.ledgers ?? (r.ledger ? [r.ledger] : []);
      for (const l of rowLedgs) {
        if (ledgIdSet.has(l.id) && !seenL.has(l.id)) {
          seenL.add(l.id);
          foundLedgers.push(l);
        }
      }
    }

    if (foundStatements.length === 0 || foundLedgers.length === 0) return;

    const totalStmtCents = foundStatements.reduce((acc, s) => acc + Math.round(Number(s.value) * 100), 0);
    const totalLedgCents = foundLedgers.reduce((acc, l) => acc + Math.round(Number(l.value) * 100), 0);
    const diffCents = Math.abs(totalStmtCents - totalLedgCents);
    const diffVal = (diffCents / 100).toFixed(2);
    const isGroup = foundStatements.length > 1 || foundLedgers.length > 1;

    let daysDiff = 0;
    if (foundStatements.length === 1 && foundLedgers.length === 1) {
      try {
        const t1 = new Date(`${foundStatements[0]!.date.slice(0, 10)}T00:00:00.000Z`).getTime();
        const t2 = new Date(`${foundLedgers[0]!.date.slice(0, 10)}T00:00:00.000Z`).getTime();
        if (!Number.isNaN(t1) && !Number.isNaN(t2)) {
          daysDiff = Math.round(Math.abs(t1 - t2) / (1000 * 60 * 60 * 24));
        }
      } catch {
        daysDiff = 0;
      }
    }

    const primaryStatus = isGroup
      ? "AUTO_MATCH_GROUP"
      : diffCents === 0
      ? "AUTO_MATCH_EXACT"
      : "AUTO_MATCH_DATE_TOLERANCE";

    const reasonText = justification?.trim()
      ? `Conciliado manualmente: ${justification.trim()}`
      : isGroup
      ? `Conciliado manualmente em grupo pelo usuário (${foundStatements.length} extrato × ${foundLedgers.length} razão).`
      : "Conciliado manualmente pelo usuário entre pendências de extrato e razão.";

    const primaryReconciled: ReconciliationResult = {
      id: isGroup
        ? `MANUAL_GROUP_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        : `MANUAL_${foundStatements[0]!.id}_${foundLedgers[0]!.id}`,
      status: primaryStatus,
      rule: isGroup ? "MANUAL_GROUP" : "MANUAL",
      decisionLevel: "AUTOMATIC",
      reason: reasonText,
      ledger: foundLedgers[0]!,
      statement: foundStatements[0]!,
      ledgers: foundLedgers,
      statements: foundStatements,
      valueTolerance: diffVal,
      valueDifference: diffVal,
      dateDifference: daysDiff,
      ruleVersion: "2.0-manual",
    };

    const updatedResultsList = result.results.filter((r) => {
      if (r.status === "STATEMENT_WITHOUT_LEDGER") {
        if (r.statement && stmtIdSet.has(r.statement.id)) return false;
        if (r.statements && r.statements.some((s) => stmtIdSet.has(s.id))) return false;
        if (selectedStatementIds.some((id) => r.id === `STATEMENT_WITHOUT_LEDGER_${id}`)) return false;
      }
      if (r.status === "LEDGER_WITHOUT_STATEMENT") {
        if (r.ledger && ledgIdSet.has(r.ledger.id)) return false;
        if (r.ledgers && r.ledgers.some((l) => ledgIdSet.has(l.id))) return false;
        if (selectedLedgerIds.some((id) => r.id === `LEDGER_WITHOUT_STATEMENT_${id}`)) return false;
      }
      return true;
    });

    updatedResultsList.push(primaryReconciled);

    const ledgerAccountCounts = new Map<string, { ledgers: number; statements: number; ledgerVal: number }>();
    for (const l of foundLedgers) {
      const acct = l.ledgerAccount || "DEFAULT";
      const curr = ledgerAccountCounts.get(acct) || { ledgers: 0, statements: 0, ledgerVal: 0 };
      curr.ledgers += 1;
      curr.ledgerVal += Number(l.value);
      ledgerAccountCounts.set(acct, curr);
    }
    const primaryLedgerAccount = foundLedgers[0]?.ledgerAccount;
    if (primaryLedgerAccount) {
      const curr = ledgerAccountCounts.get(primaryLedgerAccount);
      if (curr) {
        curr.statements += foundStatements.length;
      }
    }

    const updatedSummaries = result.summaries?.map((summary) => {
      const countData = ledgerAccountCounts.get(summary.ledgerAccount);
      if (countData || result.summaries.length === 1) {
        const ledgersMatched = countData?.ledgers ?? foundLedgers.length;
        const statementsMatched = countData?.statements ?? foundStatements.length;
        const valueMatched = countData?.ledgerVal ?? (totalLedgCents / 100);

        return {
          ...summary,
          reconciledCount: summary.reconciledCount + 1,
          reconciledValue: (Number(summary.reconciledValue) + valueMatched).toFixed(2),
          ledgerWithoutStatementCount: Math.max(0, summary.ledgerWithoutStatementCount - ledgersMatched),
          statementWithoutLedgerCount: Math.max(0, summary.statementWithoutLedgerCount - statementsMatched),
        };
      }
      return summary;
    });

    const updatedProcessingResult: ProcessingResult = {
      ...result,
      results: updatedResultsList,
      ...(updatedSummaries ? { summaries: updatedSummaries } : {}),
    };

    setResult(updatedProcessingResult);
    setIsBidirectionalMatchOpen(false);
    setBidirectionalMatchAnchor(null);
    if (selected && (stmtIdSet.has(selected.id) || ledgIdSet.has(selected.id))) {
      setSelected(null);
    }

    try {
      if (historyRecordId) {
        await authenticatedFetch(`/api/reconciliation-history/${historyRecordId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result: updatedProcessingResult }),
        });
      } else if (credential) {
        await authenticatedFetch(`/api/sessions/${credential.id}/results`, {
          method: "PATCH",
          headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
          body: JSON.stringify({ result: updatedProcessingResult }),
        });
      }
    } catch (err) {
      console.warn("Não foi possível persistir a conciliação manual no backend:", err);
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
            <span
              className="badge"
              style={{
                background: "#DCFCE7",
                color: "#166534",
                border: "1px solid #86EFAC",
                fontWeight: 600,
                fontSize: "12px",
                padding: "3px 8px",
              }}
            >
              Modo Local
            </span>
          </div>
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
              <>
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
                  onOpenManualMatch={(item) => {
                    if (item.status === "STATEMENT_WITHOUT_LEDGER" || item.status === "LEDGER_WITHOUT_STATEMENT") {
                      setBidirectionalMatchAnchor(item);
                      setIsBidirectionalMatchOpen(true);
                    } else {
                      setManualMatchItem(item);
                    }
                  }}
                  onOpenBidirectionalMatch={(item) => {
                    setBidirectionalMatchAnchor(item);
                    setIsBidirectionalMatchOpen(true);
                  }}
                />
                {manualMatchItem && (
                  <ManualMatchModal
                    item={manualMatchItem}
                    onClose={() => setManualMatchItem(null)}
                    onConfirm={handleManualMatch}
                  />
                )}
                {isBidirectionalMatchOpen && (
                  <BidirectionalMatchModal
                    anchorItem={bidirectionalMatchAnchor}
                    allResults={result.results}
                    onClose={() => {
                      setIsBidirectionalMatchOpen(false);
                      setBidirectionalMatchAnchor(null);
                    }}
                    onConfirm={handleBidirectionalMatch}
                  />
                )}
              </>
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
      <EvidenceDrawer
        selected={selected}
        onClose={() => setSelected(null)}
        onOpenManualMatch={(item) => {
          if (item.status === "STATEMENT_WITHOUT_LEDGER" || item.status === "LEDGER_WITHOUT_STATEMENT") {
            setBidirectionalMatchAnchor(item);
            setIsBidirectionalMatchOpen(true);
          } else {
            setManualMatchItem(item);
          }
        }}
      />
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

function canPrepare(_company: AuthorizedCompany): boolean {
  return true;
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

  const handleRemove = (event: React.MouseEvent, index: number) => {
    event.stopPropagation();
    event.preventDefault();
    const next = [...files];
    next.splice(index, 1);
    onFiles(next);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(event.target.files ?? []);
    if (multiple) {
      onFiles([...files, ...newFiles]);
    } else {
      onFiles(newFiles);
    }
    event.target.value = "";
    if (inputRef.current) {
      inputRef.current.value = "";
    }
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
    if (inputRef.current) {
      inputRef.current.value = "";
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
                onClick={(event) => handleRemove(event, i)}
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
  const ignoredCount = currentAccountStatements.filter((item) => props.statementMappings[item.fileId] === "__IGNORE__").length;
  const mappedStatementCount = confirmedMappings(props.preflight, props.statementMappings, props.linkedPhysicalStatementIds).reduce(
    (acc, m) => acc + m.statementFileIds.length,
    0,
  );
  const mappingsComplete = (mappedStatementCount + ignoredCount) === currentAccountStatements.length && mappedStatementCount > 0;
  const identityMappingsConfirmed = confirmedIdentityMappings(props.preflight, props.statementMappings, props.linkedPhysicalStatementIds);
  const hasPartialIdentity = partialIdentityMappings(props.preflight, props.statementMappings);

  const isAutoMatched =
    mappingsComplete && identityMappingsConfirmed && props.period !== "" && mappedStatementCount > 0 && !blocked && !Object.values(props.linkedPhysicalStatementIds).some(Boolean);

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
        <Metric label="Extratos conciliáveis" value={currentAccountStatements.length} />
        <Metric label="Informativos / Sem movimento" value={investmentStatements.length} />
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
            {selectedLedger && (
              <div className="text-muted text-sm">
                Competência: {props.period ? formatPeriod(props.period) : "selecione"} · Perfil aplicado:{" "}
                {knownCategoricalValueLabel(signProfileForLedger(selectedLedger))}
              </div>
            )}
            {props.statementMappings[statement.fileId] === "__IGNORE__" && (
              <div className="text-muted text-sm" style={{ color: "var(--warning)" }}>
                Extrato desconsiderado para a conciliação desta execução.
              </div>
            )}
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
              <option value="__IGNORE__">[Ignorar este extrato nesta execução]</option>
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
          <h3 style={{ marginTop: "20px", fontSize: "15px" }}>Extratos e Documentos Informativos</h3>
          <div className="notice info">
            Estes documentos são informativos (sem movimentações no período ou relatórios de investimento) e não geram lançamentos para conciliação.
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
              <span className="badge badge-secondary">
                {statement.recordCount === 0 || statement.classification === "CURRENT_ACCOUNT"
                  ? "Sem movimentação"
                  : documentKindLabel(statement.classification)}
              </span>
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
  onOpenManualMatch: (item: ReconciliationResult) => void;
  onOpenBidirectionalMatch?: (item: ReconciliationResult | null) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(25);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [subFilter, setSubFilter] = useState<"TODOS" | "EXATOS" | "GRUPOS" | "PROXIMIDADE" | "TOTAL_DIARIO" | "COMPENSADOS">("TODOS");

  useEffect(() => {
    setVisibleCount(25);
  }, [props.activeTab, props.search, subFilter]);

  const controls = props.result.controls;

  const totalStatementLines =
    controls?.coverage.statementTotal?.lines.total ??
    controls?.coverage.statementOperational?.lines.total ??
    String(
      props.result.files.reduce((acc, f) => acc + (f.recordCount ?? 0), 0) ||
      props.result.results.filter((r) => r.statement || (r.statements && r.statements.length)).length,
    );

  const totalLedgerLines =
    controls?.coverage.ledger?.lines.total ??
    String(props.result.results.filter((r) => r.ledger || (r.ledgers && r.ledgers.length)).length);

  const counts = useMemo(() => {
    let exact = 0;
    let groups = 0;
    let dateTolerance = 0;
    let dailyTotal = 0;
    let netZero = 0;
    let statementWithoutLedger = 0;
    let ledgerWithoutStatement = 0;
    let ambiguities = 0;
    let autoApplications = 0;

    for (const r of props.result.results) {
      if (r.status === "AUTO_MATCH_EXACT" || r.status === "AUTO_MATCH_UNIQUE_VALUE") exact++;
      else if (r.status === "AUTO_MATCH_GROUP" || r.status === "GROUP_SUGGESTION") groups++;
      else if (r.status === "AUTO_MATCH_DATE_TOLERANCE") dateTolerance++;
      else if (r.status === "AUTO_MATCH_DAILY_TOTAL") dailyTotal++;
      else if (r.status === "BANK_NET_ZERO") netZero++;
      else if (r.status === "STATEMENT_WITHOUT_LEDGER") statementWithoutLedger++;
      else if (r.status === "LEDGER_WITHOUT_STATEMENT") ledgerWithoutStatement++;
      else if (r.status === "AMBIGUOUS_MATCH" || r.status === "POSSIBLE_DUPLICATE") ambiguities++;
      else if (r.status === "AUTO_APPLICATION_EXCLUDED") autoApplications++;
    }

    const allReconciled = exact + groups + dateTolerance + dailyTotal + netZero;

    return {
      exact,
      groups,
      dateTolerance,
      dailyTotal,
      netZero,
      allReconciled,
      statementWithoutLedger,
      ledgerWithoutStatement,
      ambiguities,
      autoApplications,
    };
  }, [props.result.results]);

  const itemsToDisplay = useMemo(() => {
    if (props.activeTab !== "CONCILIADOS" || subFilter === "TODOS") {
      return props.visible;
    }
    if (subFilter === "EXATOS") {
      return props.visible.filter((item) => item.status === "AUTO_MATCH_EXACT" || item.status === "AUTO_MATCH_UNIQUE_VALUE");
    }
    if (subFilter === "GRUPOS") {
      return props.visible.filter((item) => item.status === "AUTO_MATCH_GROUP" || item.status === "GROUP_SUGGESTION");
    }
    if (subFilter === "PROXIMIDADE") {
      return props.visible.filter((item) => item.status === "AUTO_MATCH_DATE_TOLERANCE");
    }
    if (subFilter === "TOTAL_DIARIO") {
      return props.visible.filter((item) => item.status === "AUTO_MATCH_DAILY_TOTAL");
    }
    if (subFilter === "COMPENSADOS") {
      return props.visible.filter((item) => item.status === "BANK_NET_ZERO");
    }
    return props.visible;
  }, [props.visible, props.activeTab, subFilter]);

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

        {/* Cards de Indicadores Objetivos */}
        <div className="summary-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
          <div className="metric">
            <span className="label">Linhas do Extrato</span>
            <strong className="value">{totalStatementLines}</strong>
          </div>
          <div className="metric">
            <span className="label">Linhas do Razão</span>
            <strong className="value">{totalLedgerLines}</strong>
          </div>
          <div className="metric" style={{ borderColor: "#86EFAC", background: "#F0FDF4" }}>
            <span className="label" style={{ color: "#166534" }}>Conciliados</span>
            <strong className="value" style={{ color: "#166534" }}>{counts.allReconciled}</strong>
          </div>
          <div className="metric" style={{ borderColor: counts.statementWithoutLedger > 0 ? "#FDBA74" : undefined, background: counts.statementWithoutLedger > 0 ? "#FFF7ED" : undefined }}>
            <span className="label" style={{ color: counts.statementWithoutLedger > 0 ? "#C2410C" : undefined }}>Extrato sem razão</span>
            <strong className="value" style={{ color: counts.statementWithoutLedger > 0 ? "#C2410C" : undefined }}>{counts.statementWithoutLedger}</strong>
          </div>
          <div className="metric" style={{ borderColor: counts.ledgerWithoutStatement > 0 ? "#FDBA74" : undefined, background: counts.ledgerWithoutStatement > 0 ? "#FFF7ED" : undefined }}>
            <span className="label" style={{ color: counts.ledgerWithoutStatement > 0 ? "#C2410C" : undefined }}>Razão sem extrato</span>
            <strong className="value" style={{ color: counts.ledgerWithoutStatement > 0 ? "#C2410C" : undefined }}>{counts.ledgerWithoutStatement}</strong>
          </div>
          <div className="metric" style={{ borderColor: counts.ambiguities > 0 ? "#93C5FD" : undefined, background: counts.ambiguities > 0 ? "#1D4ED8" : undefined }}>
            <span className="label" style={{ color: counts.ambiguities > 0 ? "#1D4ED8" : undefined }}>Ambiguidades</span>
            <strong className="value" style={{ color: counts.ambiguities > 0 ? "#1D4ED8" : undefined }}>{counts.ambiguities}</strong>
          </div>
        </div>

        {/* Métricas Contábeis Detalhadas Opcionais (Sem poluição por padrão) */}
        {controls && (
          <details style={{ marginTop: "4px", marginBottom: "8px" }}>
            <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-muted)", fontWeight: 600, padding: "4px 0" }}>
              Ver métricas financeiras detalhadas e saldos
            </summary>
            <div className="summary-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginTop: "12px" }}>
              <Metric label="Movimentação do banco (líquida)" value={formatCurrency(Number(controls.movements.bankConciliable))} />
              <Metric label="Movimentação do razão (líquida)" value={formatCurrency(Number(controls.movements.ledger))} />
              <Metric label="Diferença banco × razão" value={formatCurrency(Number(controls.movements.difference))} />
              <Metric label="Diferença de saldo final" value={controls.balances.closingDifference === undefined ? "Não disponível" : formatCurrency(Number(controls.balances.closingDifference))} />
              <Metric label="Cobertura confirmada" value={`${controls.coverage.overallOperational?.lines.percentage ?? controls.coverage.lines.percentage}%`} />
              <Metric label="Cobertura potencial" value={controls.coverage.potential?.overallOperational ? `${controls.coverage.potential.overallOperational.lines.percentage}%` : "Não disponível"} />
              <Metric label="Linhas em sugestões" value={controls.coverage.suggested?.overallOperational ? `${controls.coverage.suggested.overallOperational.lines.covered} para revisão` : "0"} />
              <Metric label="Ambiguidades por valor" value={String(counts.ambiguities)} />
              <Metric label="Cobertura do razão" value={controls.coverage.ledger ? `${controls.coverage.ledger.lines.percentage}%` : `${controls.coverage.lines.percentage}%`} />
              <Metric label="Cobertura do extrato operacional" value={controls.coverage.statementOperational ? `${controls.coverage.statementOperational.lines.percentage}%` : `${controls.coverage.lines.percentage}%`} />
            </div>
          </details>
        )}
      </section>

      <section className="card panel" style={{ marginTop: 16 }}>
        <div className="tabs" role="tablist">
          {tabs.map((tab) => {
            const count =
              tab.id === "CONCILIADOS"
                ? counts.allReconciled
                : tab.id === "EXTRATO_SEM_RAZAO"
                ? counts.statementWithoutLedger
                : tab.id === "RAZAO_SEM_EXTRATO"
                ? counts.ledgerWithoutStatement
                : tab.id === "AMBIGUIDADES"
                ? counts.ambiguities
                : tab.id === "APLICACOES"
                ? counts.autoApplications
                : null;

            if (tab.id === "APLICACOES" && count === 0) return null;

            return (
              <button
                role="tab"
                aria-selected={props.activeTab === tab.id}
                className={`tab ${props.activeTab === tab.id ? "active" : ""}`}
                key={tab.id}
                onClick={() => {
                  props.setActiveTab(tab.id);
                  if (tab.id !== "CONCILIADOS") setSubFilter("TODOS");
                }}
              >
                {tab.label}
                {count !== null && <span className="tab-badge">{count}</span>}
              </button>
            );
          })}
        </div>

        {props.activeTab === "ARQUIVOS_ERROS" ? (
          <FilesAndErrors result={props.result} />
        ) : props.activeTab === "INVESTIMENTOS" ? (
          <Investments entries={props.result.investments} />
        ) : (
          <>
            {(props.activeTab === "EXTRATO_SEM_RAZAO" || props.activeTab === "RAZAO_SEM_EXTRATO") && props.onOpenBidirectionalMatch && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  marginBottom: "12px",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: "13px", color: "#1E40AF" }}>
                  💡 <strong>Conciliação Manual Bidirecional:</strong> Localize e cruze pendências entre extrato e razão com filtros avançados de valor, data e histórico.
                </div>
                <button
                  type="button"
                  className="button btn-sm"
                  onClick={() => props.onOpenBidirectionalMatch?.(null)}
                >
                  🔍 Abrir conciliação manual
                </button>
              </div>
            )}
            {props.activeTab === "CONCILIADOS" && (
              <div className="subtabs-bar" role="toolbar" aria-label="Filtro de conciliados">
                <button
                  type="button"
                  className={`subtab-btn ${subFilter === "TODOS" ? "active" : ""}`}
                  onClick={() => setSubFilter("TODOS")}
                >
                  Todos ({counts.allReconciled})
                </button>
                <button
                  type="button"
                  className={`subtab-btn ${subFilter === "EXATOS" ? "active" : ""}`}
                  onClick={() => setSubFilter("EXATOS")}
                >
                  Exatos 1:1 ({counts.exact})
                </button>
                <button
                  type="button"
                  className={`subtab-btn ${subFilter === "GRUPOS" ? "active" : ""}`}
                  onClick={() => setSubFilter("GRUPOS")}
                >
                  Lotes / Desdobros ({counts.groups})
                </button>
                {counts.dateTolerance > 0 && (
                  <button
                    type="button"
                    className={`subtab-btn ${subFilter === "PROXIMIDADE" ? "active" : ""}`}
                    onClick={() => setSubFilter("PROXIMIDADE")}
                  >
                    Por Data ({counts.dateTolerance})
                  </button>
                )}
                {counts.dailyTotal > 0 && (
                  <button
                    type="button"
                    className={`subtab-btn ${subFilter === "TOTAL_DIARIO" ? "active" : ""}`}
                    onClick={() => setSubFilter("TOTAL_DIARIO")}
                  >
                    Total Diário ({counts.dailyTotal})
                  </button>
                )}
                {counts.netZero > 0 && (
                  <button
                    type="button"
                    className={`subtab-btn ${subFilter === "COMPENSADOS" ? "active" : ""}`}
                    onClick={() => setSubFilter("COMPENSADOS")}
                  >
                    Compensados ({counts.netZero})
                  </button>
                )}
              </div>
            )}

            <div className="table-tools">
              <input
                className="filter"
                value={props.search}
                onChange={(event) => props.setSearch(event.target.value)}
                placeholder="Filtrar por conta, documento, histórico ou valor..."
              />
            </div>

            {props.activeTab === "AMBIGUIDADES" && (
              <div className="notice warning">
                Cada grupo reúne candidatos com o mesmo valor. A aplicação não escolhe nenhum par automaticamente para evitar falso positivo contábil.
              </div>
            )}

            <div className="table-wrap">
              {itemsToDisplay.length ? (
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
                    {itemsToDisplay.slice(0, visibleCount).map((item) => (
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
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ display: "inline-flex", gap: "6px", alignItems: "center", justifyContent: "flex-end" }}>
                            {(item.status === "AMBIGUOUS_MATCH" || item.ambiguityGroup) && (
                              <button
                                type="button"
                                className="button btn-sm"
                                onClick={() => props.onOpenManualMatch(item)}
                              >
                                Conciliar manual
                              </button>
                            )}
                            {(item.status === "STATEMENT_WITHOUT_LEDGER" || item.status === "LEDGER_WITHOUT_STATEMENT") && props.onOpenBidirectionalMatch && (
                              <button
                                type="button"
                                className="button btn-sm"
                                onClick={() => props.onOpenBidirectionalMatch?.(item)}
                              >
                                {item.status === "STATEMENT_WITHOUT_LEDGER" ? "Buscar no Razão" : "Buscar no Extrato"}
                              </button>
                            )}
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
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">Nenhum item nesta categoria.</div>
              )}
            </div>

            {itemsToDisplay.length > visibleCount && (
              <div className="actions" style={{ marginTop: "16px" }}>
                <button className="button secondary" onClick={() => setVisibleCount((count) => count + 25)}>
                  Mostrar mais registros ({itemsToDisplay.length - visibleCount} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {props.selected && (
        <Evidence
          item={props.selected}
          close={() => props.setSelected(null)}
          onOpenManualMatch={props.onOpenManualMatch}
        />
      )}
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

function Evidence({
  item,
  close,
  onOpenManualMatch,
}: {
  item: ReconciliationResult;
  close: () => void;
  onOpenManualMatch?: (item: ReconciliationResult) => void;
}) {
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
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {(item.status === "AMBIGUOUS_MATCH" || item.ambiguityGroup) && onOpenManualMatch && (
            <button
              type="button"
              className="button btn-sm"
              onClick={() => onOpenManualMatch(item)}
            >
              Conciliar este grupo manual
            </button>
          )}
          <button type="button" className="button secondary" onClick={close}>
            Fechar
          </button>
        </div>
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
    if (!account || account === "__IGNORE__") continue;
    const current = byAccount.get(account) ?? [];
    current.push(statement.fileId);
    byAccount.set(account, current);
  }

  const mappings: AccountMapping[] = [];
  for (const [account, statementFileIds] of byAccount.entries()) {
    const ledgerAccount = preflight.ledgerAccounts.find((item) => item.account === account);
    const signProfile = signProfileForLedger(ledgerAccount);

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

export function preferredPreflightPeriod(preflight: PreflightResult): string {
  const available = new Set(preflight.detectedPeriods.map((item) => item.period));
  const statementPeriodSets = preflight.statements
    .filter((item) => item.reconciliationEligible && item.periods.length > 0)
    .map((item) => new Set(item.periods.filter((period) => available.has(period))));

  if (statementPeriodSets.length > 0) {
    const common = [...statementPeriodSets[0]!].filter((period) =>
      statementPeriodSets.every((periods) => periods.has(period)),
    );
    if (common.length === 1) return common[0]!;

    const uniqueStatementPeriods = new Set(statementPeriodSets.flatMap((periods) => [...periods]));
    if (uniqueStatementPeriods.size === 1) return [...uniqueStatementPeriods][0]!;
  }

  return preflight.detectedPeriods.length === 1 ? preflight.detectedPeriods[0]!.period : "";
}

function signProfileForLedger(
  ledgerAccount: PreflightResult["ledgerAccounts"][number] | undefined,
): SignProfile {
  return ledgerAccount?.balanceMovementEffect === "SUBTRACTS_FROM_BALANCE"
    ? "BANK_LIABILITY"
    : "BANK_ASSET";
}

export function proposeStatementMappings(preflight: PreflightResult): Record<string, string> {
  const mappings: Record<string, string> = {};
  for (const statement of preflight.statements.filter((item) => item.reconciliationEligible)) {
    const matchingRegisteredLedgers = (preflight.registeredAccountMappings ?? [])
      .filter((mapping) => bankAccountsMatch(mapping, statement))
      .map((mapping) => mapping.ledgerAccount);

    const matchedLedgerAccounts = preflight.ledgerAccounts.filter((ledgerAccount) =>
      matchingRegisteredLedgers.some((registered) => ledgerAccountsMatch(ledgerAccount.account, registered)),
    );

    if (matchedLedgerAccounts.length === 1) {
      mappings[statement.fileId] = matchedLedgerAccounts[0]!.account;
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
  const activeStatements = eligibleStatements.filter((item) => statementMappings[item.fileId] !== "__IGNORE__");
  return activeStatements.length > 0 && activeStatements.every((statement) => {
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
  return preflight.statements
    .filter((item) => item.reconciliationEligible && statementMappings[item.fileId] !== "__IGNORE__")
    .some((statement) => {
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
    await requestWithTimeout(
      authenticatedFetch,
      `/api/sessions/${credential.id}/uploads/authorize`,
      {
        method: "POST",
        headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          originalName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      },
      controlRequestTimeoutMs,
    ),
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
  await readResponse(await requestWithTimeout(
    authenticatedFetch,
    `/api/sessions/${credential.id}/uploads/complete`,
    {
      method: "POST",
      headers: { ...sessionHeaders(credential), "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: authorized.file.id }),
    },
    controlRequestTimeoutMs,
  ));
}

async function closeCredential(authenticatedFetch: AuthenticatedFetch, credential: SessionCredential): Promise<void> {
  await requestWithTimeout(
    authenticatedFetch,
    `/api/sessions/${credential.id}/close`,
    { method: "POST", headers: sessionHeaders(credential), keepalive: true },
    controlRequestTimeoutMs,
  ).catch(() => undefined);
}

export async function requestWithTimeout(
  request: AuthenticatedFetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      request(input, { ...init, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error("O servidor demorou mais que o esperado para responder."));
        }, { once: true });
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
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

export function messageOf(value: unknown): string {
  if (value instanceof TypeError)
    return "Não foi possível conectar ao servidor local. Verifique se a aplicação está em execução e tente novamente.";
  if (value instanceof Error) {
    if (value.message.includes("demorou mais que o esperado")) {
      return "O processamento dos arquivos está levando mais tempo que o esperado devido ao volume de lançamentos. O servidor continua executando; aguarde alguns instantes ou tente novamente.";
    }
    return value.message;
  }
  return "Ocorreu uma inconsistência temporária ao processar a solicitação.";
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
