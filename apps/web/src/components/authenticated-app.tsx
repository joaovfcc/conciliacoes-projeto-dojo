'use client';

import { useEffect, useRef, useState } from 'react';
import { ReconciliationApp } from './reconciliation-app';

type AuthUser = {
  id: string;
  email: string;
  passwordChangeRequired: boolean;
  ownerOrganizationIds: string[];
  companyRoles: Record<string, Array<'PREPARER' | 'REVIEWER' | 'ADMIN' | 'AUDITOR'>>;
  companies: Array<{
    id: string;
    organizationId: string;
    name: string;
    roles: Array<'PREPARER' | 'REVIEWER' | 'ADMIN' | 'AUDITOR'>;
  }>;
};

type AuthGrant = { accessToken: string; accessExpiresAt: string; user: AuthUser };
type AuthState =
  | { status: 'RESTORING' }
  | { status: 'SIGNING_OUT' }
  | { status: 'SIGNED_OUT' }
  | { status: 'AUTHENTICATED'; user: AuthUser };

export function AuthenticatedApp() {
  const [state, setState] = useState<AuthState>({ status: 'RESTORING' });
  const [error, setError] = useState('');
  const [standbySeconds, setStandbySeconds] = useState(0);
  const accessToken = useRef<string | null>(null);
  const refreshPromise = useRef<Promise<AuthGrant | null> | null>(null);
  const restoreStarted = useRef(false);
  const authGeneration = useRef(0);

  async function refresh(updateState = true): Promise<AuthGrant | null> {
    if (refreshPromise.current) return refreshPromise.current;
    const generation = authGeneration.current;
    refreshPromise.current = fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' })
      .then(async (response) => (response.ok ? (response.json() as Promise<AuthGrant>) : null))
      .then((grant) => {
        if (generation === authGeneration.current) {
          if (updateState) {
            accessToken.current = grant?.accessToken ?? null;
            setState(grant ? { status: 'AUTHENTICATED', user: grant.user } : { status: 'SIGNED_OUT' });
          }
        }
        return grant;
      })
      .catch(() => {
        if (generation === authGeneration.current) {
          accessToken.current = null;
          if (updateState) setState({ status: 'SIGNED_OUT' });
        }
        return null;
      })
      .finally(() => {
        refreshPromise.current = null;
      });
    return refreshPromise.current;
  }

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void refresh();
  }, []);

  async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const requestGeneration = authGeneration.current;
    const execute = (token: string) => fetch(input, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` },
    });
    let token = accessToken.current;
    if (!token) token = (await refresh())?.accessToken ?? null;
    if (!token) return new Response(null, { status: 401 });
    const attemptedToken = token;
    let response = await execute(token);
    if (requestGeneration === authGeneration.current && await shouldRefreshAccess(response)) {
      const currentToken = accessToken.current;
      if (currentToken && currentToken !== attemptedToken) {
        response = await execute(currentToken);
      } else {
        const renewed = await refresh();
        if (renewed) response = await execute(renewed.accessToken);
      }
    }
    return response;
  }

  async function login(email: string, password: string): Promise<void> {
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.json() as { error?: { code?: string; message?: string; retryAfterSeconds?: number } };
      if (response.status === 429) {
        const seconds = body.error?.retryAfterSeconds ?? 300;
        setStandbySeconds(seconds);
      }
      setError(body.error?.message ?? 'Não foi possível entrar');
      return;
    }
    const grant = await response.json() as AuthGrant;
    authGeneration.current += 1;
    accessToken.current = grant.accessToken;
    setStandbySeconds(0);
    setState({ status: 'AUTHENTICATED', user: grant.user });
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    setError('');
    const response = await authenticatedFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.json() as { error?: { message?: string } };
      setError(body.error?.message ?? 'Não foi possível trocar a senha');
      return;
    }
    authGeneration.current += 1;
    accessToken.current = null;
    setState({ status: 'SIGNED_OUT' });
  }

  async function logout(): Promise<void> {
    authGeneration.current += 1;
    const generation = authGeneration.current;
    const pendingRefresh = refreshPromise.current;
    let token = accessToken.current;
    accessToken.current = null;
    setState({ status: 'SIGNING_OUT' });
    const pendingGrant = await pendingRefresh;
    token = pendingGrant?.accessToken ?? token;
    if (!token) token = (await refresh(false))?.accessToken ?? null;
    if (token) {
      let response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }).catch(() => null);
      if (response?.status === 401) {
        const renewed = await refresh(false);
        if (renewed) response = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${renewed.accessToken}` },
          cache: 'no-store',
        }).catch(() => null);
      }
    }
    if (generation === authGeneration.current) {
      accessToken.current = null;
      setState({ status: 'SIGNED_OUT' });
    }
  }

  if (state.status === 'RESTORING') {
    return (
      <AuthFrame>
        <div className="auth-status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          <span className="spinner spinner-lg" />
          <span>Verificando sua sessão...</span>
        </div>
      </AuthFrame>
    );
  }
  if (state.status === 'SIGNING_OUT') {
    return (
      <AuthFrame>
        <div className="auth-status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          <span className="spinner spinner-lg" />
          <span>Encerrando sua sessão...</span>
        </div>
      </AuthFrame>
    );
  }
  if (state.status === 'SIGNED_OUT') {
    return (
      <AuthFrame>
        <LoginForm
          login={login}
          error={error}
          standbySeconds={standbySeconds}
          onStandbyEnd={() => {
            setStandbySeconds(0);
            setError('');
          }}
        />
      </AuthFrame>
    );
  }
  if (state.user.passwordChangeRequired) {
    return <AuthFrame><PasswordForm changePassword={changePassword} logout={logout} error={error} /></AuthFrame>;
  }
  return <ReconciliationApp companies={state.user.companies} userEmail={state.user.email} logout={logout} authenticatedFetch={authenticatedFetch} />;
}

