import { patchProductContactInTransaction } from "../projects/contact-core";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { normalizeProductDescription, isProductDescriptionUnchanged } from "@/lib/product-description";
import { productLineTotal } from "@/lib/product-quantity";
import { productEditWhere, resolveVisibilityActor } from "@/server/access/visibility";
import { withTaskTransaction, type TaskTransaction } from "@/server/tasks/transaction";
import { lockProductRow, recalculateQuantity } from "./quantity-core";
import { initialPriceCapture, newProductInitialPrice } from "./initial-price";
import { readProductPercentageDefaults } from "@/server/product-percentage-defaults/core";
import { DEFAULT_PERCENTAGE_KINDS } from "@/server/product-percentage-defaults/contracts";
import type { DomainActor } from "../projects/core";
import { malformedProductPatch, productPatchSchema, type ProductPatch, type ProductPatchResult, type ProductPatchValue, type ProductPatchDerived } from "./patch-contract";
export const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1, "Укажите название изделия"),
  quantity: z.number().int("Количество должно быть целым").min(1, "Количество должно быть не меньше 1").max(2_147_483_647, "Слишком большое количество изделий").default(1),
  kind: z.string().optional(),
  expectedPrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  description: z.string().optional(),
  // Инженер изделия — ответственен за конкретное изделие (§10)
  engineerId: z.string().optional(),
}).strict();

async function nextProductSuffixInt(
  projectId: string,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const siblings = await tx.product.findMany({
    where: { projectId },
    select: { suffixInt: true },
  });
  let max = 0;
  for (const sibling of siblings) {
    const suffix = sibling.suffixInt;
    if (suffix !== null && suffix > max) max = suffix;
  }
  return max + 1;
}

export const updateSchema = z.object({
  title: z.string().min(1, "Укажите название изделия").optional(),
  quantity: z.number().int("Количество должно быть целым").min(1, "Количество должно быть не меньше 1").max(2_147_483_647, "Слишком большое количество изделий").optional(),
  kind: z.string().nullable().optional(),
  expectedPrice: z.number().nonnegative("Цена не может быть отрицательной").nullable().optional(),
  description: z.string().nullable().optional(),
  engineerId: z.string().nullable().optional(),
}).strict();

