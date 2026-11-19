import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { FINANCE_ROLES } from "@/lib/roles";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { paymentVisibilityCommand, paymentVisibilityDocumentIds, paymentVisibilityHints, paymentVisibilityProblem, readPaymentForVisibility, setPaymentVisibility } from "./visibility-reversal";

export async function deletePaymentInTransaction(actor: DomainActor, paymentId: string, tx: Prisma.TransactionClient) {
  requireActorRoles(actor, FINANCE_ROLES);
  const payment = await readPaymentForVisibility(tx, paymentId);
  const problem = await paymentVisibilityProblem(tx, payment, false);
  if (problem || !payment) throw Error(problem ?? "Платёж не найден");

  const actionId = randomUUID();
  await setPaymentVisibility(tx, payment, false, actor.id, actionId);
  await writeChangeLogInTransaction(tx, { id: actionId, actorType: "user", actorId: actor.id, actorName: actor.name,
    source: actor.source, entity: "payment", entityId: paymentId, action: "delete",
    oldValue: { project: payment.project?.number ?? null, direction: payment.direction, amount: payment.amount.toFixed(2),
      currency: payment.currency, bynAmount: payment.bynAmount.toFixed(2) },
    reversal: paymentVisibilityCommand(payment, paymentVisibilityDocumentIds(payment), true, actionId, payment.lastActionId),
  }, paymentVisibilityHints(payment, false));
  return payment;
}
