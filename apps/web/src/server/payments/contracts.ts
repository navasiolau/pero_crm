import { object, string, number, uuid, enum as enumSchema, type input, type output } from "zod";

/** Общий контракт web/Telegram; деньги и доступ проверяет доменное ядро. */
const paymentFields = {
  projectId: string().min(1).nullable().optional(),
  direction: enumSchema(["INCOME", "EXPENSE"]),
  amount: number().positive("Сумма должна быть больше нуля"),
  currency: string(),
  cashAccountId: string().min(1, "Выберите кассу"),
  expenseArticleId: string().optional(),
  rate: number().positive().optional(),
  rateDate: string().optional(),
  paidAt: string().optional(),
  comment: string().optional(),
  reportDocumentId: uuid({ error: "Некорректный идентификатор документа" }).optional(),
};
const validDirection = (data: {direction: string; expenseArticleId?: string}) => data.direction !== "INCOME" || !data.expenseArticleId;
const directionError = {message: "У прихода не может быть статьи расхода", path: ["expenseArticleId"]};
// Только server-only nested context использует fields без ordinary UUID.
export const paymentDetailsSchema = object({...paymentFields,
  clientMutationId: uuid({error: "Некорректный идентификатор операции"}).transform(value => value.toLowerCase()).optional(),
}).strict().refine(validDirection, directionError);
export const paymentSchema = object({...paymentFields,
  clientMutationId: uuid({error: "Укажите идентификатор операции — обновите клиент CRM"}).transform(value => value.toLowerCase()),
}).refine(validDirection, directionError);
export type PaymentDetails = output<typeof paymentDetailsSchema>;
export type InternalPaymentInput = input<typeof paymentDetailsSchema>;

export type PaymentInput = input<typeof paymentSchema>;
export type PaymentData = output<typeof paymentSchema>;

export type PaymentMutationResult = { ok: true; outcome: "COMMITTED"; resultId: string; paymentId: string; clientMutationId: string; replayed?: boolean } | {
  ok: false; error: string; outcome?: "ROLLED_BACK" | "UNKNOWN"; retrySafe?: boolean; clientMutationId?: string;
  kind?: "invalid-request" | "actor-changed" | "forbidden" | "conflict" | "removed";
  removedPaymentId?: string;
};