export type CreateProductInput = z.input<typeof createSchema>;
export type UpdateProductInput = z.infer<typeof updateSchema>;
type ProductValues = Omit<UpdateProductInput, "expectedPrice"> & {expectedPrice?: string | number | null};
export type ProductUpdateBaseline = Partial<Record<keyof UpdateProductInput, ProductPatchValue>>;
const canonical = (field: string, value: unknown): ProductPatchValue => {
  if (value === null || value === undefined) return null;
  if (field === "expectedPrice") return new Prisma.Decimal(String(value)).toFixed(2);
  if (field === "quantity") return Number(value);
  return String(value);
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export async function createProductCore(actor: DomainActor, input: CreateProductInput, transaction: TaskTransaction = withTaskTransaction) {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data = parsed.data;
  try { productLineTotal(data.expectedPrice ?? null, data.quantity); }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Некорректная сумма партии" }; }  const mutation = await transaction(async (tx) => {
  const project = await tx.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, number: true, currency: true },
  });
  if (!project) return { ok: false as const, error: "Проект не найден" };
  if (data.expectedPrice !== undefined) {
    try { assertProjectMoneyCurrency(project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
  }
  if (data.engineerId && !await tx.user.findFirst({ where: { id: data.engineerId, active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true } }))
    return { ok: false as const, error: "Выберите активного сотрудника с ролью инженера" };

  const suffixInt = await nextProductSuffixInt(project.id, tx);
  const number = `${project.number}.${suffixInt}`;
  const defaults = await readProductPercentageDefaults(tx);
  if (Object.values(defaults.rates).some(rate => rate !== null)) {
    try { assertProjectMoneyCurrency(project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
  }
  const product = await tx.product.create({
    data: {
      projectId: project.id,
      number,
      suffixInt,
      title: data.title,
      quantity: data.quantity,
      kind: data.kind?.trim() || null,
      expectedPrice: data.expectedPrice,
      ...newProductInitialPrice(data.expectedPrice),
      description: normalizeProductDescription(data.description),
      engineerId: data.engineerId || null,
      percentageConfigs: { create: DEFAULT_PERCENTAGE_KINDS.map(kind => ({ kind, ratePercent: defaults.rates[kind], revision: 1 })) },
      createdById: actor.id,
      statusHistory: {
        create: { toStatus: "DESIGN", changedById: actor.id },
      },
    },
  });

  await tx.changeLog.create({ data: {
    actorType: "user",
    actorId: actor.id,
    actorName: actor.name ?? undefined,
    entity: "product",
    entityId: product.id,
    action: "create",
    newValue: { number, title: data.title, quantity: data.quantity, project: project.number,
      percentageDefaultsRevision: defaults.revision, percentageRates: defaults.rates,
      initialPrice: product.initialPrice?.toString() ?? null, initialPriceCaptureEligible: data.expectedPrice === undefined },
  } });
  return { ok: true as const, product };
  });
  return mutation;
}

async function updateProductValues(actor: DomainActor, productId: string, data: ProductValues, baseline: ProductUpdateBaseline, tx: Prisma.TransactionClient) {    await lockProductRow(tx, productId);
    const visibilityActor = hasAnyRole(actor.roles, MANAGER_ROLES) ? actor : await resolveVisibilityActor(tx, actor);
    const before = await tx.product.findFirst({ where: { AND: [{ id: productId }, productEditWhere(visibilityActor)] } });
    if (!before) return { ok: false as const, error: "Изделие не найдено" };
    if (data.expectedPrice !== undefined || data.quantity !== undefined) {
      const project = await tx.project.findUnique({ where: { id: before.projectId }, select: { currency: true } });
      if (!project) return { ok: false as const, error: "Проект не найден" };
      assertProjectMoneyCurrency(project.currency);
    }
    for (const key of Object.keys(data) as (keyof UpdateProductInput)[]) {
      if (!(key in baseline)) return { ok: false as const, error: "Обновите форму: отсутствует исходное значение поля" };
      if (canonical(key, before[key]) !== canonical(key, baseline[key])) return { ok: false as const, error: "Поле изменено другим пользователем" };
    }
    // Неизменённый legacy raw текст не очищаем даже при правке соседнего поля.
    if (data.description !== undefined && !isProductDescriptionUnchanged(data.description, before.description))
      data.description = normalizeProductDescription(data.description);
    const changed = Object.keys(data).some((key) => canonical(key, before[key as keyof typeof before]) !== canonical(key, data[key as keyof UpdateProductInput]));
    if (!changed) return { ok: true as const, before, noOp: true };
    const oldCount = before.quantity ?? 1;
    const count = data.quantity ?? oldCount;
    productLineTotal(data.expectedPrice === undefined ? before.expectedPrice ?? null : data.expectedPrice, count);
    if (data.engineerId && data.engineerId !== before.engineerId && !await tx.user.findFirst({ where: { id: data.engineerId, active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true } }))
      return { ok: false as const, error: "Выберите активного сотрудника с ролью инженера" };
    if (count !== oldCount) await recalculateQuantity(tx, { ...before, quantity: oldCount }, count);
    const capture = initialPriceCapture(before, data.expectedPrice);
    await tx.product.update({ where: { id: productId }, data: { ...data, ...capture } });
    if ("initialPrice" in capture) await tx.changeLog.create({ data: {
      actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "product", entityId: productId, action: "initialPrice.capture",
      oldValue: { initialPrice: null, initialPriceCaptureEligible: true },
      newValue: { initialPrice: capture.initialPrice.toString(), initialPriceCaptureEligible: false },
    } });
    if ((data.expectedPrice !== undefined && String(data.expectedPrice) !== String(before.expectedPrice)) ||
        (data.engineerId !== undefined && data.engineerId !== before.engineerId)) await tx.productStagePayPool.updateMany({
      where: { productId, kind: "ENGINEERING", state: "DRAFT" }, data: { revision: { increment: 1 } },
    });
    return { ok: true as const, before, noOp: false };
  }

export async function updateProductCore(actor: DomainActor, productId: string, input: UpdateProductInput, baseline?: ProductUpdateBaseline, transaction: TaskTransaction = withTaskTransaction) {
  if (baseline && Object.prototype.hasOwnProperty.call(baseline, "initialPrice")) return { ok: false as const, error: "Первоначальная цена недоступна для изменения" };
  if (!baseline) return { ok: false as const, error: "Обновите форму: требуется исходное значение изменённых полей" };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data=parsed.data;
  if (!hasAnyRole(actor.roles, MANAGER_ROLES) && Object.keys(data).some(key=>key!=="description")) return { ok: false as const, error:"Инженер правит только технический блок" };
  try { return await transaction(async tx=> {
    const result=await updateProductValues(actor,productId,data,baseline,tx);
    if (!result.ok) return result;
    if (!result.noOp) await tx.changeLog.create({data:{actorType:"user",actorId:actor.id,actorName:actor.name,source:actor.source,entity:"product",entityId:productId,action:"update",oldValue:json(baseline),newValue:json(data)}});
    return result;
  }); } catch(error) { return {ok:false as const,error:error instanceof Error?error.message:"Не удалось изменить изделие"}; }
}

export async function deleteProductCore(actor: DomainActor, productId:string, transaction: TaskTransaction = withTaskTransaction) {
  if (!hasAnyRole(actor.roles,MANAGER_ROLES)) throw new Error("Недостаточно прав");  const result = await transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, include: {
      _count: { select: { tasks: true, works: true, projectMaterials: true, stockMovements: true } },
    } });
    if (!product) return { ok: false as const, error: "Изделие не найдено" };
    const { tasks, works, projectMaterials, stockMovements } = product._count;
    if (tasks + works + projectMaterials + stockMovements > 0) return { ok: false as const, error: "К изделию привязаны задачи, работы или материалы — сначала удалите или отвяжите их" };
    if (await tx.productStagePayPool.count({ where: { productId, state: { in: ["SETTLED", "LEGACY_PROTECTED"] } } }))
      return { ok: false as const, error: "Нельзя удалить изделие с историей инженерных начислений" };
    if (await tx.productPercentageCompletion.count({ where: { productId } }))
      return { ok: false as const, error: "Нельзя удалить изделие с историей процентного этапа" };
    const configs = await tx.productPercentageConfig.findMany({ where: { productId }, select: { id: true } });
    if (configs.length) {
      await tx.productPercentageParticipant.deleteMany({ where: { configId: { in: configs.map((config) => config.id) } } });
      await tx.productPercentageConfig.deleteMany({ where: { productId } });
    }
    await tx.productStagePayPool.deleteMany({ where: { productId, state: "DRAFT" } });
    await tx.product.delete({ where: { id: productId } });
    await tx.changeLog.create({ data: {
      actorType: "user", actorId: actor.id, actorName: actor.name,
      entity: "product", entityId: productId, action: "delete", oldValue: { number: product.number, title: product.title },
    } });
    return { ok: true as const, product };
  });
  return result;
}


