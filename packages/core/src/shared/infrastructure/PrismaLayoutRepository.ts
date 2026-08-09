import { createHash } from "node:crypto";
import type { LayoutStatus, Prisma, PrismaClient } from "@prisma/client";
import type { LayoutRepository, SaveLayoutOptions } from "../domain/LayoutRepository.js";
import type { StatementLayoutProfile } from "../../statements/statement-types.js";
import type { TabularSourceFormat } from "../../tabular/tabular-types.js";

type VersionWithLayout = Prisma.LayoutVersionGetPayload<{ include: { layout: true } }>;

export class PrismaLayoutRepository implements LayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(profile: StatementLayoutProfile, options?: SaveLayoutOptions): Promise<void> {
    const status = this.toPersistenceStatus(profile.status);
    const payload = {
      formats: profile.formats,
      detectionRules: profile.detection as unknown as Prisma.InputJsonValue,
      columnMapping: profile.columns as unknown as Prisma.InputJsonValue,
      parsingRules: profile.rules as unknown as Prisma.InputJsonValue,
      fingerprint: (options?.fingerprint ?? { source: "PROFILE", profileId: profile.id }) as Prisma.InputJsonValue,
      fingerprintHash: options?.fingerprint?.fingerprintHash
        ?? createHash("sha256").update(JSON.stringify(profile.detection)).digest("hex"),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.statementLayout.upsert({
        where: { id: profile.id },
        update: { bankCode: profile.bankCode, productType: profile.productType },
        create: {
          id: profile.id,
          name: profile.id,
          bankCode: profile.bankCode,
          productType: profile.productType,
        },
      });

      const existing = await tx.layoutVersion.findUnique({
        where: { layoutId_version: { layoutId: profile.id, version: profile.version } },
      });
      if (existing && existing.status !== "DRAFT") {
        const unchanged =
          JSON.stringify(existing.detectionRules) === JSON.stringify(payload.detectionRules) &&
          JSON.stringify(existing.columnMapping) === JSON.stringify(payload.columnMapping) &&
          JSON.stringify(existing.parsingRules) === JSON.stringify(payload.parsingRules);
        if (!unchanged) throw new Error("Uma versão de layout ativa é imutável.");
      }

      const version = existing && existing.status !== "DRAFT" ? existing : await tx.layoutVersion.upsert({
        where: { layoutId_version: { layoutId: profile.id, version: profile.version } },
        update: {
          ...payload,
          status,
          ...(profile.status === "VALIDATED" && options?.approvedBy
            ? { approvedBy: options.approvedBy, approvedAt: options.approvedAt ?? new Date() }
            : {}),
        },
        create: {
          layoutId: profile.id,
          version: profile.version,
          status,
          ...payload,
          ...(profile.status === "VALIDATED" && options?.approvedBy
            ? { approvedBy: options.approvedBy, approvedAt: options.approvedAt ?? new Date() }
            : {}),
        },
      });
      if (options?.bankAccountId) {
        await tx.accountLayoutBinding.upsert({
          where: {
            bankAccountId_layoutVersionId: {
              bankAccountId: options.bankAccountId,
              layoutVersionId: version.id,
            },
          },
          create: {
            bankAccountId: options.bankAccountId,
            layoutVersionId: version.id,
            priority: options.priority ?? 100,
          },
          update: { priority: options.priority ?? 100, status: "ACTIVE" },
        });
      }
    });
  }

  async findAll(): Promise<StatementLayoutProfile[]> {
    const records = await this.prisma.layoutVersion.findMany({
      include: { layout: true },
      orderBy: [{ layoutId: "asc" }, { version: "desc" }],
    });
    return records.map((record) => this.mapToDomain(record));
  }

  async findActiveForAccount(bankAccountId: string): Promise<StatementLayoutProfile[]> {
    const bindings = await this.prisma.accountLayoutBinding.findMany({
      where: { bankAccountId, status: "ACTIVE", layoutVersion: { status: "ACTIVE" } },
      include: { layoutVersion: { include: { layout: true } } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    return bindings.map((binding) => this.mapToDomain(binding.layoutVersion));
  }

  async findById(id: string): Promise<StatementLayoutProfile | null> {
    const record = await this.prisma.layoutVersion.findFirst({
      where: { layoutId: id },
      include: { layout: true },
      orderBy: { version: "desc" },
    });
    return record ? this.mapToDomain(record) : null;
  }

  private toPersistenceStatus(status: StatementLayoutProfile["status"]): LayoutStatus {
    if (status === "VALIDATED") return "ACTIVE";
    if (status === "DEPRECATED") return "DEPRECATED";
    return "DRAFT";
  }

  private mapToDomain(record: VersionWithLayout): StatementLayoutProfile {
    return {
      id: record.layoutId,
      version: record.version,
      status: record.status === "ACTIVE" ? "VALIDATED" : record.status === "DEPRECATED" ? "DEPRECATED" : "EXPERIMENTAL",
      bankCode: record.layout.bankCode ?? "GENERIC",
      productType: (record.layout.productType ?? "OTHER") as StatementLayoutProfile["productType"],
      formats: record.formats as TabularSourceFormat[],
      detection: record.detectionRules as unknown as StatementLayoutProfile["detection"],
      columns: record.columnMapping as unknown as StatementLayoutProfile["columns"],
      rules: record.parsingRules as unknown as StatementLayoutProfile["rules"],
    };
  }
}
