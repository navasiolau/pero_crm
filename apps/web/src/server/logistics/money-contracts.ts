import { z } from "zod";
import { logisticsTripCreateSchema } from "./contracts";

export const LOGISTICS_ARTICLE_SETTING = "logisticsExpenseArticleId";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Укажите существующую дату курса");
const amount = z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Сумма: не более двух знаков после запятой")
  .refine(value => Number(value) > 0, "Стоимость рейса должна быть больше нуля");

export const logisticsPostingSchema = z.object({
  tripId: z.uuid(), expectedRevision: z.number().int().min(1).max(2_147_483_646),
  clientMutationId: z.uuid().transform(value => value.toLowerCase()),
  amount, currency: z.enum(["BYN", "USD", "EUR", "RUB"]),
  cashAccountId: z.string().trim().min(1).max(128),
  documentIds: z.array(z.uuid()).min(1, "Прикрепите ТТН с одной печатью").refine(ids => new Set(ids).size === ids.length, "ТТН не должна повторяться"),
  rate: z.number().finite().positive().optional(), rateDate: date.optional(),
  // Тот же валидатор состава, без второго идентификатора изменения в публичном контракте.
  manifest: z.preprocess(value => value && typeof value === "object" ? { ...value, clientMutationId: "00000000-0000-4000-8000-000000000000" } : value,
    logisticsTripCreateSchema).transform(manifest => ({ date: manifest.date, comment: manifest.comment, shares: manifest.shares, lines: manifest.lines })).optional(),
}).strict();
export type LogisticsPostingInput = z.input<typeof logisticsPostingSchema>;
export type LogisticsPostingData = z.output<typeof logisticsPostingSchema>;
export type LogisticsPostingResult = { tripId: string; revision: number; postingId: string; repeated: boolean };
export type LogisticsAllocationView = {
  id: string; projectId: string; projectNumber: string; percentBps: number; amount: string; bynAmount: string; paymentId: string | null;
};
export type LogisticsPostingView = {
  id: string; tripId: string; tripRevision: number; status: "ACTIVE" | "SUPERSEDED";
  amount: string; currency: string; cashAccountId: string; cashAccountName: string; expenseArticleId: string;
  rate: string; rateDate: string | null; bynAmount: string; paidAt: string; createdAt: string; createdByName: string;
  allocations: LogisticsAllocationView[]; documentIds: string[];
};
export type LogisticsMoneyOptions = {
  cashAccounts: { id: string; name: string; currency: string; balance: number }[];
  logisticsArticle: { id: string; name: string; active: boolean } | null;
  articleOptions: { id: string; name: string; active: boolean }[];
  canConfigureArticle: boolean;
};
export type LogisticsProjectBudget = {
  currency: "BYN"; deliveryBudget: number | null; tripSpent: number | null; otherSpent: number | null;
  spent: number | null; remaining: number | null; unavailableReason: string | null; articleConfigured: boolean;
};