export async function patchProductCore(actor: DomainActor, input: ProductPatch, transaction: TaskTransaction = withTaskTransaction): Promise<ProductPatchResult> {
  const parsed = productPatchSchema.safeParse(input);
  if (!parsed.success) return malformedProductPatch(input, parsed.error.issues[0]?.message ?? "Ошибка поля");
  const patch=parsed.data;
  const identity = { field: patch.field, clientMutationId: patch.clientMutationId };
  const manager=hasAnyRole(actor.roles,MANAGER_ROLES);
  if (!manager && (patch.field!=="description" || !hasRole(actor.roles,"ENGINEER"))) return {...identity,kind:"forbidden",error:"Недостаточно прав"};
  const receiptId=`product-inline:${patch.clientMutationId}`;
  const fingerprint=createHash("sha256").update(JSON.stringify(patch)).digest("hex");
  try { return await transaction(async(tx):Promise<ProductPatchResult>=> {
    // Права проверяются до replay/conflict; после выхода из DESIGN старый ответ не раскрывается.
    const visibilityActor=manager?actor:await resolveVisibilityActor(tx,actor);
    const permitted=await tx.product.findFirst({where:{AND:[{id:patch.productId},productEditWhere(visibilityActor)]},select:{id:true,projectId:true,engineerId:true,status:true}});
    if (!permitted) return {...identity,kind:"not-found",error:"Изделие не найдено или недоступно"};
    if (!manager && (permitted.status!=="DESIGN" || permitted.engineerId!==actor.id)) return {...identity,kind:"forbidden",error:"Доступ к техническому блоку изменён"};
    const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
    if(receipt) {
      const saved=receipt.newValue;
      if(receipt.actorId!==actor.id||receipt.entityId!==patch.productId||!saved||typeof saved!=="object"||Array.isArray(saved)||saved.fingerprint!==fingerprint)
        return {...identity,kind:"validation",error:"Идентификатор сохранения уже использован"};
      if(!saved.result||typeof saved.result!=="object"||Array.isArray(saved.result)) throw new Error("Повреждён результат сохранения");
      return {...saved.result as unknown as Extract<ProductPatchResult,{kind:"saved"}>,repeated:true};
    }
    let result: Extract<ProductPatchResult,{kind:"saved"}>;
    if(patch.field==="client.phone"||patch.field==="project.address"||patch.field==="project.clientId") {
      const shared=await patchProductContactInTransaction(actor,{productId:patch.productId,
        field:patch.field==="client.phone"?"phone":patch.field==="project.address"?"address":"clientId",
        value:patch.value,expectedValue:patch.expectedValue,...(patch.field==="client.phone"?{expectedClientId:patch.expectedClientId}:{})},tx);
      if(!shared.ok)return {...identity,...shared};
      result={...identity,kind:"saved",value:shared.value,noOp:!shared.changed,derived:{clientId:shared.clientId,clientLabel:shared.clientLabel,phone:shared.phone,clientAddress:shared.clientAddress}};
    } else {
      await lockProductRow(tx,patch.productId);
      const current=await tx.product.findFirst({where:{AND:[{id:patch.productId},productEditWhere(visibilityActor)]},select:{id:true,projectId:true,title:true,kind:true,description:patch.field==="description",quantity:true,expectedPrice:true,initialPrice:true,engineerId:true,status:true}});
      if(!current) return {...identity,kind:"not-found",error:"Изделие не найдено или недоступно"};
      if(!manager && (current.engineerId!==actor.id||current.status!=="DESIGN")) return {...identity,kind:"forbidden",error:"Доступ к техническому блоку изменён"};
      const previous=canonical(patch.field,current[patch.field]);
      if(previous!==canonical(patch.field,patch.expectedValue)) return {...identity,kind:"conflict",error:"Поле изменено другим пользователем",currentValue:previous};
      if (patch.field === "description" && isProductDescriptionUnchanged(patch.value, previous as string | null))
        return {...identity,kind:"saved",value:previous,noOp:true};
      let value:ProductPatchValue=patch.value;
      if(patch.field==="description")value=normalizeProductDescription(patch.value);
      else if(patch.field==="expectedPrice")value=canonical(patch.field,value);
      else if(typeof value==="string") value=value.trim()||(patch.field==="title"?value:null);
      if(previous===value)return {...identity,kind:"saved",value,noOp:true};
      const data = {[patch.field]:value} as ProductValues;
      const mutation=await updateProductValues(actor,patch.productId,data,{[patch.field]:patch.expectedValue},tx);
      if(!mutation.ok)return {...identity,kind:"validation",error:mutation.error};
      const derived:ProductPatchDerived={};
      if(patch.field==="quantity"||patch.field==="expectedPrice") {
        const quantity=patch.field==="quantity"?Number(value):current.quantity;
        const price=patch.field==="expectedPrice"?value:canonical("expectedPrice",current.expectedPrice);
        derived.quantity=quantity; derived.currentUnitPrice=price===null?null:String(price);
        derived.lineTotalBYN=productLineTotal(price===null?null:String(price),quantity);
      }
      if(patch.field==="engineerId")derived.engineerLabel=value?(await tx.user.findFirst({where:{id:String(value)},select:{name:true}}))?.name??null:null;
      result={...identity,kind:"saved",value,derived};
    }
    if(!result.noOp)await tx.changeLog.create({data:{id:receiptId,actorType:"user",actorId:actor.id,actorName:actor.name,source:actor.source,
      entity:"product",entityId:patch.productId,action:"inline.update",field:patch.field,oldValue:json({value:patch.expectedValue}),newValue:json({fingerprint,result})}});
    return result;
  }); }catch(error){return {...identity,kind:"failure",error:error instanceof Error?error.message:"Не удалось сохранить поле"};}
}
