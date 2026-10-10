import { uploadLogisticsDocumentResponse } from "@/server/logistics/http";
import { logisticsDocuments } from "@/server/logistics/service";
import { logisticsWebActorId } from "@/server/logistics/web-actor";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return uploadLogisticsDocumentResponse(request, { authorize: () => logisticsWebActorId("manage"), service: logisticsDocuments });
}
