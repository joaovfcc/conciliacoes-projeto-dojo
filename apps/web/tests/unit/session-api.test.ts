// @vitest-environment node

import type { ActorContext } from '@conciliacao/core';
import { MemorySessionStore, loadRuntimeConfig, type RateLimiter } from '@conciliacao/runtime';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { authorizeReconciliationSession, createReconciliationSession, jsonError } from '../../src/lib/runtime';
import { V2HttpError } from '../../src/lib/v2-auth';

const actor: ActorContext = { actorId: 'user-1', companyRoles: { 'company-1': ['PREPARER'] } };

describe('authenticated reconciliation sessions', () => {
  it('creates a user-bound session and applies limits by user and client', async () => {
    const sessions = new MemorySessionStore(loadRuntimeConfig({}));
    const limiter = new FakeRateLimiter();
    const response = await createReconciliationSession(request({}, { companyId: 'company-1' }), dependencies(sessions, limiter));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.session).not.toHaveProperty('actorId');
    expect(await sessions.get(body.session.id)).toMatchObject({
      actorId: 'user-1', organizationId: 'org-1', companyId: 'company-1',
    });
    expect(limiter.keys).toEqual(['user:user-1', expect.stringMatching(/^client:/)]);
  });

  it('rejects session creation without a valid persistent actor', async () => {
    const sessions = new MemorySessionStore(loadRuntimeConfig({}));
    const deps = dependencies(sessions, new FakeRateLimiter());
    deps.resolveActor = async () => { throw new V2HttpError(401, 'UNAUTHORIZED', 'Credencial ausente ou inválida'); };

    const response = jsonError(await capture(() => createReconciliationSession(request({}, { companyId: 'company-1' }), deps)));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Credencial ausente ou inválida' } });
  });

  it('returns 429 with the limiter retry interval and does not create a session', async () => {
    const sessions = new MemorySessionStore(loadRuntimeConfig({}));
    const limiter = new FakeRateLimiter();
    limiter.allowed = false;

    const response = jsonError(await capture(() => createReconciliationSession(request({}, { companyId: 'company-1' }), dependencies(sessions, limiter))));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('47');
    expect(await sessions.countActive('anything')).toBe(0);
  });

  it('fails closed when reconciliation abuse protection is unavailable', async () => {
    const limiter = new FakeRateLimiter();
    limiter.failure = new Error('redis unavailable');

    const response = jsonError(await capture(() => createReconciliationSession(
      request({}, { companyId: 'company-1' }),
      dependencies(new MemorySessionStore(loadRuntimeConfig({})), limiter),
    )));

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({
      error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Proteção contra abuso indisponível' },
    });
  });

  it('fails closed when reconciliation abuse protection cannot initialize', async () => {
    const deps = dependencies(new MemorySessionStore(loadRuntimeConfig({})), new FakeRateLimiter());
    deps.rateLimiter = () => { throw new Error('missing redis configuration'); };

    const response = jsonError(await capture(() => createReconciliationSession(request({}, { companyId: 'company-1' }), deps)));

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({
      error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Proteção contra abuso indisponível' },
    });
  });

  it('requires both the opaque token and the same persistent user', async () => {
    const sessions = new MemorySessionStore(loadRuntimeConfig({}));
    const created = await sessions.create('client', 'user-1', 'org-1', 'company-1');
    const valid = request({ 'x-reconciliation-session-token': created.token });

    await expect(authorizeReconciliationSession(valid, created.session.id, accessDependencies(sessions, actor)))
      .resolves.toMatchObject({ actorId: 'user-1' });
    await expect(authorizeReconciliationSession(request(), created.session.id, accessDependencies(sessions, actor)))
      .rejects.toMatchObject({ code: 'SESSAO_NAO_AUTORIZADA', status: 401 });
    await expect(authorizeReconciliationSession(valid, created.session.id, accessDependencies(sessions, {
      actorId: 'user-2', companyRoles: {},
    }))).rejects.toMatchObject({ code: 'SESSAO_NAO_AUTORIZADA', status: 401 });
  });

  it('requires an active authorized operational company', async () => {
    const sessions = new MemorySessionStore(loadRuntimeConfig({}));
    const deps = dependencies(sessions, new FakeRateLimiter());

    const missing = jsonError(await capture(() => createReconciliationSession(request(), deps)));
    expect(missing.status).toBe(400);

    deps.resolveActor = async () => ({ actorId: 'user-1', companyRoles: { 'company-1': ['AUDITOR'] } });
    const forbidden = jsonError(await capture(() => createReconciliationSession(
      request({}, { companyId: 'company-1' }), deps,
    )));
    expect(forbidden.status).toBe(403);

    deps.resolveActor = async () => actor;
    deps.findCompany = async () => null;
    const absent = jsonError(await capture(() => createReconciliationSession(
      request({}, { companyId: 'company-1' }), deps,
    )));
    expect(absent.status).toBe(404);
  });
});

function request(headers: Record<string, string> = {}, body?: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/sessions', {
    method: 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function dependencies(sessions: MemorySessionStore, limiter: FakeRateLimiter) {
  return {
    resolveActor: async () => actor,
    sessions,
    rateLimiter: limiter as RateLimiter,
    maxSessionsPerHour: 3,
    clientKey: () => 'hashed-client',
    findCompany: async () => ({
      id: 'company-1', organizationId: 'org-1', legalEntityId: 'legal-1', name: 'Empresa',
      status: 'ACTIVE' as const, timezone: 'America/Sao_Paulo', defaultCurrency: 'BRL',
    }),
  };
}

function accessDependencies(sessions: MemorySessionStore, resolvedActor: ActorContext) {
  return { resolveActor: async () => resolvedActor, sessions };
}

async function capture(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
    throw new Error('Expected action to fail');
  } catch (error) {
    return error;
  }
}

class FakeRateLimiter {
  allowed = true;
  failure?: Error;
  keys: string[] = [];

  async consume(_policy: { limit: number }, key: string) {
    if (this.failure) throw this.failure;
    this.keys.push(key);
    return { allowed: this.allowed, remaining: this.allowed ? 2 : 0, retryAfterSeconds: 47 };
  }
}
