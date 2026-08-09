export interface AuditEvent {
  id: string;
  companyId?: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  occurredAt: Date;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(entityType: string, entityId: string): Promise<AuditEvent[]>;
}
