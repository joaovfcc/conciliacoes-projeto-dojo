import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerRecord, ReconciliationResult, StatementRecord } from "@conciliacao/core";
import { BidirectionalMatchModal } from "../../src/components/bidirectional-match-modal";
import { ReconciliationApp } from "../../src/components/reconciliation-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const mockStatement1: StatementRecord = {
  id: "stmt-740k",
  bank: "ITAU",
  agency: "8363",
  bankAccount: "12345-6",
  date: "2026-01-29",
  document: "756190",
  history: "TED 341.8363 EMPRESA TRANSFERENCIA",
  value: "740000.00",
  type: "DEBIT",
  sourceId: "s-740k",
  evidence: {
    fileId: "extrato-itau",
    originalName: "extrato_itau.xlsx",
    extractionMethod: "TABULAR",
    line: 15,
  },
};

const mockStatement2: StatementRecord = {
  id: "stmt-taxa",
  bank: "ITAU",
  agency: "8363",
  bankAccount: "12345-6",
  date: "2026-01-30",
  document: "000010",
  history: "TAR TRANSF ELETR DISP",
  value: "10.50",
  type: "DEBIT",
  sourceId: "s-taxa",
  evidence: {
    fileId: "extrato-itau",
    originalName: "extrato_itau.xlsx",
    extractionMethod: "TABULAR",
    line: 16,
  },
};

const mockLedger1: LedgerRecord = {
  id: "ledg-740k",
  company: "EMPRESA",
  branch: "01",
  ledgerAccount: "1.1.1.02.001",
  date: "2026-01-29",
  document: "756190",
  history: "TRANSF. BANC. - 001 3320 BB RENDE FACIL",
  value: "740000.00",
  type: "DEBIT",
  sourceId: "l-740k",
  evidence: {
    fileId: "razao",
    originalName: "razao.xlsx",
    extractionMethod: "TABULAR",
    line: 42,
  },
};

const mockLedger2: LedgerRecord = {
  id: "ledg-fornecedor",
  company: "EMPRESA",
  branch: "01",
  ledgerAccount: "1.1.1.02.001",
  date: "2026-01-28",
  document: "998877",
  history: "PGTO FORNECEDOR DIVERSOS",
  value: "5000.00",
  type: "DEBIT",
  sourceId: "l-forn",
  evidence: {
    fileId: "razao",
    originalName: "razao.xlsx",
    extractionMethod: "TABULAR",
    line: 43,
  },
};

const pendingStatementResult: ReconciliationResult = {
  id: "STATEMENT_WITHOUT_LEDGER_stmt-740k",
  status: "STATEMENT_WITHOUT_LEDGER",
  rule: "RF-09",
  decisionLevel: "REVIEW_REQUIRED",
  reason: "Movimento do extrato sem correspondência.",
  statement: mockStatement1,
  statements: [mockStatement1],
  valueTolerance: "0.00",
  ruleVersion: "1.0",
};

const pendingStatementTaxaResult: ReconciliationResult = {
  id: "STATEMENT_WITHOUT_LEDGER_stmt-taxa",
  status: "STATEMENT_WITHOUT_LEDGER",
  rule: "RF-09",
  decisionLevel: "REVIEW_REQUIRED",
  reason: "Tarifa bancária sem lançamento contábil.",
  statement: mockStatement2,
  statements: [mockStatement2],
  valueTolerance: "0.00",
  ruleVersion: "1.0",
};

const pendingLedgerResult: ReconciliationResult = {
  id: "LEDGER_WITHOUT_STATEMENT_ledg-740k",
  status: "LEDGER_WITHOUT_STATEMENT",
  rule: "RF-09",
  decisionLevel: "REVIEW_REQUIRED",
  reason: "Lançamento do razão sem correspondência.",
  ledger: mockLedger1,
  ledgers: [mockLedger1],
  valueTolerance: "0.00",
  ruleVersion: "1.0",
};

const pendingLedgerFornecResult: ReconciliationResult = {
  id: "LEDGER_WITHOUT_STATEMENT_ledg-fornecedor",
  status: "LEDGER_WITHOUT_STATEMENT",
  rule: "RF-09",
  decisionLevel: "REVIEW_REQUIRED",
  reason: "Pagamento sem extrato correspondente.",
  ledger: mockLedger2,
  ledgers: [mockLedger2],
  valueTolerance: "0.00",
  ruleVersion: "1.0",
};

