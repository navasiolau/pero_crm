import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireFinanceDocumentActor } from "./core";

export async function financeDocumentWebActorId() {
  const session = await auth();
  return (await requireFinanceDocumentActor(session?.user.id, prisma)).id;
}
