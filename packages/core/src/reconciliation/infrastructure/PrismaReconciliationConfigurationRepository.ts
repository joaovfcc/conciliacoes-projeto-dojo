import type { Prisma, PrismaClient } from "@prisma/client";
import type { ReconciliationPolicy } from "../domain/ReconciliationPolicy.js";
import type { ReconciliationProfile } from "../domain/ReconciliationProfile.js";
import type {
  ReconciliationConfigurationRepository,
  ReconciliationPeriod,
} from "../domain/ReconciliationConfigurationRepository.js";
import { decimalString } from "../../shared/domain/Decimal.js";

type ProfileRecord = Prisma.ReconciliationProfileGetPayload<{
  include: { ledgerAccounts: true };
}>;

export class PrismaReconciliationConfigurationRepository implements ReconciliationConfigurationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveProfile(profile: ReconciliationProfile): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const values = {
        companyId: profile.companyId,
        bankAccountId: profile.bankAccountId,
        matchTypeId: profile.matchTypeId,
        frequency: profile.frequency,
        riskLevel: profile.riskLevel,
        amountTolerance: profile.amountTolerance,
        dateToleranceDays: profile.dateToleranceDays,
        preparerId: profile.preparerId ?? null,
        reviewerIds: profile.reviewerIds ?? [],
        materialityThreshold: profile.materialityThreshold ?? null,
        status: profile.status,
      };
      await tx.reconciliationProfile.upsert({
        where: { id: profile.id },
        create: { id: profile.id, ...values },
        update: values,
      });
      await tx.reconciliationProfileLedgerAccount.deleteMany({
        where: { reconciliationProfileId: profile.id, ledgerAccountId: { notIn: profile.ledgerAccountIds } },
      });
      for (const ledgerAccountId of profile.ledgerAccountIds) {
        await tx.reconciliationProfileLedgerAccount.upsert({
          where: {
            reconciliationProfileId_ledgerAccountId: {
              reconciliationProfileId: profile.id,
              ledgerAccountId,
            },
          },
          create: { reconciliationProfileId: profile.id, ledgerAccountId },
          update: {},
        });
      }
    });
  }

  async findProfileById(id: string): Promise<ReconciliationProfile | null> {
    const record = await this.prisma.reconciliationProfile.findUnique({
      where: { id },
      include: { ledgerAccounts: true },
    });
    return record ? this.profile(record) : null;
  }

  async listProfilesByCompany(companyId: string): Promise<ReconciliationProfile[]> {
    const records = await this.prisma.reconciliationProfile.findMany({
      where: { companyId },
      include: { ledgerAccounts: true },
      orderBy: { createdAt: "asc" },
    });
    return records.map((record) => this.profile(record));
  }

  async savePolicy(policy: ReconciliationPolicy): Promise<void> {
    const values = {
      reconciliationProfileId: policy.reconciliationProfileId,
      matchingStrategy: policy.matchingStrategy,
      dateToleranceDays: policy.dateToleranceDays,
      amountTolerance: policy.amountTolerance,
      allowOneToMany: policy.allowOneToMany,
      allowManyToOne: policy.allowManyToOne,
      allowManyToMany: policy.allowManyToMany,
      descriptionSimilarityThreshold: policy.descriptionSimilarityThreshold ?? null,
      materialityThreshold: policy.materialityThreshold ?? null,
    };
    await this.prisma.reconciliationPolicy.upsert({
      where: { id: policy.id },
      create: { id: policy.id, ...values },
      update: values,
    });
  }

  async findPolicyByProfileId(profileId: string): Promise<ReconciliationPolicy | null> {
    const record = await this.prisma.reconciliationPolicy.findFirst({
      where: { reconciliationProfileId: profileId },
      orderBy: { updatedAt: "desc" },
    });
    return record ? {
      id: record.id,
      reconciliationProfileId: record.reconciliationProfileId,
      matchingStrategy: record.matchingStrategy as ReconciliationPolicy["matchingStrategy"],
      dateToleranceDays: record.dateToleranceDays,
      amountTolerance: decimalString(record.amountTolerance.toFixed(2)),
      allowOneToMany: record.allowOneToMany,
      allowManyToOne: record.allowManyToOne,
      allowManyToMany: record.allowManyToMany,
      ...(record.descriptionSimilarityThreshold !== null
        ? { descriptionSimilarityThreshold: record.descriptionSimilarityThreshold }
        : {}),
      ...(record.materialityThreshold !== null
        ? { materialityThreshold: decimalString(record.materialityThreshold.toFixed(2)) }
        : {}),
    } : null;
  }

  async savePeriod(period: ReconciliationPeriod): Promise<void> {
    await this.prisma.reconciliationPeriod.upsert({
      where: { id: period.id },
      create: {
        id: period.id,
        companyId: period.companyId,
        period: period.period,
        status: period.status,
        closedAt: period.closedAt ?? null,
      },
      update: { period: period.period, status: period.status, closedAt: period.closedAt ?? null },
    });
  }

  async findPeriodById(id: string): Promise<ReconciliationPeriod | null> {
    const record = await this.prisma.reconciliationPeriod.findUnique({ where: { id } });
    return record ? {
      id: record.id,
      companyId: record.companyId,
      period: record.period,
      status: record.status === "CLOSED" ? "CLOSED" : "OPEN",
      ...(record.closedAt ? { closedAt: record.closedAt } : {}),
    } : null;
  }

  private profile(record: ProfileRecord): ReconciliationProfile {
    return {
      id: record.id,
      companyId: record.companyId,
      bankAccountId: record.bankAccountId,
      ledgerAccountIds: record.ledgerAccounts.map((item) => item.ledgerAccountId).sort(),
      matchTypeId: record.matchTypeId,
      frequency: record.frequency as ReconciliationProfile["frequency"],
      riskLevel: record.riskLevel as ReconciliationProfile["riskLevel"],
      amountTolerance: decimalString(record.amountTolerance.toFixed(2)),
      dateToleranceDays: record.dateToleranceDays,
      ...(record.preparerId ? { preparerId: record.preparerId } : {}),
      ...(record.reviewerIds.length ? { reviewerIds: record.reviewerIds } : {}),
      ...(record.materialityThreshold !== null
        ? { materialityThreshold: decimalString(record.materialityThreshold.toFixed(2)) }
        : {}),
      status: record.status,
    };
  }
}
