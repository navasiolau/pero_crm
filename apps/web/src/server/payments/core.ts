
import { uuid } from "zod";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { confirmMutation } from "@/server/operations/confirmation";

import { requireActorRoles, type DomainActor } from "@/server/actor";
import { FINANCE_ROLES } from "@/lib/roles";

import { paymentSchema, type PaymentInput, type PaymentData, type PaymentMutationResult } from "./contracts";
import { readPaymentReceipt, PaymentReceiptError } from "./receipts";
import { createPaymentInTransaction, type PreparedPayment } from "./transaction";
import { assertExpenseReportDocument } from "./document-policy";
import { inputReportDocumentIds, reportDocumentSetMatches } from "@/server/finance-documents/input";
export { createPaymentInTransaction, type PreparedPayment } from "./transaction";

export { paymentSchema } from "./contracts";

import type { MutationTransaction } from "@/server/transactions/coordinator";
import type { PaymentEffectContext } from "./post-commit";
export type PaymentScenarioResult = {ack: PaymentMutationResult; effects?: PaymentEffectContext};
export type PaymentScenarioDependencies = {reader: Pick<Prisma.TransactionClient, "changeLog" | "payment">;
  transaction: MutationTransaction; prepare(data: PaymentData): Promise<PreparedPayment>};

// Ядро создания платежа (§11): приход от клиента или расход на проект.
// Используется и вебом (finance-tab), и telegram-ботом — актёр передаётся
// явно (source попадает в журнал изменений). Проверки ролей (FINANCE_ROLES),
// кассы/статьи/курса НБ РБ — здесь, единообразно для обоих каналов.

export async function createPaymentScenario(
  actor: DomainActor,
  input: PaymentInput, dependencies: PaymentScenarioDependencies,
): Promise<PaymentScenarioResult> {
  requireActorRoles(actor, FINANCE_ROLES);
  const recognizedId = uuid().safeParse(input?.clientMutationId);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return {ack: { ok: false, outcome: "ROLLED_BACK", kind: "invalid-request", clientMutationId: recognizedId.success ? recognizedId.data.toLowerCase() : undefined, error: parsed.error.issues[0]?.message ?? "Ошибка данных" }};
  }
  const data = parsed.data;
  try {
    const existing = await readPaymentReceipt(actor, data, dependencies.reader);
    if (existing) return {ack: { ok: true, outcome: "COMMITTED", resultId: existing.id, paymentId: existing.id, clientMutationId: data.clientMutationId, replayed: true }};
  } catch (error) {
    if (error instanceof PaymentReceiptError) return {ack: { ok: false, outcome: "ROLLED_BACK", kind: error.kind, removedPaymentId: error.removedPaymentId, clientMutationId: data.clientMutationId, error: error.message }};
    return {ack: { ok: false, outcome: "UNKNOWN", retrySafe: true, clientMutationId: data.clientMutationId, error: "Не удалось проверить подтверждение платежа. Повторите тот же запрос с сохранённым идентификатором." }};
  }
  try { assertExpenseReportDocument(data); }
  catch (error) { return {ack: { ok: false, outcome: "ROLLED_BACK", clientMutationId: data.clientMutationId, error: error instanceof Error ? error.message : "Проверьте отчётный документ" }}; }
  let result;
  let prepared: PreparedPayment;
  try {
    prepared = await dependencies.prepare(data);
    const outcome = await confirmMutation(dependencies.transaction, tx => createPaymentInTransaction(actor, data, prepared, tx), async (tx, candidate) => {
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
        tx.payment.findUnique({ where: { id: candidate.payment.id }, include: {
          reportDocuments: { select: { documentId: true, position: true }, orderBy: { position: "asc" } },
        } }),
        tx.domainEvent.findUnique({ where: { id: candidate.eventId } }),
      ]);
      if (!payment || payment.deletionId || payment.createdById !== actor.id ||
        !event || event.actor !== actor.id || event.type !== (data.direction === "INCOME" ? "payment.created" : "expense.created")) return null;
      const fields = ["direction", "projectId", "cashAccountId", "expenseArticleId", "currency", "reportDocumentId"] as const;
      if (fields.some(field => (payment[field] ?? null) !== (candidate.payment[field] ?? null))) return null;
      if (!reportDocumentSetMatches(payment, inputReportDocumentIds(data))) return null;
      const money = ["amount", "rate", "bynAmount", "projectAmount"] as const;
      if (money.some(field => payment[field] === null || candidate.payment[field] === null
        ? payment[field] !== candidate.payment[field] : !new Prisma.Decimal(payment[field]!).eq(candidate.payment[field]!))) return null;
      if (payment.paidAt.getTime() !== candidate.payment.paidAt.getTime() ||
        (payment.rateDate?.getTime() ?? null) !== (candidate.payment.rateDate?.getTime() ?? null)) return null;
      const payload = { paymentId: candidate.payment.id, projectId: prepared.project?.id ?? null,
        direction: data.direction, amount: prepared.amount, currency: data.currency, bynAmount: prepared.bynAmount };
      return isDeepStrictEqual(event.payload, payload) ? candidate : null;
    });
    if (outcome.outcome === "UNKNOWN") return {ack: { ok: false, outcome: "UNKNOWN", retrySafe: true, clientMutationId: data.clientMutationId,
      error: data.clientMutationId ? "Подтверждение не получено. Повторите тот же платёж с сохранённым идентификатором." : "Подтверждение не получено. Проверьте историю платежей; не повторяйте операцию автоматически." }};
    if (outcome.outcome === "ROLLED_BACK") return {ack: { ok: false, outcome: "ROLLED_BACK", clientMutationId: data.clientMutationId, error: outcome.error instanceof Error ? outcome.error.message : "Не удалось внести платёж" }};
    result = outcome.value;
  } catch(error) { return {ack: {ok:false,outcome:"ROLLED_BACK",clientMutationId:data.clientMutationId,error:error instanceof Error?error.message:"Не удалось внести платёж"}}; }
  const ack: PaymentMutationResult = {ok: true, outcome: "COMMITTED", resultId: result.payment.id, paymentId: result.payment.id,
    clientMutationId: data.clientMutationId, ...(result.repeated ? {replayed: true} : {})};
  if (result.repeated) return {ack};
  return {ack, effects: {paymentId: result.payment.id, eventId: result.eventId, actorId: actor.id,
    project: prepared.project ? {id: prepared.project.id, number: prepared.project.number} : null,
    direction: data.direction, amount: prepared.amount, currency: data.currency, comment: data.comment}};
}