describe("BidirectionalMatchModal Component", () => {
  it("abre com âncora do extrato, filtra o razão por texto e confirma a conciliação manual", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <BidirectionalMatchModal
        anchorItem={pendingStatementResult}
        allResults={[
          pendingStatementResult,
          pendingStatementTaxaResult,
          pendingLedgerResult,
          pendingLedgerFornecResult,
        ]}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    // Verifica que o modal abriu com título e contexto da âncora
    expect(screen.getByText("Conciliação Manual com Filtros Inteligentes")).toBeInTheDocument();
    expect(screen.getByText(/Extrato selecionado como âncora/)).toBeInTheDocument();

    // No lado do razão, com filtro "Exato" (padrão com âncora de mesmo valor), mockLedger1 deve aparecer
    expect(screen.getByText("TRANSF. BANC. - 001 3320 BB RENDE FACIL")).toBeInTheDocument();

    // Testa filtro de busca por texto no histórico
    const searchInput = screen.getByPlaceholderText(/Pesquisar por histórico, doc, banco, conta/);
    fireEvent.change(searchInput, { target: { value: "RENDE FACIL" } });
    expect(screen.getByText("TRANSF. BANC. - 001 3320 BB RENDE FACIL")).toBeInTheDocument();

    // Se buscar texto inexistente, exibe empty state
    fireEvent.change(searchInput, { target: { value: "TEXTO_INEXISTENTE_XYZ" } });
    expect(screen.getByText("Nenhum lançamento do razão corresponde aos filtros.")).toBeInTheDocument();

    // Limpa a busca
    fireEvent.change(searchInput, { target: { value: "" } });

    // Seleciona o radio do razão mockLedger1
    const radioLedger = screen.getByDisplayValue("ledg-740k");
    fireEvent.click(radioLedger);

    // Deve exibir o painel de conferência com diferença R$ 0,00 e Mesma data
    expect(screen.getByText("✓ Par selecionado para conciliação")).toBeInTheDocument();
    expect(screen.getByText(/Diferença: R\$\s*0,00 \(Exato\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Mesma data").length).toBeGreaterThanOrEqual(2);

    // Preenche observação contábil
    const justInput = screen.getByPlaceholderText(/Ex: TED Itaú autorizada/);
    fireEvent.change(justInput, { target: { value: "Transferência autorizada entre contas da empresa" } });

    // Clica em confirmar
    const confirmBtn = screen.getByRole("button", { name: "Confirmar conciliação manual" });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledWith(
      ["stmt-740k"],
      ["ledg-740k"],
      "Transferência autorizada entre contas da empresa",
    );
  });

  it("permite selecionar múltiplos lançamentos de extrato e razão para conciliação em lote (N:1)", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const mockLedgerTotal: LedgerRecord = {
      id: "ledg-total",
      company: "EMPRESA",
      branch: "01",
      ledgerAccount: "1.1.1.02.001",
      date: "2026-01-29",
      document: "756190",
      history: "LOTE COMBINADO",
      value: "740010.50",
      type: "DEBIT",
      sourceId: "l-total",
      evidence: {
        fileId: "razao",
        originalName: "razao.xlsx",
        extractionMethod: "TABULAR",
        line: 50,
      },
    };
    const pendingLedgerTotalResult: ReconciliationResult = {
      id: "LEDGER_WITHOUT_STATEMENT_ledg-total",
      status: "LEDGER_WITHOUT_STATEMENT",
      rule: "RF-09",
      decisionLevel: "REVIEW_REQUIRED",
      reason: "Lançamento total do razão.",
      ledger: mockLedgerTotal,
      ledgers: [mockLedgerTotal],
      valueTolerance: "0.00",
      ruleVersion: "1.0",
    };

    render(
      <BidirectionalMatchModal
        anchorItem={null}
        allResults={[
          pendingStatementResult,
          pendingStatementTaxaResult,
          pendingLedgerTotalResult,
        ]}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    // Seleciona os dois extratos (740.000 + 10,50)
    fireEvent.click(screen.getByDisplayValue("stmt-740k"));
    fireEvent.click(screen.getByDisplayValue("stmt-taxa"));

    // Seleciona o razão total (740.010,50)
    fireEvent.click(screen.getByDisplayValue("ledg-total"));

    // O painel deve exibir grupo selecionado (2 Extrato x 1 Razão)
    expect(screen.getByText(/✓ Grupo selecionado \(2 Extrato × 1 Razão\)/)).toBeInTheDocument();
    expect(screen.getByText(/Diferença: R\$\s*0,00 \(Exato\)/)).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "Confirmar conciliação manual" });
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledWith(
      ["stmt-740k", "stmt-taxa"],
      ["ledg-total"],
      "",
    );
  });

  it("desabilita o botão de confirmação quando apenas um dos lados está selecionado", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    // Abre em modo livre (sem âncora)
    render(
      <BidirectionalMatchModal
        anchorItem={null}
        allResults={[pendingStatementResult, pendingLedgerResult]}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    const confirmBtn = screen.getByRole("button", { name: "Confirmar conciliação manual" });
    expect(confirmBtn).toBeDisabled();

    // Seleciona apenas o extrato
    fireEvent.click(screen.getByDisplayValue("stmt-740k"));
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText("Selecione 1 lançamento do razão à direita para completar o par.")).toBeInTheDocument();

    // Seleciona também o razão
    fireEvent.click(screen.getByDisplayValue("ledg-740k"));
    expect(confirmBtn).not.toBeDisabled();
  });
});

