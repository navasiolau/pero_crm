import { readLogisticsDocumentResponse } from "@/server/logistics/http";
import { logisticsDocuments } from "@/server/logistics/service";
import { logisticsWebActorId } from "@/server/logistics/web-actor";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return readLogisticsDocumentResponse(request, (await params).id, { authorize: () => logisticsWebActorId("documents"), service: logisticsDocuments });
}
