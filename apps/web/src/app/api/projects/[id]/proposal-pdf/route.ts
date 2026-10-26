import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { privateFileHeaders } from "@/server/files/private-response";
import { KpApiError } from "@/server/kp/api-contract";
import { readProjectProposalPdf } from "@/server/kp/project-pdf";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Нужна авторизация" }, { status: 401, headers });
  try {
    const file = await readProjectProposalPdf(prisma, async () => {
      const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, active: true, roles: true, sessionVersion: true } });
      return user?.active && user.sessionVersion === session.user.sessionVersion ? user : null;
    }, (await params).id, undefined, request.signal);
    if (!file) return Response.json({ error: "Файл не найден" }, { status: 404, headers });
    return new Response("body" in file ? file.body : new Uint8Array(file.bytes), { headers: privateFileHeaders({ mimeType: file.mimeType, fileName: file.fileName,
      size: "body" in file ? file.size : file.bytes.byteLength, inline: new URL(request.url).searchParams.get("view") === "1" ? "pdf" : undefined }) });
  } catch (error) {
    return Response.json({ error: error instanceof KpApiError ? error.message : "Не удалось открыть документ" },
      { status: error instanceof KpApiError ? error.status : 503, headers });
  }
}
