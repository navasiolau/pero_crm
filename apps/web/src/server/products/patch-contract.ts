import { z } from "zod";

const base = { productId: z.string().min(1), clientMutationId: z.uuid() };
const text = z.string().nullable();
const required = z.string().refine((value) => value.trim().length > 0, "Заполните обязательное поле");
const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Введите неотрицательную сумму с точностью до копеек").nullable();
const variant = <F extends string, T extends z.ZodType>(field: F, value: T) =>
  z.object({ ...base, field: z.literal(field), value, expectedValue: value }).strict();

export const productPatchSchema = z.discriminatedUnion("field", [
  variant("title", required), variant("kind", text), variant("description", text),
  variant("engineerId", text), variant("expectedPrice", money),
  variant("quantity", z.number().int().min(1).max(2_147_483_647)),
  variant("project.clientId", required), variant("project.address", text),
  z.object({ ...base, field: z.literal("client.phone"), value: required, expectedValue: z.string(), expectedClientId: z.string().min(1) }).strict(),
]);
export type ProductPatch = z.infer<typeof productPatchSchema>;
export type ProductPatchField = ProductPatch["field"];
export type ProductPatchValue = string | number | null;
export type ProductPatchDerived = {
  lineTotalBYN?: string | null; quantity?: number; currentUnitPrice?: string | null;
  engineerLabel?: string | null; clientLabel?: string | null; clientId?: string; phone?: string;
};
export type MalformedProductPatchValidation = {
  kind: "validation"; malformed: true; error: string;
  field?: ProductPatchField; clientMutationId?: string;
};
export type ProductPatchResult = MalformedProductPatchValidation | {
  kind: "saved"; field: ProductPatchField; value: ProductPatchValue; clientMutationId: string;
  derived?: ProductPatchDerived; repeated?: boolean; noOp?: boolean;
} | {
  kind: "validation" | "conflict" | "forbidden" | "not-found" | "failure";
  field: ProductPatchField; clientMutationId: string; error: string;
  currentValue?: ProductPatchValue; currentClientId?: string; currentClientLabel?: string;
};


/** Возвращаем только реально распознанные метаданные; baseline и ID не придумываются. */
export function malformedProductPatch(input: unknown, error = "Некорректный запрос поля"): MalformedProductPatchValidation {
  const result: MalformedProductPatchValidation = { kind: "validation", malformed: true, error };
  if (input === null || typeof input !== "object" || Array.isArray(input)) return result;
  if ("field" in input && productPatchSchema.options.some(option => option.shape.field.value === input.field)) result.field = input.field as ProductPatchField;
  if ("clientMutationId" in input && z.uuid().safeParse(input.clientMutationId).success) result.clientMutationId = input.clientMutationId as string;
  return result;
}
