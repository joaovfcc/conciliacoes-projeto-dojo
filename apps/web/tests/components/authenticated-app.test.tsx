import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedApp } from '../../src/components/authenticated-app';

const user = {
  id: 'user-1',
  email: 'owner@example.com',
  passwordChangeRequired: false,
  ownerOrganizationIds: ['org-1'],
  companyRoles: { 'company-1': ['ADMIN'] as const },
  companies: [{ id: 'company-1', organizationId: 'org-1', name: 'Empresa', roles: ['ADMIN'] as const }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuthenticatedApp', () => {
  it('restaura a sessão pelo cookie sem usar armazenamento do navegador', async () => {
    const storageRead = vi.spyOn(Storage.prototype, 'getItem');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(grant()));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);

    expect(screen.getByText('Verificando sua sessão...')).toBeInTheDocument();
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', { method: 'POST', cache: 'no-store' });
    expect(storageRead).not.toHaveBeenCalled();
  });

  it('exibe login quando não há refresh válido e mantém o access token apenas em memória', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(jsonResponse(grant()));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);

    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct-password' }),
    }));
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('exige troca da senha temporária e encerra a sessão depois da alteração', async () => {
    const temporaryUser = { ...user, passwordChangeRequired: true };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(grant(temporaryUser)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);

    expect(await screen.findByText('Crie uma nova senha')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: 'temporary-password' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'new-password-123' } });
    fireEvent.change(screen.getByLabelText('Confirme a nova senha'), { target: { value: 'new-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));

    expect(await screen.findByText('Acesso ao Concilia')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/change-password', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
    }));
  });

  it('renova uma única vez quando uma chamada autenticada recebe 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(grant()))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(jsonResponse(grant(user, 'renewed-token')))
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'reconciliation-1', status: 'CREATED' }, token: 'opaque-token' }, 201));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Nova conciliação' }));
    fireEvent.change(screen.getByLabelText('Tolerância de valor (R$)'), { target: { value: '0,01' } });
    fireEvent.change(screen.getByLabelText('Razão Protheus'), { target: { files: [new File(['ledger'], 'razao.csv')] } });
    fireEvent.change(screen.getByLabelText('Extratos bancários'), { target: { files: [new File(['statement'], 'extrato.ofx')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Analisar arquivos' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer renewed-token' }),
      body: JSON.stringify({ companyId: 'company-1' }),
    })));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(2);
  });

  it('exibe banner de standby e desabilita o formulário após 5 tentativas (HTTP 429)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message: 'Limite de 5 tentativas excedido. Aguarde 5 minutos em standby antes de tentar novamente.',
          retryAfterSeconds: 300,
        },
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '300' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);

    const emailInput = await screen.findByLabelText('E-mail');
    const passwordInput = screen.getByLabelText('Senha');
    const submitButton = screen.getByRole('button', { name: 'Entrar' });

    fireEvent.change(emailInput, { target: { value: 'owner@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText('Acesso temporariamente em standby')).toBeInTheDocument();
    expect(screen.getByText(/Limite de 5 tentativas de login excedido/)).toBeInTheDocument();
    expect(emailInput).toBeDisabled();
    expect(passwordInput).toBeDisabled();
    expect(screen.getByRole('button', { name: /Standby/ })).toBeDisabled();
  });
});

function grant(authUser = user, accessToken = 'access-token') {
  return {
    accessToken,
    accessExpiresAt: '2026-08-13T12:10:00.000Z',
    user: authUser,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
