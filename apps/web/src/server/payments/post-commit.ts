import { formatAmount } from "@/lib/format";
import { deliverPostCommit } from "@/server/operations/post-commit";

export type PaymentEffectContext = {paymentId: string; eventId: string | null; actorId: string;
  project: {id: string; number: string} | null; direction: "INCOME" | "EXPENSE"; amount: number; currency: string; comment?: string};
type OrgNotification = {type: string; title: string; body?: string; link: string; exceptUserId: string};
export type PaymentEffects = {dispatchEvent(id: string): Promise<unknown>; notifyOrg(input: OrgNotification): Promise<unknown>;
  revalidatePath(path: string): unknown};

/** Необязательная доставка получает только подтверждённый контекст, не Prisma-record. */
export async function deliverPaymentEffects(context: PaymentEffectContext | undefined, dependencies: PaymentEffects): Promise<void> {
  if (!context) return;
  const {project, direction, amount, currency, actorId, eventId, paymentId} = context;
  const income = direction === "INCOME", kind = income ? "Приход" : "Расход";
  const effects: Parameters<typeof deliverPostCommit>[2] = [];
  if (eventId) effects.push({kind: "dispatch", run: () => dependencies.dispatchEvent(eventId)});
  effects.push({kind: "org", run: () => dependencies.notifyOrg({type: income ? "payment.added" : "expense.added",
    title: `${kind} ${formatAmount(amount, currency)} · ${project?.number ?? "Организация"}`, body: context.comment?.trim() || undefined,
    link: project ? `/finance/projects/${project.id}` : income ? "/finance/income" : "/finance/expenses", exceptUserId: actorId})});
  if (project) effects.push({kind: "cache", run: () => dependencies.revalidatePath(`/projects/${project.id}`)},
    {kind: "cache", run: () => dependencies.revalidatePath(`/finance/projects/${project.id}`)});
  for (const path of ["/finance/income", "/finance/expenses", "/finance/payroll", "/finance/accounts"])
    effects.push({kind: "cache", run: () => dependencies.revalidatePath(path)});
  await deliverPostCommit("payment-create", paymentId, effects);
}
