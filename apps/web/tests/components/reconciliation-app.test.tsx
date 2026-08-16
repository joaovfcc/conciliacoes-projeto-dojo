import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconciliationApp } from "../../src/components/reconciliation-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("ReconciliationApp", () => {
  it("explica a retenção autenticada antes de iniciar", () => {
    renderApp();
    expect(screen.getByText("Retenção controlada")).toBeInTheDocument();
    expect(screen.getByText("Resultados e evidências ficam disponíveis por um ano.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar nova conciliação" })).toBeDisabled();
  });

  it("limita a tolerância de data visualmente a três dias", () => {
    renderApp();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar nova conciliação" }));

    expect(screen.getByLabelText("Tolerância de data (dias)")).toHaveAttribute("max", "3");
  });

  it("apresenta status, regras, métodos e alertas somente em português", async () => {
    const result = {
      company: "EMPRESA",
      branch: "01",
      period: "202601",
      executedAt: "2026-01-31T12:00:00.000Z",
      summaries: [{ ledgerAccount: "111", statementAccounts: ["Itaú 0191/26775-6"], ledgerBalance: "10.00", statementBalance: "10.00", balanceDifference: "0.00", reconciledCount: 1, reconciledValue: "10.00", divergenceCount: 0, ledgerWithoutStatementCount: 0, statementWithoutLedgerCount: 0, ambiguityCount: 0, duplicateCount: 0, status: "CONCILIADA" }],
      results: [
        { id: "REC-1", status: "AUTO_MATCH_EXACT", rule: "RULE_1_EXACT", decisionLevel: "AUTOMATIC", reason: "Correspondência única.", valueTolerance: "0.01", ledger: { id: "l1", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-02", document: "123", history: "Recebimento", value: "10.00", sourceId: "l1", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 2 } }, statement: { id: "s1", bank: "ITAU", agency: "0191", bankAccount: "26775-6", date: "2026-01-02", document: "123", history: "Recebimento", value: "10.00", sourceId: "s1", evidence: { fileId: "statement", originalName: "itau.xlsx", extractionMethod: "TABULAR", line: 2, parser: "itau-checking-xlsx-v1" } } },
        { id: "REC-2", status: "AUTO_MATCH_DATE_TOLERANCE", rule: "RF-03", decisionLevel: "AUTOMATIC", reason: "Proximidade.", valueTolerance: "0.00" },
        { id: "REC-3", status: "AUTO_MATCH_GROUP", rule: "RF-04", decisionLevel: "AUTOMATIC", reason: "Grupo.", valueTolerance: "0.00", ledgers: [
          { id: "l2", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-03", document: "", history: "Principal do grupo", value: "6.00", sourceId: "l2", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 3 } },
          { id: "l3", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-03", document: "", history: "Juros do grupo", value: "4.00", sourceId: "l3", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 4 } },
        ] },
        { id: "REC-4", status: "AUTO_MATCH_DAILY_TOTAL", rule: "RF-07", decisionLevel: "AUTOMATIC", reason: "Total diário.", valueTolerance: "0.00" },
        { id: "REC-5", status: "BANK_NET_ZERO", rule: "RF-08", decisionLevel: "AUTOMATIC", reason: "Compensado.", valueTolerance: "0.00" },
        { id: "REC-6", status: "AUTO_APPLICATION_EXCLUDED", rule: "RF-01", decisionLevel: "AUTOMATIC", reason: "Aplicação.", valueTolerance: "0.00" },
        { id: "REC-7", status: "LEDGER_WITHOUT_STATEMENT", rule: "RF-09", decisionLevel: "REVIEW_REQUIRED", reason: "Razão.", valueTolerance: "0.00" },
        { id: "REC-8", status: "STATEMENT_WITHOUT_LEDGER", rule: "RF-09", decisionLevel: "REVIEW_REQUIRED", reason: "Extrato.", valueTolerance: "0.00" },
      ],
      issues: [{ severity: "ERROR", code: "LAYOUT_NOT_DETECTED", message: "Não foi possível identificar o leiaute.", fileId: "statement" }],
      files: [{ fileId: "statement", originalName: "itau.xlsx", bank: "ITAU", agency: "0191", account: "26775-6", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "itau-checking-xlsx-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
      investments: [],
      controls: { tolerance: "0.05", signProfiles: ["BANK_ASSET"], movements: { bankConciliable: "10.00", ledger: "10.00", difference: "0.00", status: "PASSED" }, balances: { bankClosing: "110.00", ledgerClosing: "110.00", closingDifference: "0.00", openingStatus: "NOT_AVAILABLE", closingStatus: "PASSED" }, coverage: { lines: { covered: "2", total: "2", percentage: "100.00" }, absoluteValue: { covered: "20.00", total: "20.00", percentage: "100.00" } }, countsByStatus: [{ status: "AUTO_MATCH_EXACT", count: "1" }], pendingByDate: [] },
    };
    const authenticatedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: "session-1", status: "CREATED" }, token: "token-1" }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "ledger", kind: "LEDGER" }, upload: { mode: "local", url: "/upload/ledger" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "ledger" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "statement", kind: "STATEMENT" }, upload: { mode: "local", url: "/upload/statement" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "statement" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: "session-1", status: "PREFLIGHT", preflight: preflight() } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: "session-1", status: "COMPLETED", result } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });

    renderApp(authenticatedFetch);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar nova conciliação" }));
    fireEvent.change(screen.getByLabelText("Tolerância de valor (R$)"), { target: { value: "0,01" } });
    fireEvent.change(screen.getByLabelText("Razão Protheus"), { target: { files: [new File(["ledger"], "razao.xlsx")] } });
    fireEvent.change(screen.getByLabelText("Extratos bancários"), { target: { files: [new File(["statement"], "itau.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Analisar arquivos" }));

    fireEvent.change(await screen.findByLabelText(/Conta contábil para itau.xlsx/), { target: { value: "111" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e conciliar" }));

    expect(await screen.findByText("Conciliação exata")).toBeInTheDocument();
    expect(authenticatedFetch).toHaveBeenCalledWith("/api/sessions/session-1/preflight", expect.objectContaining({
      headers: { "X-Reconciliation-Session-Token": "token-1" },
    }));
    expect(screen.getByRole("tab", { name: "Proximidade" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Grupos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Total diário" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Compensados" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Aplicações automáticas" })).toBeInTheDocument();
    expect(screen.getByText("Movimento bancário conciliável")).toBeInTheDocument();
    expect(screen.getAllByText("100.00%")).toHaveLength(2);
    for (const [tab, status] of [
      ["Proximidade", "Conciliação com tolerância de data"],
      ["Grupos", "Conciliação em grupo"],
      ["Total diário", "Conciliação por total diário"],
      ["Compensados", "Compensado no extrato"],
      ["Aplicações automáticas", "Excluído - aplicação automática"],
      ["Razão sem extrato", "Lançamento do razão sem correspondente no extrato"],
      ["Extrato sem razão", "Lançamento do extrato sem correspondente no razão"],
    ]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(await screen.findByText(status)).toBeInTheDocument();
      if (tab === "Grupos") {
        expect(screen.getByText(/Principal do grupo/)).toBeInTheDocument();
        expect(screen.getByText(/Juros do grupo/)).toBeInTheDocument();
      }
      if (tab === "Total diário") expect(screen.getByText(/não representa pareamento individual/)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Exatos" }));
    expect(screen.getByText("Regra 1 — documento, data e valor exatos")).toBeInTheDocument();
    expect(screen.queryByText("AUTO_MATCH_EXACT")).not.toBeInTheDocument();
    expect(screen.queryByText("RULE_1_EXACT")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver evidência" }));
    const evidence = await screen.findByRole("region", { name: "Evidência da conciliação REC-1" });
    expect(evidence).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    fireEvent.click(screen.getByRole("tab", { name: "Arquivos e erros" }));
    await waitFor(() => expect(screen.getByText("Planilha")).toBeInTheDocument());
    expect(screen.getByText("Leitor de planilha do Itaú")).toBeInTheDocument();
    expect(screen.getByText("Leiaute não identificado")).toBeInTheDocument();
    expect(screen.queryByText("TABULAR")).not.toBeInTheDocument();
    expect(screen.queryByText("LAYOUT_NOT_DETECTED")).not.toBeInTheDocument();
  });
});

function renderApp(authenticatedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))) {
  return render(<ReconciliationApp companies={[{ id: "company-1", organizationId: "org-1", name: "Empresa", roles: ["ADMIN"] }]} userEmail="owner@example.com" logout={vi.fn()} authenticatedFetch={authenticatedFetch} />);
}

function preflight() {
  return {
    companies: ["EMPRESA"],
    branches: ["01"],
    ledgerAccounts: [{ account: "111", company: "EMPRESA", branch: "01", bank: "ITAU", agency: "0191", bankAccount: "26775-6", recordCount: 2 }],
    detectedPeriods: [{ period: "202601", recordCount: 2 }],
    statements: [{ fileId: "statement", originalName: "itau.xlsx", bank: "ITAU", agency: "0191", account: "26775-6", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR", parser: "itau-checking-xlsx-v1", classification: "CURRENT_ACCOUNT", reconciliationEligible: true }],
    investments: [],
    issues: [],
    requiresUserInput: false,
  };
}
