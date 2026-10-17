import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const counterpartyTypes = ["SUPPLIER", "CARRIER"] as const;
export const counterpartyTypeLabels = { SUPPLIER: "Поставщик", CARRIER: "Перевозчик" } as const;
export const counterpartySchema = z.object({
  type: z.enum(counterpartyTypes, { error: "Выберите тип контрагента" }),
  company: z.string().trim().min(1, "Укажите компанию"),
  phone: z.string().optional(),
  comment: z.string().optional(),
}).strict();
export const counterpartyUpdateSchema = z.object({
  id: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative().max(2147483646),
  input: counterpartySchema,
}).strict();
export const counterpartySelect = {
  id: true, type: true, company: true, phone: true, comment: true, revision: true,
} satisfies Prisma.CounterpartySelect;
export type CounterpartyInput = z.input<typeof counterpartySchema>;
export type CounterpartyView = Prisma.CounterpartyGetPayload<{ select: typeof counterpartySelect }>;
export type CounterpartyResult = { ok: true; item: CounterpartyView; noOp?: boolean } |
  { ok: false; kind: "forbidden" | "validation" | "not-found" | "conflict" | "failure"; error: string };
