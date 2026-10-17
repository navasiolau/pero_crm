import { z } from "zod";
import type { StockMaterialOption } from "./contracts";
import type { MaterialUnitOption } from "./unit-contracts";

export const materialSchema = z.object({
  name: z.string().trim().min(1, "Укажите название"),
  sku: z.string().optional(),
  unitId: z.string().min(1, "Выберите единицу измерения"),
  categoryId: z.string().optional(),
  minStock: z.number().nonnegative("Мин. остаток не может быть отрицательным").optional(),
  comment: z.string().optional(),
}).strict();
export type MaterialInput = z.input<typeof materialSchema>;
export type MaterialCreateResult = { ok: true; material: StockMaterialOption } | { ok: false; error: string };
export type MaterialCreateOptions = { units: MaterialUnitOption[]; categories: { id: string; name: string; active?: boolean }[] };
export type MaterialEditSnapshot = {
  id: string; name: string; sku: string | null; unitId: string; categoryId: string | null;
  purchasePrice: number | null; minStock: number | null; comment: string | null;
};
