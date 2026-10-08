import { NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/server/api/auth";
import { resolveBotActor, isActorError, requireBotFinance, domainError } from "@/server/telegram/bot-api";
import { createStockPurchaseCore, quoteStockPurchaseCore } from "./stock-purchase-service";
export async function stockPurchaseHttp(request: Request, operation: "quote" | "create") {
  const auth = await authenticate(request, operation === "quote" ? "read" : "write");
  if (isErrorResponse(auth)) return auth;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const denied = requireBotFinance(actor); if (denied) return denied;
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ ok: false, error: "Пустой запрос" }, { status: 400 });
  try { return NextResponse.json(await (operation === "quote" ? quoteStockPurchaseCore : createStockPurchaseCore)(actor, input)); }
  catch (error) { return domainError(error); }
}
