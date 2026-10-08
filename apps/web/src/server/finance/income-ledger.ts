import type { PrismaClient } from "@prisma/client";
import type { FinanceWorkspaceActor } from "./project-refs";
import { loadOrganizationPayments } from "./organization-ledger";

export async function loadOrganizationIncome(actor: FinanceWorkspaceActor, db: Pick<PrismaClient, "project" | "payment" | "cashAccount">) {
  return loadOrganizationPayments(actor, "INCOME", db);
}
