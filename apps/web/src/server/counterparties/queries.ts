import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { COUNTERPARTY_ROLES, hasAnyRole } from "@/lib/roles";
import { counterpartySelect, type CounterpartyView } from "./contracts";

export async function listCounterparties(actor: { roles: Role[] }, db: Pick<Prisma.TransactionClient, "counterparty"> = prisma): Promise<CounterpartyView[]> {
  if (!hasAnyRole(actor.roles, COUNTERPARTY_ROLES)) throw Error("Недостаточно прав");
  return db.counterparty.findMany({ select: counterpartySelect, orderBy: [{ company: "asc" }, { id: "asc" }] });
}
