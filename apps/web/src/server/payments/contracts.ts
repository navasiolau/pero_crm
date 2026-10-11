import { object, string, number, uuid, enum as enumSchema, type input, type output } from "zod";

/** Общий контракт web/Telegram; деньги и доступ проверяет доменное ядро. */
export const paymentSchema = object({
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
  clientMutationId: uuid({ error: "Некорректный идентификатор операции" }).transform(value => value.toLowerCase()).optional(),
  reportDocumentId: uuid({ error: "Некорректный идентификатор документа" }).optional(),
}).refine(data => data.direction !== "INCOME" || !data.expenseArticleId, {
  message: "У прихода не может быть статьи расхода", path: ["expenseArticleId"],
});

export type PaymentInput = input<typeof paymentSchema>;
export type PaymentData = output<typeof paymentSchema>;

export type PaymentMutationResult = { ok: true; outcome: "COMMITTED"; resultId: string; paymentId: string } | {
  ok: false; error: string; outcome?: "ROLLED_BACK" | "UNKNOWN"; retrySafe?: boolean;
};
