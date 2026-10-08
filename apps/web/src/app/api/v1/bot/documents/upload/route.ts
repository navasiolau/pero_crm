import { authenticate, isErrorResponse } from "@/server/api/auth";
import { isActorError, requireBotFinance, resolveBotActor } from "@/server/telegram/bot-api";
import { uploadFinanceDocumentResponse } from "@/server/finance-documents/http";
import { financeDocuments } from "@/server/finance-documents/service";

export async function POST(request: Request) {
  const authentication = await authenticate(request, "write");
  if (isErrorResponse(authentication)) return authentication;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const denied = requireBotFinance(actor);
  if (denied) return denied;
  return uploadFinanceDocumentResponse(request, { authorize: async () => actor.id, service: financeDocuments, source: "telegram" });
}
