'use client';

import { useEffect, useState } from 'react';
import { ReconciliationApp } from './reconciliation-app';

type AuthorizedCompany = {
  id: string;
  organizationId: string;
  name: string;
  roles: Array<'PREPARER' | 'REVIEWER' | 'ADMIN' | 'AUDITOR'>;
};

const DEFAULT_COMPANY: AuthorizedCompany = {
  id: 'org-default-001',
  organizationId: 'org-default-001',
  name: 'Empresa Principal',
  roles: ['ADMIN', 'PREPARER', 'REVIEWER', 'AUDITOR'],
};

export function AuthenticatedApp() {
  const [companies, setCompanies] = useState<AuthorizedCompany[]>([DEFAULT_COMPANY]);

  useEffect(() => {
    void fetch('/api/companies', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { companies?: AuthorizedCompany[] };
      })
      .then((data) => {
        if (data?.companies && data.companies.length > 0) {
          setCompanies(data.companies);
        }
      })
      .catch(() => {
        // Mantém DEFAULT_COMPANY se houver falha de rede
      });
  }, []);

  const localFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    return fetch(input, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: 'Bearer local-access-token',
      },
    });
  };

  return (
    <ReconciliationApp
      companies={companies}
      userEmail="Modo Local"
      logout={async () => {}}
      authenticatedFetch={localFetch}
    />
  );
}
