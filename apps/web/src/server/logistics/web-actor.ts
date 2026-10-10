import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireLogisticsActor } from "./core";

export async function logisticsWebActorId(mode: "manage" | "documents" = "manage") {
  return (await requireLogisticsActor((await auth())?.user.id, prisma, mode)).id;
}
