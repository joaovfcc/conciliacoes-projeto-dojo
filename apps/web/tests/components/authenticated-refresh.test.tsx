import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/reconciliation-app', () => ({
  ReconciliationApp: ({ authenticatedFetch }: {
    authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    logout: () => Promise<void>;
  }) => <>
    <button onClick={() => {
      void Promise.all([authenticatedFetch('/first'), authenticatedFetch('/delayed')]);
    }}>Testar concorrência</button>
    <button onClick={() => { void authenticatedFetch('/capability'); }}>Testar capacidade</button>
  </>,
}));

import { AuthenticatedApp } from '../../src/components/authenticated-app';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authenticated request no modo local', () => {
  it('envia requisições diretamente sem travar em rotação de refresh de token', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/companies') {
        return new Response(JSON.stringify({ companies: [] }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Testar concorrência' }));

    expect(fetchMock).toHaveBeenCalledWith('/first', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer local-access-token' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/delayed', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer local-access-token' }),
    }));
  });

  it('executa chamadas de capacidade sem requerer autenticação remota', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/companies') {
        return new Response(JSON.stringify({ companies: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Testar capacidade' }));

    expect(fetchMock).toHaveBeenCalledWith('/capability', expect.anything());
  });
});
