import { z } from "zod";
import type { ViewableFile } from "@/lib/viewable-file";

export const financeDocumentUploadSchema = z.object({
  clientMutationId: z.uuid().transform(value => value.toLowerCase()),
  fileName: z.string().trim().min(1, "Укажите имя файла").max(255)
    .refine(value => !/[\x00-\x1f\x7f/\\]/.test(value), "Некорректное имя файла"),
  mimeType: z.string().max(127).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/, "Некорректный тип файла")
    .transform(value => value.toLowerCase()),
}).strict();

export type FinanceDocumentView = ViewableFile & {
  source: "finance";
  size: number;
  createdAt: string;
  paymentId: string | null;
};

export const financeDocumentListSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().refine(value => [10, 20, 50, 100].includes(value)).default(20),
  query: z.string().trim().max(200).default(""),
  sort: z.enum(["createdAt", "fileName"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type FinanceDocumentListInput = z.infer<typeof financeDocumentListSchema>;