async function shouldRefreshAccess(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = await response.clone().json() as { error?: { code?: string } };
    return body.error?.code === 'UNAUTHORIZED' || body.error?.code === 'SESSION_INVALID';
  } catch {
    return false;
  }
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="auth-shell">{children}</main>
    </>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">C</div>
        <div>
          <h1>Concilia</h1>
          <p>Razão Protheus × Extratos Bancários</p>
        </div>
      </div>
    </header>
  );
}

function LoginForm({
  login,
  error,
  standbySeconds = 0,
  onStandbyEnd,
}: {
  login: (email: string, password: string) => Promise<void>;
  error: string;
  standbySeconds?: number;
  onStandbyEnd?: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(standbySeconds);

  useEffect(() => {
    setRemaining(standbySeconds);
  }, [standbySeconds]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (onStandbyEnd) onStandbyEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [remaining, onStandbyEnd]);

  const isLocked = remaining > 0;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <section className="card auth-card">
      <h2>Acesso ao Concilia</h2>

      {isLocked ? (
        <div className="auth-standby-banner" role="alert">
          <div className="standby-icon">🔒</div>
          <div className="standby-content">
            <strong>Acesso temporariamente em standby</strong>
            <p>Limite de 5 tentativas de login excedido. Por segurança, aguarde o período de espera.</p>
            <div className="standby-countdown">
              Tente novamente em: <span className="countdown-timer">{formattedTime} min</span>
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (isLocked) return;
          setBusy(true);
          void login(email, password).finally(() => setBusy(false));
        }}
      >
        <label className="field">
          E-mail
          <input
            type="email"
            autoComplete="username"
            required
            disabled={isLocked || busy}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          Senha
          <input
            type="password"
            autoComplete="current-password"
            required
            disabled={isLocked || busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="button" disabled={busy || isLocked}>
          {busy ? 'Entrando...' : isLocked ? `Standby (${formattedTime})` : 'Entrar'}
        </button>
      </form>

      <div className="security-hint">
        5 tentativas antes do bloqueio temporário
      </div>
    </section>
  );
}

function PasswordForm({ changePassword, logout, error }: { changePassword: (current: string, next: string) => Promise<void>; logout: () => Promise<void>; error: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirmation.length > 0 && next !== confirmation;
  return (
    <section className="card auth-card">
      <h2>Crie uma nova senha</h2>
      {error ? <div className="notice error" role="alert">{error}</div> : null}
      <form onSubmit={(event) => { event.preventDefault(); if (mismatch) return; setBusy(true); void changePassword(current, next).finally(() => setBusy(false)); }}>
        <label className="field">
          Senha temporária
          <input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} />
        </label>
        <label className="field">
          Nova senha
          <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={next} onChange={(event) => setNext(event.target.value)} />
        </label>
        <label className="field">
          Confirme a nova senha
          <input type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        {mismatch ? <div className="notice error">As senhas não coincidem.</div> : null}
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="button secondary" onClick={() => void logout()}>Sair</button>
          <button className="button" disabled={busy || mismatch}>{busy ? "Salvando..." : "Trocar senha"}</button>
        </div>
      </form>
    </section>
  );
}
