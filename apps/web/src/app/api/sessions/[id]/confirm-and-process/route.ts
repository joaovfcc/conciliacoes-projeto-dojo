import type { ConfirmProcessingRequest } from "@conciliacao/core";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorized, jsonError, publicSession, runtime } from "@/lib/runtime";

const confirmationSchema = z.object({
  company: z.string().trim().max(120),
  branch: z.string().trim().max(120).optional(),
  period: z.string().regex(/^\d{6}$/),
  valueTolerance: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/),
  dateToleranceDays: z.number().int().min(0).max(3),
  mappings: z.array(z.object({
    ledgerAccount: z.string().trim().min(1).max(80),
    statementFileIds: z.array(z.string().trim().min(1)).min(1).max(5),
    signProfile: z.enum(["BANK_ASSET", "BANK_LIABILITY", "INVESTMENT_ASSET"]),
  })).max(5),
  idempotencyKey: z.string().trim().min(1).max(100),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await authorized(request, id);
    const { branch, ...required } = confirmationSchema.parse(await request.json());
    const input: ConfirmProcessingRequest = branch === undefined ? required : { ...required, branch };
    await runtime().enqueue(session, input);
    const updated = await runtime().sessions.get(id);
    return Response.json({ session: publicSession(updated!) }, { status: updated?.status === "QUEUED" ? 202 : 200 });
  }
  catch (error) { return jsonError(error); }
}
