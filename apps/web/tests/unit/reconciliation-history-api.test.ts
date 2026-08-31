// @vitest-environment node

import type { ActorContext, CompletedReconciliation, CompletedReconciliationRepository } from '@conciliacao/core';
import { InMemoryCompletedReconciliationRepository } from '@conciliacao/core';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  getReconciliationHistory,
  deleteReconciliationHistory,
  listReconciliationHistory,
  reconciliationHistoryError,
} from '../../src/lib/reconciliation-history-api';

const now = new Date('2026-08-13T12:00:00.000Z');
const actor: ActorContext = {
  actorId: 'user-1',
  companyRoles: { 'company-1': ['AUDITOR'], 'company-2': [] },
};

describe('reconciliation history API', () => {
  it('lists only unexpired records from currently authorized companies', async () => {
    const repository = await repositoryWithRecords();
    const response = await listReconciliationHistory(request('/api/reconciliation-history'), dependencies(repository));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['visible']);
    expect(body.total).toBe(1);
  });

  it('returns detail only inside the current company scope', async () => {
    const repository = await repositoryWithRecords();
    const visible = await getReconciliationHistory(request('/api/reconciliation-history/visible'), 'visible', dependencies(repository));
    const hidden = reconciliationHistoryError(await capture(() => getReconciliationHistory(
      request('/api/reconciliation-history/other-company'), 'other-company', dependencies(repository),
    )));

    expect((await visible.json()).record.result.company).toBe('EMPRESA');
    expect(hidden.status).toBe(404);
  });

  it('rejects an explicit company filter outside current roles', async () => {
    const repository = await repositoryWithRecords();
    const response = reconciliationHistoryError(await capture(() => listReconciliationHistory(
      request('/api/reconciliation-history?companyId=company-2'),
      dependencies(repository),
    )));

    expect(response.status).toBe(403);
  });

  it('deletes a historical record inside the authorized company scope', async () => {
    const repository = await repositoryWithRecords();
    const response = await deleteReconciliationHistory(request('/api/reconciliation-history/visible'), 'visible', dependencies(repository));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, id: 'visible' });
    expect(await repository.findById('visible', ['company-1'], now)).toBeNull();
  });

  it('returns 404 when attempting to delete a record outside company scope', async () => {
    const repository = await repositoryWithRecords();
    const hidden = reconciliationHistoryError(await capture(() => deleteReconciliationHistory(
      request('/api/reconciliation-history/other-company'), 'other-company', dependencies(repository),
    )));

    expect(hidden.status).toBe(404);
  });
});

async function repositoryWithRecords(): Promise<InMemoryCompletedReconciliationRepository> {
  const repository = new InMemoryCompletedReconciliationRepository();
  await repository.save(record('visible', 'company-1', new Date('2027-08-13T12:00:00.000Z')));
  await repository.save(record('expired', 'company-1', now));
  await repository.save(record('other-company', 'company-2', new Date('2027-08-13T12:00:00.000Z')));
  return repository;
}

function record(id: string, companyId: string, expiresAt: Date): CompletedReconciliation {
  return {
    id,
    organizationId: 'org-1',
    companyId,
    userId: 'user-1',
    status: 'COMPLETED',
    period: '202601',
    confirmation: { company: 'EMPRESA', period: '202601', valueTolerance: '0.01', dateToleranceDays: 2, mappings: [], idempotencyKey: id },
    sourceFiles: [],
    result: { company: 'EMPRESA', branch: '01', period: '202601', executedAt: now.toISOString(), summaries: [], results: [], issues: [], files: [], investments: [], controls: { tolerance: '0.01', signProfiles: [], movements: { bankConciliable: '0.00', ledger: '0.00', difference: '0.00', status: 'PASSED' }, balances: { openingStatus: 'NOT_AVAILABLE', closingStatus: 'NOT_AVAILABLE' }, coverage: { lines: { covered: '0', total: '0', percentage: '0.00' }, absoluteValue: { covered: '0.00', total: '0.00', percentage: '0.00' } }, countsByStatus: [], pendingByDate: [] } },
    completedAt: now,
    expiresAt,
  };
}

function dependencies(repository: CompletedReconciliationRepository) {
  return { resolveActor: async () => actor, repository, now: () => now };
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

async function capture(action: () => Promise<unknown>): Promise<unknown> {
  try { await action(); throw new Error('Expected action to fail'); }
  catch (error) { return error; }
}
