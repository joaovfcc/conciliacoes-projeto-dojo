import type { NextRequest } from "next/server";
import { authorized, jsonError, runtime } from "@/lib/runtime";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) {
  try { const { id, fileId } = await context.params; const session = await authorized(request, id); if (runtime().objects.mode !== "local") return Response.json({ error: { code: "UPLOAD_DIRETO_OBRIGATORIO", message: "Use a URL temporária fornecida." } }, { status: 400 }); const file = session.files.find((item) => item.id === fileId); if (!file) return Response.json({ error: { code: "ARQUIVO_NAO_ENCONTRADO", message: "Arquivo inválido." } }, { status: 404 }); const buffer = Buffer.from(await request.arrayBuffer()); if (buffer.length !== file.size) return Response.json({ error: { code: "TAMANHO_DIVERGENTE", message: "O tamanho recebido é diferente do autorizado." } }, { status: 400 }); await runtime().objects.put(file.objectKey, buffer, file.contentType); return new Response(null, { status: 204 }); }
  catch (error) { return jsonError(error); }
}
