import { auth } from "@/auth";
import { scopedFinanceAuth } from "@/server/telegram/finance-session";
import { prisma } from "@/lib/prisma";
import { requireLogisticsActor } from "./core";

export async function logisticsWebActorId(mode: "manage" | "documents" = "manage") {
  const session = await (mode === "documents" ? scopedFinanceAuth() : auth());
  return (await requireLogisticsActor(session?.user.id, prisma, mode)).id;
}
