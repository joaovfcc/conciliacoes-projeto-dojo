import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconciliationApp } from "../../src/components/reconciliation-app";
import type { PreflightResult, ProcessingResult } from "@conciliacao/core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function mockPreflight(): PreflightResult {
  return {
    companies: ["EMPRESA TESTE"],
    branches: ["01"],
    detectedPeriods: [{ period: "202601", recordCount: 1 }],
    ledgerAccounts: [
      {
        company: "EMPRESA TESTE",
        branch: "01",
        account: "111",
        bank: "ITAU",
        agency: "0191",
        bankAccount: "26775-6",
        recordCount: 1,
      },
    ],
    statements: [
      {
        fileId: "statement",
        originalName: "itau.xlsx",
        classification: "CURRENT_ACCOUNT",
        reconciliationEligible: true,
        bank: "ITAU",
        agency: "0191",
        account: "26775-6",
        periods: ["202601"],
        recordCount: 1,
      },
    ],
    investments: [],
    issues: [],
    requiresUserInput: false,
  };
}

function mockResult(): ProcessingResult {
  return {
    company: "EMPRESA TESTE",
    branch: "01",
    period: "202601",
    executedAt: "2026-01-31T12:00:00.000Z",
    summaries: [
      {
        ledgerAccount: "111",
        statementAccounts: ["Itaú 0191/26775-6"],
        ledgerBalance: "10.00",
        statementBalance: "10.00",
        balanceDifference: "0.00",
        reconciledCount: 1,
        reconciledValue: "10.00",
        divergenceCount: 0,
        ledgerWithoutStatementCount: 0,
        statementWithoutLedgerCount: 0,
        ambiguityCount: 0,
        duplicateCount: 0,
        status: "CONCILIADA",
      },
    ],
    results: [
      {
        id: "REC-1",
        status: "AUTO_MATCH_EXACT",
        rule: "RULE_1_EXACT",
        decisionLevel: "AUTOMATIC",
        reason: "Correspondência única.",
        valueTolerance: "0.01",
        ledger: {
          id: "l1",
          company: "EMPRESA TESTE",
          branch: "01",
          ledgerAccount: "111",
          date: "2026-01-02",
          document: "123",
          history: "Recebimento",
          value: "10.00",
          sourceId: "l1",
          evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 2 },
        },
        statement: {
          id: "s1",
          bank: "ITAU",
          agency: "0191",
          bankAccount: "26775-6",
          date: "2026-01-02",
          document: "123",
          history: "Recebimento",
          value: "10.00",
          sourceId: "s1",
          evidence: { fileId: "statement", originalName: "itau.xlsx", extractionMethod: "TABULAR", line: 2 },
        },
      },
    ],
    issues: [],
    files: [],
    investments: [],
  };
}

describe("ReconciliationApp Fluxo Assíncrono com Polling", () => {
  it("trata resposta 202 QUEUED no confirm-and-process, ativa polling e exibe o resultado final", async () => {
    const preflight = mockPreflight();
    const result = mockResult();

    const authenticatedFetch = vi.fn()
      // Initial history load
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Create session
      .mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: "session-1", status: "CREATED" }, token: "token-1" }), { status: 201, headers: { "Content-Type": "application/json" } }))
      // Upload ledger
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "ledger", kind: "LEDGER" }, upload: { mode: "local", url: "/upload/ledger" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "ledger" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Upload statement
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "statement", kind: "STATEMENT" }, upload: { mode: "local", url: "/upload/statement" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: "statement" } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Preflight
      .mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: "session-1", status: "PREFLIGHT", preflight } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Confirm and Process: responde HTTP 202 QUEUED imediatamente (modo assíncrono desacoplado)
      .mockResolvedValueOnce(new Response(JSON.stringify({ session: { id: "session-1", status: "QUEUED", progress: 50, progressMessage: "Execução em fila." } }), { status: 202, headers: { "Content-Type": "application/json" } }))
      // Polling de status subsequente: responde com resultado concluído
      .mockResolvedValue(new Response(JSON.stringify({ session: { id: "session-1", status: "COMPLETED", progress: 100, result } }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });

    render(
      <ReconciliationApp
        companies={[{ id: "company-1", organizationId: "org-1", name: "EMPRESA TESTE", roles: ["PREPARER"] }]}
        userEmail="teste@exemplo.com"
        logout={async () => {}}
        authenticatedFetch={authenticatedFetch}
      />
    );

    // Inicia fluxo de nova conciliação
    fireEvent.click(screen.getByRole("button", { name: "Nova conciliação" }));
    fireEvent.change(screen.getByLabelText("Tolerância de valor (R$)"), { target: { value: "0,01" } });
    fireEvent.change(screen.getByLabelText("Razão Protheus"), { target: { files: [new File(["ledger"], "razao.xlsx")] } });
    fireEvent.change(screen.getByLabelText("Extratos bancários"), { target: { files: [new File(["statement"], "itau.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Analisar arquivos" }));

    // Confirmação de contas
    fireEvent.change(await screen.findByLabelText(/Conta contábil para itau.xlsx/), { target: { value: "111" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e conciliar" }));

    // Deve transicionar para processamento e, após o polling, exibir a tela de resultado
    expect(await screen.findByText("Conciliação exata")).toBeInTheDocument();
    expect(authenticatedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/confirm-and-process"),
      expect.anything()
    );
  });
});
