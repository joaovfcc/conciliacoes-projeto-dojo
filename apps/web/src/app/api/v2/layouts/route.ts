import type { NextRequest } from "next/server";
import {
  PrismaBankAccountRepository,
  PrismaLayoutRepository,
  prisma,
  type StatementLayoutProfile,
} from "@conciliacao/core";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireV2Actor, v2RouteError } from "../../../../lib/v2-auth";

const stringList = z.array(z.string().trim().min(1)).min(1);
const optionalStringList = z.array(z.string().trim().min(1)).optional();
const profileSchema = z.object({
  companyId: z.string().trim().min(1),
  id: z.string().trim().min(1).max(160).optional(),
  version: z.number().int().positive().default(1),
  status: z.enum(["EXPERIMENTAL", "VALIDATED", "DEPRECATED"]).default("EXPERIMENTAL"),
  bankCode: z.string().trim().max(20),
  bankAccountId: z.string().trim().min(1),
  priority: z.number().int().min(1).max(1_000).default(100),
  fingerprint: z.object({
    format: z.enum(["CSV", "XLSX", "XLS", "XLSM"]),
    normalizedHeaders: z.array(z.string()),
    columnCount: z.number().int().nonnegative(),
    headerRowIndex: z.number().int().nonnegative(),
    detectedColumnTypes: z.array(z.string()),
    bankHints: z.array(z.string()),
    sheetHints: z.array(z.string()),
    fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  productType: z.enum(["CHECKING", "INVESTMENT", "COLLECTION", "OTHER"]),
  formats: z.array(z.enum(["CSV", "XLSX", "XLS", "XLSM"])).min(1),
  detection: z.object({
    sheetNameAliases: optionalStringList,
    requiredHeaderGroups: z.array(stringList).min(1),
    optionalHeaders: optionalStringList,
    negativeSheetNames: optionalStringList,
    minimumScore: z.number().min(0).max(100),
  }),
  columns: z.object({
    date: stringList,
    description: stringList,
    document: optionalStringList,
    amount: optionalStringList,
    debit: optionalStringList,
    credit: optionalStringList,
    balance: optionalStringList,
  }).refine((columns) => Boolean(columns.amount?.length || columns.debit?.length || columns.credit?.length), {
    message: "Mapeie valor ou ao menos uma coluna de débito/crédito",
  }),
  rules: z.object({
    headerScanRows: z.number().int().min(1).max(500),
    negativeAmountMeansDebit: z.boolean(),
    inheritDateFromPreviousRow: z.boolean().optional(),
    repeatedHeaderPolicy: z.enum(["IGNORE", "ERROR"]).optional(),
    ignoreRowPatterns: optionalStringList,
    stopPatterns: optionalStringList,
  }),
});

export async function GET(request: NextRequest) {
  try {
    const companyId = request.nextUrl.searchParams.get("companyId");
    if (!companyId) return Response.json({ error: { code: "COMPANY_REQUIRED", message: "Informe companyId" } }, { status: 400 });
    requireV2Actor(request, companyId);
    const layoutRepo = new PrismaLayoutRepository(prisma);
    const profiles = await layoutRepo.findAll();

    return Response.json({ profiles }, { status: 200 });
  } catch (error) { return v2RouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const data = profileSchema.parse(await request.json());
    requireV2Actor(request, data.companyId, ["ADMIN"]);
    const account = await new PrismaBankAccountRepository(prisma).findById(data.bankAccountId);
    if (!account || account.companyId !== data.companyId) {
      return Response.json(
        { error: { code: "BANK_ACCOUNT_NOT_FOUND", message: "A conta bancária não pertence à empresa" } },
        { status: 422 },
      );
    }

    const layoutRepo = new PrismaLayoutRepository(prisma);

    const profile: StatementLayoutProfile = {
      id: data.id ?? randomUUID(),
      version: data.version,
      status: data.status,
      bankCode: data.bankCode,
      productType: data.productType,
      formats: data.formats,
      detection: {
        requiredHeaderGroups: data.detection.requiredHeaderGroups,
        minimumScore: data.detection.minimumScore,
        ...(data.detection.sheetNameAliases ? { sheetNameAliases: data.detection.sheetNameAliases } : {}),
        ...(data.detection.optionalHeaders ? { optionalHeaders: data.detection.optionalHeaders } : {}),
        ...(data.detection.negativeSheetNames ? { negativeSheetNames: data.detection.negativeSheetNames } : {}),
      },
      columns: {
        date: data.columns.date,
        description: data.columns.description,
        ...(data.columns.document ? { document: data.columns.document } : {}),
        ...(data.columns.amount ? { amount: data.columns.amount } : {}),
        ...(data.columns.debit ? { debit: data.columns.debit } : {}),
        ...(data.columns.credit ? { credit: data.columns.credit } : {}),
        ...(data.columns.balance ? { balance: data.columns.balance } : {}),
      },
      rules: {
        headerScanRows: data.rules.headerScanRows,
        negativeAmountMeansDebit: data.rules.negativeAmountMeansDebit,
        ...(data.rules.inheritDateFromPreviousRow !== undefined
          ? { inheritDateFromPreviousRow: data.rules.inheritDateFromPreviousRow }
          : {}),
        ...(data.rules.repeatedHeaderPolicy ? { repeatedHeaderPolicy: data.rules.repeatedHeaderPolicy } : {}),
        ...(data.rules.ignoreRowPatterns ? { ignoreRowPatterns: data.rules.ignoreRowPatterns } : {}),
        ...(data.rules.stopPatterns ? { stopPatterns: data.rules.stopPatterns } : {}),
      },
    };

    await layoutRepo.save(profile, {
      approvedBy: requireV2Actor(request).actorId,
      approvedAt: new Date(),
      fingerprint: data.fingerprint,
      bankAccountId: data.bankAccountId,
      priority: data.priority,
    });

    return Response.json({ success: true, profile }, { status: 201 });
  } catch (error) { return v2RouteError(error); }
}
