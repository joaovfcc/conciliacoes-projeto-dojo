import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconciliationApp, confirmedIdentityMappings, confirmedMappings } from "../../src/components/reconciliation-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("ReconciliationApp", () => {
  it("exige confirmação explícita para incluir uma conta física divergente no escopo lógico", () => {
    const detected = preflight();
    detected.statements[0]!.account = "0003802-4";
    const mappings = { statement: "111" };

    expect(confirmedIdentityMappings(detected, mappings)).toBe(false);
    expect(confirmedIdentityMappings(detected, mappings, { statement: true })).toBe(true);
    expect(confirmedMappings(detected, mappings, { statement: true })[0]?.linkedPhysicalAccounts).toEqual([
      { statementFileId: "statement", bank: "ITAU", agency: "0191", account: "0003802-4", role: "LINKED" },
    ]);
  });

  it("apresenta o painel operacional de conciliação e métricas", () => {
    renderApp();
    expect(screen.getByText("Retenção")).toBeInTheDocument();
    expect(screen.getByText("365 dias")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova conciliação" })).toBeInTheDocument();
  });

  it("limita a tolerância de data visualmente a três dias", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Nova conciliação" }));

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
        {
          id: "REC-3", status: "AUTO_MATCH_GROUP", rule: "RF-04", decisionLevel: "AUTOMATIC", reason: "Grupo.", valueTolerance: "0.00", ledgers: [
            { id: "l2", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-03", document: "", history: "Principal do grupo", value: "6.00", sourceId: "l2", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 3 } },
            { id: "l3", company: "EMPRESA", branch: "01", ledgerAccount: "111", date: "2026-01-03", document: "", history: "Juros do grupo", value: "4.00", sourceId: "l3", evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR", line: 4 } },
          ]
        },
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
    fireEvent.click(screen.getByRole("button", { name: "Nova conciliação" }));
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
    expect(screen.getByRole("tab", { name: /Conciliados/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Extrato sem razão/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Razão sem extrato/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Ambiguidades/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Aplicações automáticas/ })).toBeInTheDocument();
    expect(screen.getAllByText("Linhas do Extrato")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Linhas do Razão")[0]).toBeInTheDocument();
    expect(screen.getByText("Movimentação do banco (líquida)")).toBeInTheDocument();
    expect(screen.getByText("Cobertura confirmada")).toBeInTheDocument();
    expect(screen.getByText("Cobertura potencial")).toBeInTheDocument();
    expect(screen.getByText("Linhas em sugestões")).toBeInTheDocument();
    expect(screen.getByText("Ambiguidades por valor")).toBeInTheDocument();
    expect(screen.getByText("Cobertura do razão")).toBeInTheDocument();
    expect(screen.getByText("Cobertura do extrato operacional")).toBeInTheDocument();

    // Testa os subfiltros de Conciliados
    fireEvent.click(screen.getByRole("button", { name: /Lotes \/ Desdobros/ }));
    expect(await screen.findByText("Conciliação em grupo")).toBeInTheDocument();
    expect(screen.getByText(/Principal do grupo/)).toBeInTheDocument();
    expect(screen.getByText(/Juros do grupo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Por Data/ }));
    expect(await screen.findByText("Conciliação com tolerância de data")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Total Diário/ }));
    expect(await screen.findByText("Conciliação por total diário")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Compensados/ }));
    expect(await screen.findByText("Compensado no extrato")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Exatos 1:1/ }));
    expect(screen.getByText("Regra 1 — documento, data e valor exatos")).toBeInTheDocument();
    expect(screen.queryByText("AUTO_MATCH_EXACT")).not.toBeInTheDocument();
    expect(screen.queryByText("RULE_1_EXACT")).not.toBeInTheDocument();

    // Testa as outras abas principais
    fireEvent.click(screen.getByRole("tab", { name: /Aplicações automáticas/ }));
    expect(await screen.findByText("Excluído - aplicação automática")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Razão sem extrato/ }));
    expect(await screen.findByText("Lançamento do razão sem correspondente no extrato")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Extrato sem razão/ }));
    expect(await screen.findByText("Lançamento do extrato sem correspondente no razão")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Conciliados/ }));

    fireEvent.click(screen.getAllByRole("button", { name: "Ver evidência" })[0]!);
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

  it("retorna para a tela inicial ao clicar na marca Concilia ou no ícone C", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Nova conciliação" }));
    expect(screen.getByRole("heading", { name: "Nova conciliação" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ir para a tela inicial do Concilia" }));
    expect(await screen.findByText("Retenção")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova conciliação" })).toBeInTheDocument();
  });

  it("retorna para a tela inicial ao clicar no botão Voltar na etapa de arquivos", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Nova conciliação" }));
    expect(screen.getByRole("heading", { name: "Nova conciliação" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(await screen.findByText("Retenção")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova conciliação" })).toBeInTheDocument();
  });

  it("permite excluir um resultado do histórico com confirmação", async () => {
    const historyItem = {
      id: "h1",
      companyId: "company-1",
      companyName: "Empresa",
      period: "202601",
      status: "COMPLETED",
      completedAt: "2026-01-31T12:00:00.000Z",
      expiresAt: "2027-01-31T12:00:00.000Z",
    };
    const authenticatedFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/reconciliation-history") && init?.method === "DELETE") {
        return Promise.resolve(new Response(JSON.stringify({ success: true, id: "h1" }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ items: [historyItem] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    renderApp(authenticatedFetch);

    const deleteButton = await screen.findByTitle("Excluir este resultado do histórico");
    expect(deleteButton).toBeInTheDocument();

    fireEvent.click(deleteButton);
    const confirmButton = screen.getByRole("button", { name: "Confirmar" });
    expect(confirmButton).toBeInTheDocument();

    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(authenticatedFetch).toHaveBeenCalledWith("/api/reconciliation-history/h1", expect.objectContaining({ method: "DELETE" }));
    });
  });

  it("permite conciliar manualmente lançamentos da aba de ambiguidades e transferi-los para conciliados", async () => {
    const l1 = {
      id: "l1",
      company: "EMPRESA",
      branch: "01",
      ledgerAccount: "111",
      date: "2026-01-05",
      document: "DOC-A",
      history: "Nota A",
      value: "50.00",
      sourceId: "l1",
      evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR" as const, line: 2 },
    };
    const l2 = {
      id: "l2",
      company: "EMPRESA",
      branch: "01",
      ledgerAccount: "111",
      date: "2026-01-06",
      document: "DOC-B",
      history: "Nota B",
      value: "50.00",
      sourceId: "l2",
      evidence: { fileId: "ledger", originalName: "razao.xlsx", extractionMethod: "TABULAR" as const, line: 3 },
    };
    const s1 = {
      id: "s1",
      bank: "ITAU",
      agency: "0191",
      bankAccount: "26775-6",
      date: "2026-01-05",
      document: "DOC-EXT-1",
      history: "Depósito 1",
      value: "50.00",
      sourceId: "s1",
      evidence: { fileId: "statement", originalName: "itau.xlsx", extractionMethod: "TABULAR" as const, line: 2, parser: "itau-checking-xlsx-v1" },
    };

    const ambiguityGroup = {
      id: "GRP-1",
      ledgerAccount: "111",
      amount: "50.00",
      ledgerCandidateIds: ["l1", "l2"],
      statementCandidateIds: ["s1"],
      reason: "Há 2 lançamentos no razão e 1 no extrato com o mesmo valor.",
      evaluatedAt: "2026-01-31T12:00:00.000Z",
    };

    const ambiguousResult = {
      id: "AMB-1",
      status: "AMBIGUOUS_MATCH" as const,
      rule: "RF-02",
      decisionLevel: "REVIEW_REQUIRED" as const,
      reason: "Ambiguidade detectada.",
      ledger: l1,
      ledgers: [l1, l2],
      statements: [s1],
      ambiguityGroup,
      valueTolerance: "0.00",
    };

    const result = {
      company: "EMPRESA",
      branch: "01",
      period: "202601",
      executedAt: "2026-01-31T12:00:00.000Z",
      summaries: [],
      results: [ambiguousResult],
      issues: [],
      files: [{ fileId: "statement", originalName: "itau.xlsx", bank: "ITAU", agency: "0191", account: "26775-6", periods: ["202601"], recordCount: 1, extractionMethod: "TABULAR" as const, parser: "itau-checking-xlsx-v1", classification: "CURRENT_ACCOUNT" as const, reconciliationEligible: true }],
      investments: [],
      controls: {
        tolerance: "0.05",
        signProfiles: ["BANK_ASSET" as const],
        movements: { bankConciliable: "50.00", ledger: "100.00", difference: "-50.00", status: "FAILED" as const },
        balances: { openingStatus: "NOT_AVAILABLE" as const, closingStatus: "NOT_AVAILABLE" as const },
        coverage: { lines: { covered: "0", total: "3", percentage: "0.00" }, absoluteValue: { covered: "0.00", total: "150.00", percentage: "0.00" } },
        countsByStatus: [{ status: "AMBIGUOUS_MATCH" as const, count: "1" }],
        pendingByDate: [],
      },
    };

    const authenticatedFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/reconciliation-history/h1") && init?.method === "PATCH") {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/reconciliation-history/h1")) {
        return Promise.resolve(
          new Response(JSON.stringify({ record: { result } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "h1",
                companyId: "company-1",
                companyName: "Empresa",
                period: "202601",
                status: "COMPLETED",
                completedAt: "2026-01-31T12:00:00.000Z",
                expiresAt: "2027-01-31T12:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });

    renderApp(authenticatedFetch);

    fireEvent.click(await screen.findByRole("button", { name: "Ver resultado" }));

    // Verifica que na aba Ambiguidades consta badge 1
    const ambiguityTab = await screen.findByRole("tab", { name: /Ambiguidades/ });
    expect(ambiguityTab).toBeInTheDocument();
    expect(ambiguityTab).toHaveTextContent("1");

    fireEvent.click(ambiguityTab);

    // Clica no botão "Conciliar manual"
    const manualMatchBtn = await screen.findByRole("button", { name: "Conciliar manual" });
    expect(manualMatchBtn).toBeInTheDocument();
    fireEvent.click(manualMatchBtn);

    // Modal aberto
    expect(screen.getByText("Conciliação Manual de Ambiguidade")).toBeInTheDocument();
    expect(screen.getByText(/Valor de referência: R\$\s*50,00/)).toBeInTheDocument();

    // Seleciona a Nota A no razão
    const radioL1 = screen.getByDisplayValue("l1");
    fireEvent.click(radioL1);

    // Confere que extrato s1 já está selecionado por ser o único ou clica nele
    const radioS1 = screen.getByDisplayValue("s1");
    fireEvent.click(radioS1);

    expect(screen.getByText("✓ Par selecionado para conciliação")).toBeInTheDocument();
    expect(screen.getByText(/Diferença: R\$\s*0,00 \(Exato\)/)).toBeInTheDocument();

    // Confirma conciliação manual
    const confirmBtn = screen.getByRole("button", { name: "Confirmar conciliação manual" });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    // Modal fechou
    expect(screen.queryByText("Conciliação Manual de Ambiguidade")).not.toBeInTheDocument();

    // Ambiguidades zera (badge 0)
    expect(screen.getByRole("tab", { name: /Ambiguidades/ })).toHaveTextContent("0");

    // Conciliados agora tem 1 (badge 1)
    const reconciledTab = screen.getByRole("tab", { name: /Conciliados/ });
    expect(reconciledTab).toHaveTextContent("1");

    // Razão sem extrato recebeu o resíduo (badge 1)
    const ledgerWithoutStmtTab = screen.getByRole("tab", { name: /Razão sem extrato/ });
    expect(ledgerWithoutStmtTab).toHaveTextContent("1");

    // Abre a aba Conciliados e verifica que a regra é Manual
    fireEvent.click(reconciledTab);
    expect(screen.getByText(/Manual/)).toBeInTheDocument();
  });

  it("permite remover arquivos de razão e extratos adicionados na etapa de arquivos", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Nova conciliação" }));

    const ledgerInput = screen.getByLabelText("Razão Protheus") as HTMLInputElement;
    const statementsInput = screen.getByLabelText("Extratos bancários") as HTMLInputElement;

    const fileLedger = new File(["ledger-content"], "razao.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const fileStatement1 = new File(["stmt-1"], "extrato1.ofx", { type: "text/plain" });
    const fileStatement2 = new File(["stmt-2"], "extrato2.ofx", { type: "text/plain" });

    // Adiciona razão
    fireEvent.change(ledgerInput, { target: { files: [fileLedger] } });
    expect(screen.getByText("razao.xlsx")).toBeInTheDocument();

    // Adiciona extratos
    fireEvent.change(statementsInput, { target: { files: [fileStatement1, fileStatement2] } });
    expect(screen.getByText("extrato1.ofx")).toBeInTheDocument();
    expect(screen.getByText("extrato2.ofx")).toBeInTheDocument();

    // Remove extrato1.ofx
    const removeButtons = screen.getAllByRole("button", { name: "Remover" });
    expect(removeButtons).toHaveLength(3);

    // Clica para remover extrato1.ofx (segundo botão)
    fireEvent.click(removeButtons[1]!);
    expect(screen.queryByText("extrato1.ofx")).not.toBeInTheDocument();
    expect(screen.getByText("extrato2.ofx")).toBeInTheDocument();
    expect(screen.getByText("razao.xlsx")).toBeInTheDocument();

    // Remove o razão
    const removeLedgerBtn = screen.getAllByRole("button", { name: "Remover" })[0]!;
    fireEvent.click(removeLedgerBtn);
    expect(screen.queryByText("razao.xlsx")).not.toBeInTheDocument();
    expect(screen.getByText("extrato2.ofx")).toBeInTheDocument();

    // Verifica que o input value foi resetado permitindo selecionar o mesmo arquivo novamente
    expect(ledgerInput.value).toBe("");
    fireEvent.change(ledgerInput, { target: { files: [fileLedger] } });
    expect(screen.getByText("razao.xlsx")).toBeInTheDocument();
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
