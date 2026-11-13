import { z } from "zod";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { TechnicalSpecifications } from "@pero/kp-template";

const base = { productId: z.string().min(1), clientMutationId: z.uuid() };
const text = z.string().nullable();
const required = z.string().refine((value) => value.trim().length > 0, "Заполните обязательное поле");
const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Введите неотрицательную сумму с точностью до копеек").nullable();
const variant = <F extends string, T extends z.ZodType>(field: F, value: T) =>
  z.object({ ...base, field: z.literal(field), value, expectedValue: value }).strict();

export const technicalSpecificationsSchema = z.custom<TechnicalSpecifications>(
  input => FurnitureSpecifications.normalizeProduct(input) !== null &&
    (input as TechnicalSpecifications).description === null && (input as TechnicalSpecifications).size === null &&
    (input as TechnicalSpecifications).note === null, "Некорректные технические характеристики",
);
export type ProductSpecificationRowValue = { label: string; value: string };
const rowValue = z.object({ label: z.string(), value: z.string() }).strict().nullable();
const expectedSourceGeneration = z.number().int().nonnegative();

export const productPatchSchema = z.discriminatedUnion("field", [
  variant("title", required), variant("kind", text), variant("description", text),
  z.object({ ...base, field: z.literal("technicalSpecificationRow"), sectionId: required,
    expectedSourceGeneration, expectedRow: rowValue, row: rowValue }).strict()
    .refine(patch => patch.expectedRow !== null || patch.row === null || patch.sectionId === patch.clientMutationId,
      "Создайте строку с новым идентификатором"),
  variant("technicalSpecificationEntry", z.string()).extend({
    type: z.enum(["body", "facade", "worktop", "upholstery", "insertsAndHandles", "hardware", "lighting", "interiorFilling", "softFilling"]),
    expectedSectionId: z.string().min(1).nullable(), expectedSourceGeneration,
  }).refine(() => false, "Формат технического описания изменён. Обновите карточку изделия"),
  variant("engineerId", text), variant("expectedPrice", money),
  variant("quantity", z.number().int().min(1).max(2_147_483_647)),
  variant("project.clientId", required),
  // Формат прежних callers распознаётся, но не даёт право менять Client/Project из изделия.
  variant("project.address", text).superRefine((_value,ctx)=>ctx.addIssue({code:"custom",message:"Адрес и телефон изменяются в карточке клиента"})),
  z.object({ ...base, field: z.literal("client.phone"), value: required, expectedValue: z.string(), expectedClientId: z.string().min(1) }).strict().superRefine((_value,ctx)=>ctx.addIssue({code:"custom",message:"Адрес и телефон изменяются в карточке клиента"})),
]);
export type ProductPatch = z.infer<typeof productPatchSchema>;
export type ProductPatchField = ProductPatch["field"];
export type ProductScalarValue = string | number | null;
export type ProductPatchValue = ProductScalarValue | ProductSpecificationRowValue;
export type ProductPatchDerived = {
  technicalSpecificationSectionId?: string | null;
  technicalSpecificationsEditRevision?: number;
  lineTotalBYN?: string | null; quantity?: number; currentUnitPrice?: string | null;
  engineerLabel?: string | null; clientLabel?: string | null; clientId?: string; phone?: string;clientAddress?:string|null;
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
