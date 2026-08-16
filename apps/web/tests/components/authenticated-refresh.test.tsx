import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/reconciliation-app', () => ({
  ReconciliationApp: ({ authenticatedFetch, logout }: {
    authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    logout: () => Promise<void>;
  }) => <>
    <button onClick={() => {
      void Promise.all([authenticatedFetch('/first'), authenticatedFetch('/delayed')]);
    }}>Testar concorrência</button>
    <button onClick={() => { void authenticatedFetch('/capability'); }}>Testar capacidade</button>
    <button onClick={() => { void logout(); }}>Sair</button>
  </>,
}));

import { AuthenticatedApp } from '../../src/components/authenticated-app';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authenticated request refresh', () => {
  it('faz uma única rotação quando respostas 401 concorrentes chegam em momentos diferentes', async () => {
    let refreshCount = 0;
    let releaseDelayed: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => { releaseDelayed = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(grant(refreshCount === 1 ? 'initial-token' : 'renewed-token'));
      }
      const token = new Headers(init?.headers).get('authorization');
      if (token === 'Bearer renewed-token') return new Response(null, { status: 204 });
      if (input === '/delayed') await delayed;
      return unauthorized();
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Testar concorrência' }));
    await waitFor(() => expect(refreshCount).toBe(2));
    releaseDelayed?.();

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => input === '/first')).toHaveLength(2);
      expect(fetchMock.mock.calls.filter(([input]) => input === '/delayed')).toHaveLength(2);
    });
    expect(refreshCount).toBe(2);
  });

  it('não rotaciona o refresh quando somente o token opaco da conciliação é inválido', async () => {
    let refreshCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(grant('access-token'));
      }
      return jsonResponse({ error: { code: 'SESSAO_NAO_AUTORIZADA', message: 'Sessão indisponível' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Testar capacidade' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/capability', expect.anything()));
    expect(refreshCount).toBe(1);
  });

  it('renova um JWT expirado antes de encerrar a sessão persistente', async () => {
    let refreshCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(grant(refreshCount === 1 ? 'expired-token' : 'renewed-token'));
      }
      const authorization = new Headers(init?.headers).get('authorization');
      return authorization === 'Bearer renewed-token' ? new Response(null, { status: 204 }) : unauthorized();
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByText('Entre para conciliar')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
      headers: { Authorization: 'Bearer renewed-token' },
    })));
    expect(refreshCount).toBe(2);
  });

  it('não permite que um refresh pendente restaure a interface depois do logout', async () => {
    let refreshCount = 0;
    let releaseRefresh: (() => void) | undefined;
    const pendingRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/auth/refresh') {
        refreshCount += 1;
        if (refreshCount === 2) await pendingRefresh;
        return jsonResponse(grant(refreshCount === 1 ? 'initial-token' : 'renewed-token'));
      }
      if (input === '/first' || input === '/delayed') return unauthorized();
      if (input === '/api/auth/logout') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer renewed-token');
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Testar concorrência' }));
    await waitFor(() => expect(refreshCount).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    releaseRefresh?.();

    expect(await screen.findByText('Entre para conciliar')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.anything()));
    expect(screen.queryByRole('button', { name: 'Testar concorrência' })).not.toBeInTheDocument();
  });

  it('não permite que um 401 atrasado inicie refresh depois do logout', async () => {
    let refreshCount = 0;
    let releaseRequest: (() => void) | undefined;
    const pendingRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/auth/refresh') {
        refreshCount += 1;
        return jsonResponse(grant('access-token'));
      }
      if (input === '/capability') {
        await pendingRequest;
        return unauthorized();
      }
      if (input === '/api/auth/logout') return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Testar capacidade' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/capability', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('Entre para conciliar')).toBeInTheDocument();
    releaseRequest?.();

    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => input === '/capability')).toHaveLength(1));
    expect(refreshCount).toBe(1);
    expect(screen.queryByRole('button', { name: 'Testar capacidade' })).not.toBeInTheDocument();
  });
});

function grant(accessToken: string) {
  return {
    accessToken,
    accessExpiresAt: '2026-08-13T12:10:00.000Z',
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      passwordChangeRequired: false,
      ownerOrganizationIds: ['org-1'],
      companyRoles: {},
      companies: [],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function unauthorized(): Response {
  return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Credencial inválida' } }, 401);
}
