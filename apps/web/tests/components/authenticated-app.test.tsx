import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedApp } from '../../src/components/authenticated-app';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AuthenticatedApp (Modo Local)', () => {
  it('inicia diretamente na conciliação sem exibir formulário de login ou senha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          companies: [
            {
              id: 'company-1',
              organizationId: 'org-1',
              name: 'Empresa Teste',
              roles: ['ADMIN', 'PREPARER'],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);

    // Não deve exibir formulário de login ou campo de senha
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
    expect(screen.queryByText('Verificando sua sessão...')).not.toBeInTheDocument();

    // Deve exibir o badge de Modo Local e a tela de conciliação
    expect(await screen.findByText('Modo Local')).toBeInTheDocument();
    const companies = await screen.findAllByText('Empresa Teste');
    expect(companies.length).toBeGreaterThan(0);
  });

  it('inicia com empresa padrão caso a API de empresas falhe', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Falha de rede'));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthenticatedApp />);

    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
    expect(await screen.findByText('Modo Local')).toBeInTheDocument();
    const defaultCompanies = await screen.findAllByText('Empresa Principal');
    expect(defaultCompanies.length).toBeGreaterThan(0);
  });
});
