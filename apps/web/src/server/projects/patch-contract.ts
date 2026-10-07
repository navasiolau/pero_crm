import { z } from "zod";

const base = { projectId: z.string().min(1), clientMutationId: z.uuid() };
const required = z.string().refine(value => value.trim().length > 0, "Заполните обязательное поле");
const nullableText = z.string().nullable();
export const projectMoneySchema = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Введите неотрицательную сумму с точностью до копеек").nullable();
const field = <F extends string, T extends z.ZodType>(name: F, value: T) =>
  z.object({ ...base, field: z.literal(name), value, expectedValue: value }).strict();
export const projectPatchSchema = z.discriminatedUnion("field", [
  z.object({ ...base, field:z.literal("title"), value:required, expectedValue:z.string() }).strict(),
  z.object({ ...base, field:z.literal("clientId"), value:required, expectedValue:z.string() }).strict(),
  field("managerId", nullableText), field("address", nullableText),
  field("delivery", projectMoneySchema), field("unloading", projectMoneySchema), field("installation", projectMoneySchema),
  z.object({ ...base, field: z.literal("client.phone"), value: required, expectedValue: z.string(), expectedClientId: z.string().min(1) }).strict(),
  z.object({ ...base, field: z.literal("client.address"), value: nullableText, expectedValue: nullableText, expectedClientId: z.string().min(1) }).strict(),
]);
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type ProjectPatchField = ProjectPatch["field"];
export type ProjectPatchValue = string | null;
const projectedMoney=z.string().regex(/^\d+\.\d{2}$/).nullable();
export const projectPricingProjectionSchema=z.object({expectedTotalBYN:projectedMoney,productsSubtotalBYN:projectedMoney,pricingVersion:z.string().regex(/^\d+$/),delivery:projectMoneySchema,unloading:projectMoneySchema,installation:projectMoneySchema}).strict();
export type ProjectPatchDerived = { expectedTotalBYN?: string | null; productsSubtotalBYN?:string|null; pricingVersion?:string; delivery?: string | null; unloading?: string | null; installation?: string | null; clientId?: string; clientLabel?: string | null; phone?: string; clientAddress?: string | null; managerLabel?: string | null };
export type MalformedProjectPatchValidation = {kind:"validation";malformed:true;error:string;field?:ProjectPatchField;clientMutationId?:string};
export type ProjectPatchResult = MalformedProjectPatchValidation | {
  kind:"saved";field:ProjectPatchField;value:ProjectPatchValue;clientMutationId:string;derived?:ProjectPatchDerived;repeated?:boolean;noOp?:boolean;
} | {
  kind:"validation"|"conflict"|"forbidden"|"not-found"|"failure";field:ProjectPatchField;clientMutationId:string;error:string;currentValue?:ProjectPatchValue;currentClientId?:string;currentClientLabel?:string;
};
export function malformedProjectPatch(input:unknown,error="Некорректный запрос поля"):MalformedProjectPatchValidation {
  const result:MalformedProjectPatchValidation={kind:"validation",malformed:true,error};
  if(input===null||typeof input!=="object"||Array.isArray(input))return result;
  if("field" in input&&projectPatchSchema.options.some(option=>option.shape.field.value===input.field))result.field=input.field as ProjectPatchField;
  if("clientMutationId" in input&&z.uuid().safeParse(input.clientMutationId).success)result.clientMutationId=input.clientMutationId as string;
  return result;
}
export type ProjectFullBaseline = {title:string;clientId:string;managerId:string|null;address:string|null;delivery:string|null;unloading:string|null;installation:string|null;currency:string};
