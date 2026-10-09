import { z } from "zod";

export const materialUnitSchema = z.object({ name: z.string().trim().min(1, "Укажите обозначение единицы") }).strict();
export type MaterialUnitInput = z.input<typeof materialUnitSchema>;
export type MaterialUnitOption = { id: string; name: string };
export type MaterialUnitView = MaterialUnitOption & { materialCount: number };
