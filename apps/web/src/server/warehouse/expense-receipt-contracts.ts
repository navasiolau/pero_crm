import { array, object, string, uuid, type input } from "zod";

const line = object({
  materialId: string().min(1),
  quantity: string().min(1).max(20),
  amount: string().min(1).max(20),
}).strict();

export const expenseReceiptPreviewSchema = object({
  paymentId: string().min(1),
  lines: array(line).min(1).max(50),
}).strict();

export const expenseReceiptSchema = expenseReceiptPreviewSchema.extend({
  clientMutationId: uuid().transform(value => value.toLowerCase()),
  fingerprint: string().regex(/^[\da-f]{64}$/),
}).strict();

export type ExpenseReceiptInput = input<typeof expenseReceiptPreviewSchema>;
export type ConfirmExpenseReceiptInput = input<typeof expenseReceiptSchema>;
