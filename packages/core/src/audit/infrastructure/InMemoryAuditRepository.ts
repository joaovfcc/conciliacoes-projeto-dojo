import type { AuditEvent, AuditRepository } from "../domain/AuditEvent.js";

export class InMemoryAuditRepository implements AuditRepository {
  readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async list(entityType: string, entityId: string): Promise<AuditEvent[]> {
    return this.events.filter((event) => event.entityType === entityType && event.entityId === entityId).map((event) => structuredClone(event));
  }
}
