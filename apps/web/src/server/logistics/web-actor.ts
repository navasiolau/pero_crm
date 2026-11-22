import type { Session } from "next-auth";
import { financeSessionSource, scopedFinanceAuth } from "@/server/telegram/finance-session";
import { prisma } from "@/lib/prisma";
import { requireLogisticsActor } from "./core";

export async function logisticsWebActorId(mode: "manage" | "documents", session?: Session | null) {
  const current = session === undefined ? await scopedFinanceAuth() : session;
  return (await requireLogisticsActor(current?.user.id, prisma, mode, current ? financeSessionSource(current) : "web")).id;
}
