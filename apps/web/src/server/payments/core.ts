
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { confirmMutation } from "@/server/operations/confirmation";
import { deliverPostCommit } from "@/server/operations/post-commit";


import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";


import { requireActorRoles, type DomainActor } from "@/server/actor";
import { FINANCE_ROLES } from "@/lib/roles";
import { withTaskTransaction } from "@/server/tasks/transaction";


import { paymentSchema, type PaymentInput, type PaymentMutationResult } from "./contracts";
import { readPaymentReceipt, PaymentReceiptError } from "./receipts";
import { createPaymentInTransaction, type PreparedPayment } from "./transaction";
import { preparePayment } from "./prepare";
import { assertExpenseReportDocument } from "./document-policy";
export { createPaymentInTransaction, type PreparedPayment } from "./transaction";

export { paymentSchema } from "./contracts";

// Ядро создания платежа (§11): приход от клиента или расход на проект.
// Используется и вебом (finance-tab), и telegram-ботом — актёр передаётся
// явно (source попадает в журнал изменений). Проверки ролей (FINANCE_ROLES),
// кассы/статьи/курса НБ РБ — здесь, единообразно для обоих каналов.

export async function createPaymentCore(
  actor: DomainActor,
  input: PaymentInput,
): Promise<PaymentMutationResult> {
  requireActorRoles(actor, FINANCE_ROLES);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  try {
    const existing = await readPaymentReceipt(actor, data, prisma);
    if (existing) return { ok: true, outcome: "COMMITTED", resultId: existing.id, paymentId: existing.id };
  } catch (error) {
    if (error instanceof PaymentReceiptError) return { ok: false, error: error.message };
    return { ok: false, outcome: "UNKNOWN", retrySafe: Boolean(data.clientMutationId), error: "Не удалось проверить подтверждение платежа. Повторите тот же запрос с сохранённым идентификатором." };
  }
  try { assertExpenseReportDocument(data); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Проверьте отчётный документ" }; }
  let result;
  let prepared: PreparedPayment;
  try {
    prepared = await preparePayment(data, prisma);
    const outcome = await confirmMutation(withTaskTransaction, tx => createPaymentInTransaction(actor, data, prepared, tx), async (tx, candidate) => {
      let receipt;
      try { receipt = await readPaymentReceipt(actor, data, tx); }
      catch (error) {
        if (candidate === undefined && error instanceof PaymentReceiptError) return null;
        throw error;
      }
      if (receipt) return candidate === undefined ? { payment: receipt, eventId: null, repeated: true }
        : receipt.id === candidate.payment.id ? candidate : null;
      if (candidate === undefined) return null; // Fresh locked read завершил abort новой попытки до COMMIT.
      if (!candidate.eventId) return null;
      const [payment, event] = await Promise.all([
        tx.payment.findUnique({ where: { id: candidate.payment.id } }),
        tx.domainEvent.findUnique({ where: { id: candidate.eventId } }),
      ]);
      if (!payment || payment.deletionId || payment.createdById !== actor.id ||
        !event || event.actor !== actor.id || event.type !== (data.direction === "INCOME" ? "payment.created" : "expense.created")) return null;
      const fields = ["direction", "projectId", "cashAccountId", "expenseArticleId", "currency", "reportDocumentId"] as const;
      if (fields.some(field => (payment[field] ?? null) !== (candidate.payment[field] ?? null))) return null;
      const money = ["amount", "rate", "bynAmount", "projectAmount"] as const;
      if (money.some(field => payment[field] === null || candidate.payment[field] === null
        ? payment[field] !== candidate.payment[field] : !new Prisma.Decimal(payment[field]!).eq(candidate.payment[field]!))) return null;
      if (payment.paidAt.getTime() !== candidate.payment.paidAt.getTime() ||
        (payment.rateDate?.getTime() ?? null) !== (candidate.payment.rateDate?.getTime() ?? null)) return null;
      const payload = { paymentId: candidate.payment.id, projectId: prepared.project?.id ?? null,
        direction: data.direction, amount: prepared.amount, currency: data.currency, bynAmount: prepared.bynAmount };
      return isDeepStrictEqual(event.payload, payload) ? candidate : null;
    });
    if (outcome.outcome === "UNKNOWN") return { ok: false, outcome: "UNKNOWN", retrySafe: Boolean(data.clientMutationId),
      error: data.clientMutationId ? "Подтверждение не получено. Повторите тот же платёж с сохранённым идентификатором." : "Подтверждение не получено. Проверьте историю платежей; не повторяйте операцию автоматически." };
    if (outcome.outcome === "ROLLED_BACK") return { ok: false, outcome: "ROLLED_BACK", error: outcome.error instanceof Error ? outcome.error.message : "Не удалось внести платёж" };
    result = outcome.value;
  } catch(error) { return {ok:false,error:error instanceof Error?error.message:"Не удалось внести платёж"}; }
  const { project, amount } = prepared;
  const ack: PaymentMutationResult = { ok: true, outcome: "COMMITTED", resultId: result.payment.id, paymentId: result.payment.id };
  if (result.repeated) return ack;
  const isIncome = data.direction === "INCOME";
  const kind = isIncome ? "Приход" : "Расход";
  const effects: Parameters<typeof deliverPostCommit>[2] = [];
  if (result.eventId) effects.push({ kind: "dispatch", run: () => dispatchEvent(result.eventId!) });
  effects.push({ kind: "org", run: () => notifyOrg({
    type: isIncome ? "payment.added" : "expense.added",
    title: `${kind} ${formatAmount(amount, data.currency)} · ${project?.number ?? "Организация"}`,
    body: data.comment?.trim() || undefined,
    link: project ? `/finance/projects/${project.id}` : isIncome ? "/finance/income" : "/finance/expenses",
    exceptUserId: actor.id,
  }) });
  if (project) effects.push({ kind: "cache", run: () => revalidatePath(`/projects/${project.id}`) },
    { kind: "cache", run: () => revalidatePath(`/finance/projects/${project.id}`) });
  for (const path of ["/finance/income", "/finance/expenses", "/finance/payroll", "/finance/accounts"])
    effects.push({ kind: "cache", run: () => revalidatePath(path) });
  await deliverPostCommit("payment-create", result.payment.id, effects);
  return ack;
}
