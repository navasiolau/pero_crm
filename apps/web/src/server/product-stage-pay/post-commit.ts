import { formatAmount } from "@/lib/format";
import { productStatusLabels } from "@/lib/product-statuses";

type Personal = { userId: string; type: string; title: string; body?: string; link?: string };
type Org = { type: string; title: string; body?: string; link?: string; exceptUserId?: string };
export type EngineeringEffects = {
  dispatchEvent: (eventId: string) => Promise<unknown>;
  notifyPerson: (input: Personal) => Promise<unknown>;
  notifyOrg: (input: Org) => Promise<unknown>;
};

async function safe(operation: () => Promise<unknown>): Promise<void> {
  try { await operation(); } catch { /* outbox retries events; notifications cannot unwind committed work */ }
}

/** Invoke only after withTaskTransaction has resolved. */
export async function deliverEngineeringCreated(result: {
  eventIds: string[]; assigneeId: string; taskTitle: string; projectNumber: string;
}, effects: EngineeringEffects): Promise<void> {
  for (const eventId of result.eventIds) await safe(() => effects.dispatchEvent(eventId));
  await safe(() => effects.notifyPerson({ userId: result.assigneeId, type: "task.assigned",
    title: `Вам назначена задача: ${result.taskTitle}`, body: `Проект ${result.projectNumber}`, link: "/my" }));
}

/** Replayed receipt emits no event and no duplicate notification. */
export async function deliverEngineeringClosed(result: {
  repeated: boolean; eventIds: string[]; product: { number: string; title: string } | null;
  earnings: { userId: string; name: string; amount: string; currency: string }[];
}, actorId: string, effects: EngineeringEffects): Promise<void> {
  if (result.repeated || !result.product) return;
  for (const eventId of result.eventIds) await safe(() => effects.dispatchEvent(eventId));
  await safe(() => effects.notifyOrg({ type: "product.statusChanged",
    title: `${result.product!.number}: ${productStatusLabels.DESIGN} → ${productStatusLabels.PRODUCTION}`,
    body: result.product!.title, link: `/products/${result.product!.number}`, exceptUserId: actorId }));
  for (const earning of result.earnings) {
    await safe(() => effects.notifyPerson({ userId: earning.userId, type: "payroll.accrued",
      title: `Начислена зарплата: ${formatAmount(earning.amount, earning.currency)}`,
      body: `Инженерный фонд изделия ${result.product!.number}`, link: "/payroll" }));
    await safe(() => effects.notifyOrg({ type: "payroll.orgAccrued",
      title: `Начислено ${earning.name}: ${formatAmount(earning.amount, earning.currency)}`,
      body: `Инженерный фонд изделия ${result.product!.number}`, link: "/finance/payroll", exceptUserId: actorId }));
  }
}
