import {
  generateXlsx,
  PrismaCompletedReconciliationRepository,
  prisma,
  type ActorContext,
  type CompletedReconciliationRepository,
} from "@conciliacao/core";
import type { NextRequest } from "next/server";
import { requireV2Actor, V2HttpError } from "./v2-auth";

import { getLocalReconciliationRepository, listLocalCompanies } from "./local-store";

type HistoryDependencies = {
  resolveActor(request: NextRequest): Promise<ActorContext>;
  repository: CompletedReconciliationRepository;
  now(): Date;
};

function getHistoryRepository(): CompletedReconciliationRepository {
  if (process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL) {
    return getLocalReconciliationRepository();
  }
  return new PrismaCompletedReconciliationRepository(prisma);
}

const defaultDependencies: HistoryDependencies = {
  resolveActor: requireV2Actor,
  get repository() {
    return getHistoryRepository();
  },
  now: () => new Date(),
};

export async function listReconciliationHistory(
  request: NextRequest,
  dependencies: HistoryDependencies = defaultDependencies,
): Promise<Response> {
  const actor = await dependencies.resolveActor(request);
  const readable = readableCompanyIds(actor);
  const requestedCompanyId = request.nextUrl.searchParams.get("companyId")?.trim();
  if (requestedCompanyId && !readable.includes(requestedCompanyId)) throw forbidden();
  const page = boundedInteger(request.nextUrl.searchParams.get("page"), 1, 1, 10_000);
  const size = boundedInteger(request.nextUrl.searchParams.get("size"), 20, 1, 100);
  const result = await dependencies.repository.list(
    requestedCompanyId ? [requestedCompanyId] : readable,
    page,
    size,
    dependencies.now(),
  );
  return noStoreJson({ ...result, page, size });
}

export async function getReconciliationHistory(
  request: NextRequest,
  id: string,
  dependencies: HistoryDependencies = defaultDependencies,
): Promise<Response> {
  const actor = await dependencies.resolveActor(request);
  const record = await dependencies.repository.findById(id, readableCompanyIds(actor), dependencies.now());
  if (!record) throw notFound();
  return noStoreJson({ record });
}

export async function exportReconciliationHistory(
  request: NextRequest,
  id: string,
  dependencies: HistoryDependencies = defaultDependencies,
): Promise<Response> {
  const actor = await dependencies.resolveActor(request);
  const record = await dependencies.repository.findById(id, readableCompanyIds(actor), dependencies.now());
  if (!record) throw notFound();
  const buffer = await generateXlsx(record.result);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="CONCILIACAO_${record.period}.xlsx"`,
      "Cache-Control": "no-store, max-age=0",
      "Content-Length": String(buffer.length),
    },
  });
}

export async function deleteReconciliationHistory(
  request: NextRequest,
  id: string,
  dependencies: HistoryDependencies = defaultDependencies,
): Promise<Response> {
  const actor = await dependencies.resolveActor(request);
  const record = await dependencies.repository.findById(id, readableCompanyIds(actor), dependencies.now());
  if (!record) throw notFound();
  await dependencies.repository.delete(id);
  return noStoreJson({ success: true, id });
}

export async function updateReconciliationHistory(
  request: NextRequest,
  id: string,
  dependencies: HistoryDependencies = defaultDependencies,
): Promise<Response> {
  const actor = await dependencies.resolveActor(request);
  const record = await dependencies.repository.findById(id, readableCompanyIds(actor), dependencies.now());
  if (!record) throw notFound();
  const body = (await request.json()) as { result?: import("@conciliacao/core").ProcessingResult };
  if (!body.result) {
    return noStoreJson({ error: { code: "BAD_REQUEST", message: "Resultado não fornecido para atualização." } }, 400);
  }
  record.result = body.result;
  await dependencies.repository.save(record);
  return noStoreJson({ success: true, record });
}

export function reconciliationHistoryError(error: unknown): Response {
  if (error instanceof V2HttpError) {
    return noStoreJson({ error: { code: error.code, message: error.message } }, error.status);
  }
  console.error(JSON.stringify({ event: "history_request_failed", errorType: error instanceof Error ? error.name : "Unknown" }));
  return noStoreJson({ error: { code: "INTERNAL_ERROR", message: "Não foi possível consultar o histórico" } }, 500);
}

function readableCompanyIds(actor: ActorContext): string[] {
  if (process.env.LOCAL_MODE === "true" || !process.env.DATABASE_URL) {
    return listLocalCompanies().map((c) => c.id);
  }
  return Object.entries(actor.companyRoles)
    .filter(([, roles]) => roles.some((role) => ["PREPARER", "REVIEWER", "ADMIN", "AUDITOR"].includes(role)))
    .map(([companyId]) => companyId);
}

function boundedInteger(raw: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(raw ?? String(fallback), 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function forbidden(): V2HttpError {
  return new V2HttpError(403, "FORBIDDEN", "Acesso negado para a empresa informada");
}

function notFound(): V2HttpError {
  return new V2HttpError(404, "HISTORY_NOT_FOUND", "Conciliação não encontrada");
}
