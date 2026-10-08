import { object, string, uuid, coerce, enum as enumSchema, type output } from "zod";
import type { ViewableFile } from "@/lib/viewable-file";

export const financeDocumentUploadSchema = object({
  clientMutationId: uuid().transform(value => value.toLowerCase()),
  fileName: string().trim().min(1, "Укажите имя файла").max(255)
    .refine(value => !/[\x00-\x1f\x7f/\\]/.test(value), "Некорректное имя файла"),
  mimeType: string().max(127).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/, "Некорректный тип файла")
    .transform(value => value.toLowerCase()),
}).strict();

export type FinanceDocumentView = ViewableFile & {
  source: "finance";
  size: number;
  createdAt: string;
  paymentId: string | null;
};

export const financeDocumentListSchema = object({
  page: coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: coerce.number().int().refine(value => [10, 20, 50, 100].includes(value)).default(20),
  query: string().trim().max(200).default(""),
  sort: enumSchema(["createdAt", "fileName"]).default("createdAt"),
  direction: enumSchema(["asc", "desc"]).default("desc"),
});
export type FinanceDocumentListInput = output<typeof financeDocumentListSchema>;
