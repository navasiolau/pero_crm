
import { revalidatePath } from "next/cache";


import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";


import { requireActorRoles, type DomainActor } from "@/server/actor";
import { FINANCE_ROLES } from "@/lib/roles";
import { withTaskTransaction } from "@/server/tasks/transaction";


import { paymentSchema, type PaymentInput } from "./contracts";
import { readPaymentReceipt } from "./receipts";
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
): Promise<{ ok: boolean; error?: string }> {
  requireActorRoles(actor, FINANCE_ROLES);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  try {
    if (await readPaymentReceipt(actor, data, prisma)) return { ok: true };
    assertExpenseReportDocument(data);
  }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось проверить повтор платежа" }; }
  let result;
  let prepared: PreparedPayment;
  try {
    prepared = await preparePayment(data, prisma);
    result = await withTaskTransaction(tx => createPaymentInTransaction(actor, data, prepared, tx));
  } catch(error) { return {ok:false,error:error instanceof Error?error.message:"Не удалось внести платёж"}; }
  const { project, amount } = prepared;
  if (result.repeated) return { ok: true };
  const isIncome = data.direction === "INCOME";
  const kind = isIncome ? "Приход" : "Расход";
  await dispatchEvent(result.eventId).catch(() => {});
  await notifyOrg({
    type: isIncome ? "payment.added" : "expense.added",
    title: `${kind} ${formatAmount(amount, data.currency)} · ${project?.number ?? "Организация"}`,
    body: data.comment?.trim() || undefined,
    link: project ? `/finance/projects/${project.id}` : isIncome ? "/finance/income" : "/finance/expenses",
    exceptUserId: actor.id,
  }).catch(() => {});

  if (project) revalidatePath(`/projects/${project.id}`);
  if (project) revalidatePath(`/finance/projects/${project.id}`);
  if (data.reportDocumentId) revalidatePath("/finance/documents");
  revalidatePath("/finance/income");
  revalidatePath("/finance/expenses");
  revalidatePath("/finance/payroll");
  revalidatePath("/finance/accounts");
  return { ok: true };
}
