import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuditEvent, AuditRepository } from "../domain/AuditEvent.js";

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: AuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: event.id,
        companyId: event.companyId ?? null,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        actorId: event.actorId ?? null,
        occurredAt: event.occurredAt,
        ...(event.before !== undefined ? { before: event.before as Prisma.InputJsonValue } : {}),
        ...(event.after !== undefined ? { after: event.after as Prisma.InputJsonValue } : {}),
        ...(event.metadata !== undefined ? { metadata: event.metadata as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async list(entityType: string, entityId: string): Promise<AuditEvent[]> {
    const records = await this.prisma.auditEvent.findMany({
      where: { entityType, entityId },
      orderBy: { occurredAt: "asc" },
    });
    return records.map((record) => ({
      id: record.id,
      ...(record.companyId ? { companyId: record.companyId } : {}),
      entityType: record.entityType,
      entityId: record.entityId,
      action: record.action,
      ...(record.actorId ? { actorId: record.actorId } : {}),
      occurredAt: record.occurredAt,
      ...(record.before !== null ? { before: record.before } : {}),
      ...(record.after !== null ? { after: record.after } : {}),
      ...(record.metadata !== null ? { metadata: record.metadata as Record<string, unknown> } : {}),
    }));
  }
}