describe("Fluxo de Match Manual Bidirecional no ReconciliationApp", () => {
  it("permite abrir a conciliação manual a partir de Extrato sem Razão, cruzar com o Razão e atualizar o estado e métricas", async () => {
    const initialResult = {
      company: "EMPRESA",
      branch: "01",
      period: "202601",
      executedAt: "2026-01-31T12:00:00.000Z",
      summaries: [
        {
          ledgerAccount: "1.1.1.02.001",
          statementAccounts: ["Itaú 8363/12345-6"],
          ledgerBalance: "740000.00",
          statementBalance: "740000.00",
          balanceDifference: "0.00",
          reconciledCount: 0,
          reconciledValue: "0.00",
          divergenceCount: 0,
          ledgerWithoutStatementCount: 1,
          statementWithoutLedgerCount: 1,
          ambiguityCount: 0,
          duplicateCount: 0,
          status: "COM_DIVERGENCIAS" as const,
        },
      ],
      results: [pendingStatementResult, pendingLedgerResult],
      issues: [],
      files: [],
      investments: [],
    };

    const authenticatedFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/reconciliation-history/h-test") && init?.method === "PATCH") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (urlStr.includes("/api/reconciliation-history/h-test")) {
        return Promise.resolve(
          new Response(JSON.stringify({ record: { result: initialResult } }), {
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
                id: "h-test",
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

    render(
      <ReconciliationApp
        companies={[{ id: "company-1", organizationId: "org-1", name: "Empresa", roles: ["ADMIN"] }]}
        userEmail="analista@empresa.com"
        logout={vi.fn()}
        authenticatedFetch={authenticatedFetch}
      />,
    );

    // Clica em "Ver resultado" para abrir a conciliação do histórico
    fireEvent.click(await screen.findByRole("button", { name: "Ver resultado" }));

    // Verifica que na aba "Extrato sem razão" consta badge 1 e na aba "Razão sem extrato" consta badge 1
    const stmtTab = await screen.findByRole("tab", { name: /Extrato sem razão/ });
    expect(stmtTab).toBeInTheDocument();
    expect(stmtTab).toHaveTextContent("1");

    const ledgTab = await screen.findByRole("tab", { name: /Razão sem extrato/ });
    expect(ledgTab).toBeInTheDocument();
    expect(ledgTab).toHaveTextContent("1");

    // Navega para a aba "Extrato sem razão"
    fireEvent.click(stmtTab);

    // O botão "Buscar no Razão" deve estar presente na linha da tabela
    const searchInLedgerBtn = await screen.findByRole("button", { name: "Buscar no Razão" });
    expect(searchInLedgerBtn).toBeInTheDocument();

    // Também verifica a presença do banner informativo
    expect(screen.getByText(/Conciliação Manual Bidirecional/)).toBeInTheDocument();

    // Clica em "Buscar no Razão"
    fireEvent.click(searchInLedgerBtn);

    // Modal de conciliação inteligente abre
    expect(screen.getByText("Conciliação Manual com Filtros Inteligentes")).toBeInTheDocument();
    expect(screen.getByText("TRANSF. BANC. - 001 3320 BB RENDE FACIL")).toBeInTheDocument();

    // Seleciona o razão correspondente
    fireEvent.click(screen.getByDisplayValue("ledg-740k"));

    // Confere que o par foi selecionado com diferença 0
    expect(screen.getByText("✓ Par selecionado para conciliação")).toBeInTheDocument();

    // Clica em confirmar
    const confirmBtn = screen.getByRole("button", { name: "Confirmar conciliação manual" });
    fireEvent.click(confirmBtn);

    // Modal fechou
    expect(screen.queryByText("Conciliação Manual com Filtros Inteligentes")).not.toBeInTheDocument();

    // Aba "Conciliados" agora deve ter badge 1
    const reconciledTab = screen.getByRole("tab", { name: /Conciliados/ });
    expect(reconciledTab).toHaveTextContent("1");

    // As pendências devem ter sido zeradas (badge 0)
    expect(screen.getByRole("tab", { name: /Extrato sem razão/ })).toHaveTextContent("0");
    expect(screen.getByRole("tab", { name: /Razão sem extrato/ })).toHaveTextContent("0");

    // Persistência PATCH foi chamada
    expect(authenticatedFetch).toHaveBeenCalledWith(
      "/api/reconciliation-history/h-test",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });
});
