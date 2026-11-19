import { scopedFinanceAuth } from "@/server/telegram/finance-session";
import { prisma } from "@/lib/prisma";
import { requireFinanceDocumentActor } from "./core";

export async function financeDocumentWebActorId(actorId?: string | null) {
  const userId = actorId === undefined ? (await scopedFinanceAuth())?.user.id : actorId;
  return (await requireFinanceDocumentActor(userId, prisma)).id;
}
