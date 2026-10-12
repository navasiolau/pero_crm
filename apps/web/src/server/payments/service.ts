import {revalidatePath} from "next/cache";
import {prisma} from "@/lib/prisma";
import type {DomainActor} from "@/server/actor";
import {withTaskTransaction} from "@/server/tasks/transaction";
import {dispatchEvent} from "@/server/plugins/events";
import {notifyOrg} from "@/server/notifications/notify";
import type {PaymentInput, PaymentMutationResult} from "./contracts";
import {createPaymentScenario} from "./core";
import {preparePayment} from "./prepare";
import {deliverPaymentEffects} from "./post-commit";

export {createPaymentInTransaction, type PreparedPayment} from "./transaction";
export {paymentSchema} from "./contracts";

/** Один адаптер web/bot: сценарий подтверждает деньги, доставка не изменяет ACK. */
export async function createPaymentCore(actor: DomainActor, input: PaymentInput): Promise<PaymentMutationResult> {
  const result = await createPaymentScenario(actor, input, {reader: prisma, transaction: withTaskTransaction,
    prepare: data => preparePayment(data, prisma)});
  await deliverPaymentEffects(result.effects, {dispatchEvent, notifyOrg, revalidatePath});
  return result.ack;
}
