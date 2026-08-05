import { PublicRuntimeError } from "@conciliacao/runtime";
import type { NextRequest } from "next/server";
import { clientKey, jsonError, runtime } from "@/lib/runtime";

export async function POST(request: NextRequest) {
  try {
    const services = runtime(); const key = clientKey(request);
    if (await services.sessions.countActive(key) >= services.config.maxSessionsPerIp) throw new PublicRuntimeError("SESSAO_ATIVA", "Este endereço já possui uma sessão ativa.", 429);
    if (await services.sessions.countCreatedLastHour(key) >= services.config.maxSessionsPerHour) throw new PublicRuntimeError("LIMITE_HORARIO", "O limite de três sessões por hora foi atingido.", 429);
    return Response.json(await services.sessions.create(key), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
