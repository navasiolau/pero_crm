import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { cardDependencies, productVisibilityCommand, readActiveNumbers } from "@/server/projects/card-visibility-reversal";
import {parseProductPercentageRate} from "@/lib/product-percentage-rate-limit";
import {liveProductWhere,liveProjectWhere} from "@/server/access/live-entities";
import {softDeleteProductCore} from './delete-core';
import type {ProductDeleteInput,ProductDeleteMutationResult} from './delete-contract';
import { renumberActiveProductsInTransaction } from "./numbering";
import { patchProductContactInTransaction } from "../projects/contact-core";
import { PRODUCT_CARD_FIELDS, productFieldCommand, type ProductCardField } from './scalar-reversal';
import { persistTechnicalSpecifications, technicalSpecificationsCommand } from './specification-reversal';
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { normalizeProductDescription, isProductDescriptionUnchanged } from "@/lib/product-description";
import { effectiveProductSpecifications } from "@/lib/product-legacy-specifications";
import { productLineTotal } from "@/lib/product-quantity";
import { productEditWhere, resolveVisibilityActor } from "@/server/access/visibility";
import { productDraftAccessRelations } from "@/server/access/product-draft-context";
import { withTaskTransaction, type TaskTransaction } from "@/server/tasks/transaction";
import { lockProductRow, recalculateQuantity } from "./quantity-core";
import { lockProjectRow } from "@/server/projects/lock";
import { productInitialStatus } from "./draft-core";
import {lockWarehouseMetadata,warehouseMetadataGate} from '@/server/warehouse/gate';
import { initialPriceCapture, newProductInitialPrice } from "./initial-price";
import { readProductPercentageDefaults } from "@/server/product-percentage-defaults/core";
import { DEFAULT_PERCENTAGE_KINDS } from "@/server/product-percentage-defaults/contracts";
import type { DomainActor } from "../projects/core";
import { automationJournalContext, businessSnapshot, journalPersonLinks, productJournalContext, PRODUCT_JOURNAL_FIELDS } from "../projects/journal";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import { applySpecificationPatch, isSpecificationPatch } from "./specification-patch";
import { malformedProductPatch, productPatchSchema, technicalSpecificationsSchema, type ProductPatch, type ProductPatchResult, type ProductScalarValue, type ProductPatchDerived } from "./patch-contract";
export const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1, "Укажите название изделия"),
  quantity: z.number().int("Количество должно быть целым").min(1, "Количество должно быть не меньше 1").max(2_147_483_647, "Слишком большое количество изделий").default(1),
  kind: z.string().optional(),
  expectedPrice: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  description: z.string().optional(),
  technicalSpecifications: technicalSpecificationsSchema.optional(),
  // Инженер изделия — ответственен за конкретное изделие (§10)
  engineerId: z.string().optional(),
}).strict();

async function nextProductSuffixInt(
  projectId: string,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const siblings = await tx.product.findMany({
    where: { projectId, deletedAt: null },
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
export type ProductValues = Omit<UpdateProductInput, "expectedPrice"> & {expectedPrice?: string | number | null};
export type ProductUpdateBaseline = Partial<Record<keyof UpdateProductInput, ProductScalarValue>>;
const canonical = (field: string, value: unknown): ProductScalarValue => {
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
  if ((parsed.data.technicalSpecifications?.sourceGeneration ?? 0) !== 0 || (parsed.data.technicalSpecifications?.editRevision ?? 0) !== 0)
    return { ok: false as const, error: "Некорректная версия технических характеристик нового изделия" };
  try { productLineTotal(parsed.data.expectedPrice ?? null, parsed.data.quantity); }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Некорректная сумма партии" }; }
  return transaction(tx => createProductInTransaction(tx, actor, parsed.data));
}

/** Одинаковые defaults/history для обычного создания и состава КП. */
export async function createProductInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, input: CreateProductInput, numbering: "project" | "proposal" = "project", operationRootId?: string) {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data = parsed.data;
  try { productLineTotal(data.expectedPrice ?? null, data.quantity); }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Некорректная сумма партии" }; }
  await lockProjectRow(tx, data.projectId);
  const project = await tx.project.findUnique({
    where: {...liveProjectWhere, id: data.projectId },
    select: { id: true, number: true, currency: true, stage: true },
  });
  if (!project) return { ok: false as const, error: "Проект не найден" };
  if (data.expectedPrice !== undefined) {
    try { assertProjectMoneyCurrency(project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
  }
  if (data.engineerId && !await tx.user.findFirst({ where: { id: data.engineerId, active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true } }))
    return { ok: false as const, error: "Выберите активного сотрудника с ролью инженера" };

  const status = await productInitialStatus(tx, project);
  const defaults = await readProductPercentageDefaults(tx);
  try { for (const kind of DEFAULT_PERCENTAGE_KINDS) parseProductPercentageRate(defaults.rates[kind]); }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Проверьте стандартные проценты" }; }
  if (Object.values(defaults.rates).some(rate => rate !== null)) {
    try { assertProjectMoneyCurrency(project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
  }
  const createRoot = numbering === "project" ? randomUUID() : undefined;
  const beforeNumbers = createRoot ? await readActiveNumbers(tx, project.id) : [];
  const numberChanges = createRoot ? await renumberActiveProductsInTransaction(tx, actor, project, createRoot) : [];
  const suffixInt = await nextProductSuffixInt(project.id, tx);
  const number = `${project.number}.${suffixInt}`;
  const product = await tx.product.create({
    data: {
      projectId: project.id,
      number,
      suffixInt,
      title: data.title,
      status,
      quantity: data.quantity,
      kind: data.kind?.trim() || null,
      expectedPrice: data.expectedPrice,
      ...newProductInitialPrice(data.expectedPrice),
      description: data.technicalSpecifications ? null : normalizeProductDescription(data.description),
      technicalSpecifications: data.technicalSpecifications ? FurnitureSpecifications.normalizeProduct(data.technicalSpecifications)! : undefined,
      engineerId: data.engineerId || null,
  // Ставка обязательна из настроек: новые изделия получают снимок дефолтов.
  // Пустых ставок не бывает (решение 06.10.2026: пустое = 0); отсутствующий дефолт тоже 0.
  percentageConfigs: { create: DEFAULT_PERCENTAGE_KINDS.map(kind => ({ kind, ratePercent: defaults.rates[kind] ?? '0.00', revision: 1 })) },
      createdById: actor.id,
      statusHistory: {
        create: { toStatus: status, changedById: actor.id },
      },
    },
  });

  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: actor.id,
    actorName: actor.name ?? undefined,
    source: actor.source,
    entity: "product",
    entityId: product.id,
    action: "create", operationRootId,
    ...(createRoot && !operationRootId ? { id: createRoot, reversal: await productVisibilityCommand(tx, project.id, false, product.updatedAt,
      beforeNumbers, numberChanges, await cardDependencies(tx, "product", product.id)) } : {}),
    newValue: { number, title: data.title, quantity: data.quantity, project: project.number,
      percentageDefaultsRevision: defaults.revision, percentageRates: defaults.rates,
      initialPrice: product.initialPrice?.toString() ?? null, initialPriceCaptureEligible: data.expectedPrice === undefined,
      ...(data.technicalSpecifications ? { technicalSpecifications: data.technicalSpecifications } : {}) },
  }, { ...productJournalContext(product), ...(numbering === "proposal" ? automationJournalContext(actor, "Создание изделия из КП") : {}),
    before: null, after: {...businessSnapshot(product,PRODUCT_JOURNAL_FIELDS),percentageRates:defaults.rates},
    links:await journalPersonLinks(tx,[product.engineerId],actor) });
  return { ok: true as const, product, numberChanges };
}

export async function updateProductValues(actor: DomainActor, productId: string, data: ProductValues, baseline: ProductUpdateBaseline, tx: Prisma.TransactionClient, options: { operationRootId?: string; quantityRootId?: string; restoreRecordedValue?: boolean } = {}) {
    if(data.quantity!==undefined)await warehouseMetadataGate(tx);
    await lockProductRow(tx, productId);
    const visibilityActor = hasAnyRole(actor.roles, MANAGER_ROLES) ? actor : await resolveVisibilityActor(tx, actor);
    const before = await tx.product.findFirst({ where: {...liveProductWhere, AND: [{ id: productId }, productEditWhere(visibilityActor)] }, include: productDraftAccessRelations });
    if (!before) return { ok: false as const, error: "Изделие не найдено" };
    if (data.description !== undefined && before.technicalSpecifications != null)
      return { ok: false as const, error: "Технические характеристики уже обновлены. Откройте карточку заново" };
    if (data.expectedPrice !== undefined || data.quantity !== undefined) {
      const project = await tx.project.findUnique({ where: {...liveProjectWhere, id: before.projectId }, select: { currency: true } });
      if (!project) return { ok: false as const, error: "Проект не найден" };
      assertProjectMoneyCurrency(project.currency);
    }
    for (const key of Object.keys(data) as (keyof UpdateProductInput)[]) {
      if (!(key in baseline)) return { ok: false as const, error: "Обновите форму: отсутствует исходное значение поля" };
      if (canonical(key, before[key]) !== canonical(key, baseline[key])) return { ok: false as const, error: "Поле изменено другим пользователем" };
    }
    // Неизменённый legacy raw текст не очищаем даже при правке соседнего поля.
    if (!options.restoreRecordedValue && data.description !== undefined && !isProductDescriptionUnchanged(data.description, before.description))
      data.description = normalizeProductDescription(data.description);
    const changed = Object.keys(data).some((key) => canonical(key, before[key as keyof typeof before]) !== canonical(key, data[key as keyof UpdateProductInput]));
    if (!changed) return { ok: true as const, before, noOp: true as const };
    const oldCount = before.quantity ?? 1;
    const count = data.quantity ?? oldCount;
    productLineTotal(data.expectedPrice === undefined ? before.expectedPrice ?? null : data.expectedPrice, count);
    if (data.engineerId && data.engineerId !== before.engineerId && !await tx.user.findFirst({ where: { id: data.engineerId, active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true } }))
      return { ok: false as const, error: "Выберите активного сотрудника с ролью инженера" };
    if (count !== oldCount) await recalculateQuantity(tx, { ...before, quantity: oldCount }, count, actor, options.quantityRootId ?? options.operationRootId);
    const capture = initialPriceCapture(before, data.expectedPrice);
    const after = await tx.product.update({ where: { id: productId }, data: { ...data, ...capture } });
    if ("initialPrice" in capture) await writeChangeLogInTransaction(tx, {

      actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "product", entityId: productId, action: "initialPrice.capture",
      oldValue: { initialPrice: null, initialPriceCaptureEligible: true },
      newValue: { initialPrice: capture.initialPrice.toString(), initialPriceCaptureEligible: false },
    },{...productJournalContext(before),...automationJournalContext(actor,"Фиксация первоначальной цены изделия")});
    if ((data.expectedPrice !== undefined && String(data.expectedPrice) !== String(before.expectedPrice)) ||
        (data.engineerId !== undefined && data.engineerId !== before.engineerId)) await tx.productStagePayPool.updateMany({
      where: { productId, kind: "ENGINEERING", state: "DRAFT" }, data: { revision: { increment: 1 } },
    });
    return { ok: true as const, before, after, noOp: false as const };
  }

export async function updateProductCore(actor: DomainActor, productId: string, input: UpdateProductInput, baseline?: ProductUpdateBaseline, transaction: TaskTransaction = withTaskTransaction) {
  if (baseline && Object.prototype.hasOwnProperty.call(baseline, "initialPrice")) return { ok: false as const, error: "Первоначальная цена недоступна для изменения" };
  if (!baseline) return { ok: false as const, error: "Обновите форму: требуется исходное значение изменённых полей" };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data=parsed.data;
  if (!hasAnyRole(actor.roles, MANAGER_ROLES) && Object.keys(data).some(key=>key!=="description")) return { ok: false as const, error:"Инженер правит только технический блок" };
  try { return await transaction(async tx=> {
    const quantityRootId = data.quantity !== undefined ? randomUUID() : undefined;

    const result=await updateProductValues(actor,productId,data,baseline,tx,{quantityRootId});
    if (!result.ok) return result;
    if (!result.noOp) {
      for (const field of PRODUCT_CARD_FIELDS) {
        if (data[field] === undefined || canonical(field, result.before[field]) === canonical(field, data[field])) continue;
        const reversal = productFieldCommand(field, result.before, result.after);
        await writeChangeLogInTransaction(tx, {
          actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
          entity: "product", entityId: productId, action: "update", field, reversal, id: field === "quantity" ? quantityRootId : undefined,
          oldValue: canonical(field, result.before[field]), newValue: canonical(field, data[field]),
        }, { ...productJournalContext(result.before),
          links: field === "engineerId" ? await journalPersonLinks(tx, [result.before.engineerId, data.engineerId], actor) : [] });
      }
    }
    return result;
  }); } catch(error) { return {ok:false as const,error:error instanceof Error?error.message:"Не удалось изменить изделие"}; }
}

export async function deleteProductCore(actor: DomainActor, productId:string, transaction: TaskTransaction = withTaskTransaction,baseline?:Omit<ProductDeleteInput,'productId'>):Promise<ProductDeleteMutationResult> {
  if(!baseline)return{ok:false,kind:'validation',error:'Обновите подтверждение удаления изделия'};
  try{return await transaction(tx=>softDeleteProductCore(tx,actor,{productId,expectedUpdatedAt:baseline.expectedUpdatedAt,clientMutationId:baseline.clientMutationId}));}
  catch{return{ok:false,kind:'failure',error:'Не получено подтверждение удаления. Повторите тот же запрос'};}
}


export async function patchProductCore(actor: DomainActor, input: ProductPatch, transaction: TaskTransaction = withTaskTransaction): Promise<ProductPatchResult> {
  const parsed = productPatchSchema.safeParse(input);
  if (!parsed.success) return malformedProductPatch(input, parsed.error.issues[0]?.message ?? "Ошибка поля");
  const patch=parsed.data;
  const identity = { field: patch.field, clientMutationId: patch.clientMutationId };
  if (patch.field === "technicalSpecificationEntry")
    return {...identity,kind:"validation",error:"Формат технического описания изменён. Обновите карточку изделия"};
  const manager=hasAnyRole(actor.roles,MANAGER_ROLES);
  const technical = isSpecificationPatch(patch);
  const legacy = patch.field === "description";
  const contact = patch.field === "client.phone" || patch.field === "project.address" || patch.field === "project.clientId";
  if (!manager && (!(legacy || technical) || !hasRole(actor.roles,"ENGINEER"))) return {...identity,kind:"forbidden",error:"Недостаточно прав"};
  const receiptId=`product-inline:${patch.clientMutationId}`;
  const fingerprint=createHash("sha256").update(JSON.stringify(patch)).digest("hex");
  try { return await transaction(async(tx):Promise<ProductPatchResult>=> {
    // Права проверяются до replay/conflict; после выхода из DESIGN старый ответ не раскрывается.
    const visibilityActor=manager?actor:await resolveVisibilityActor(tx,actor);
    const where = { ...liveProductWhere, AND: [{ id: patch.productId }, productEditWhere(visibilityActor)] };
    const permitted = await tx.product.findFirst({ where, select: { id: true, number: true, projectId: true, engineerId: true, status: true } });
    if (!permitted) return {...identity,kind:"not-found",error:"Изделие не найдено или недоступно"};
    if (!manager && (permitted.status !== "DESIGN" || permitted.engineerId !== actor.id))
      return {...identity,kind:"forbidden",error:"Доступ к техническому блоку изменён"};
    // Контактные правки сами соблюдают порядок блокировок Project/Client.
    // Для остальных полей receipt читается после блокировки Product.
    const current = contact ? null : await (async () => {
      if (patch.field === "quantity") await lockWarehouseMetadata(tx);
      await lockProductRow(tx, patch.productId);
      return tx.product.findFirst({ where, select: {
        id: true, number: true, title: true, kind: true, description: legacy || technical, technicalSpecifications: legacy || technical,
        quantity: true, expectedPrice: true, engineerId: true, status: true, fieldRevisions: true,
      } });
    })();
    if (!contact && !current) return {...identity,kind:"not-found",error:"Изделие не найдено или недоступно"};
    if (current && !manager && (current.status !== "DESIGN" || current.engineerId !== actor.id))
      return {...identity,kind:"forbidden",error:"Доступ к техническому блоку изменён"};
    const receipt=await tx.changeLog.findUnique({where:{id:receiptId}});
    if(receipt) {
      const saved=receipt.newValue;
      if(receipt.actorId!==actor.id||receipt.entityId!==patch.productId||!saved||typeof saved!=="object"||Array.isArray(saved)||saved.fingerprint!==fingerprint)
        return {...identity,kind:"validation",error:"Идентификатор сохранения уже использован"};
      if(!saved.result||typeof saved.result!=="object"||Array.isArray(saved.result)) throw new Error("Повреждён результат сохранения");
      return {...saved.result as unknown as Extract<ProductPatchResult,{kind:"saved"}>,repeated:true};
    }
    if (legacy && current?.technicalSpecifications != null)
      return {...identity,kind:"conflict",error:"Технические характеристики уже обновлены. Откройте карточку заново"};
    let reversal: ReturnType<typeof productFieldCommand>;
    let result: Extract<ProductPatchResult,{kind:'saved'}>;
    if(patch.field==="client.phone"||patch.field==="project.address"||patch.field==="project.clientId") {
      const shared=await patchProductContactInTransaction(actor,{productId:patch.productId,
        field:patch.field==="client.phone"?"phone":patch.field==="project.address"?"address":"clientId",
        value:patch.value,expectedValue:patch.expectedValue,...(patch.field==="client.phone"?{expectedClientId:patch.expectedClientId}:{})},tx);
      if(!shared.ok)return {...identity,...shared};
      result={...identity,kind:"saved",value:shared.value,noOp:!shared.changed,derived:{clientId:shared.clientId,clientLabel:shared.clientLabel,phone:shared.phone,clientAddress:shared.clientAddress}};
    } else if (current && technical) {
      const materializing = current.technicalSpecifications == null;
      if ((materializing && patch.expectedLegacyDescription === undefined) ||
        (patch.expectedLegacyDescription !== undefined && current.description !== patch.expectedLegacyDescription))
        return {...identity,kind:"conflict",error:"Прежнее техническое описание изменено. Откройте карточку заново"};
      const before = effectiveProductSpecifications(current.technicalSpecifications, current.description);
      if (before === null && current.technicalSpecifications != null)
        return {...identity,kind:"failure",error:"Технические характеристики имеют неподдерживаемый формат"};
      if ((before?.sourceGeneration ?? 0) !== patch.expectedSourceGeneration)
        return {...identity,kind:"conflict",error:"Характеристики обновлены из КП. Откройте карточку заново"};
      const change = applySpecificationPatch(before, patch);
      if (!change.ok) return {...identity,kind:"conflict",error:change.error,currentValue:change.currentValue};
      const after = change.noOp ? null : await persistTechnicalSpecifications(tx, patch.productId, change.next);
      const reversal = after ? technicalSpecificationsCommand({
        technicalSpecifications: current.technicalSpecifications, fieldRevisions: current.fieldRevisions,
      }, after) : undefined;
      result = {...identity,kind:"saved",value:change.value,noOp:change.noOp,derived:{technicalSpecificationSectionId:change.sectionId,technicalSpecificationsEditRevision:change.next.editRevision ?? 0,
        ...(materializing && !change.noOp ? { technicalSpecifications: structuredClone(change.next) } : {})}};
      await writeChangeLogInTransaction(tx, {
        id: receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
        entity: "product", entityId: patch.productId, action: change.noOp ? "inline.receipt" : "inline.update", field: patch.field, reversal,
        ...(change.noOp ? { newValue: json({ fingerprint, result }) } : {
          oldValue: json({ technicalSpecifications: current.technicalSpecifications ?? null }),
          newValue: json({ fingerprint, result, technicalSpecifications: change.next }),
        }),
      },{...productJournalContext(current),kind:change.noOp?'receipt':'event',
        before:{technicalSpecifications:before},after:{technicalSpecifications:change.next}});
      return result;
    } else if (current && !technical) {
      const previous=canonical(patch.field,current[patch.field]);
      if(previous!==canonical(patch.field,patch.expectedValue)) return {...identity,kind:"conflict",error:"Поле изменено другим пользователем",currentValue:previous};
      if (patch.field === "description" && isProductDescriptionUnchanged(patch.value, previous as string | null))
        return {...identity,kind:"saved",value:previous,noOp:true};
      let value:ProductScalarValue=patch.value;
      if(patch.field==="description")value=normalizeProductDescription(patch.value);
      else if(patch.field==="expectedPrice")value=canonical(patch.field,value);
      else if(typeof value==="string") value=value.trim()||(patch.field==="title"?value:null);
      if(previous===value)return {...identity,kind:"saved",value,noOp:true};
      const data = {[patch.field]:value} as ProductValues;
      const mutation=await updateProductValues(actor,patch.productId,data,{[patch.field]:patch.expectedValue},tx,{operationRootId:receiptId});
      if(!mutation.ok)return {...identity,kind:"validation",error:mutation.error};
      if (!mutation.noOp) reversal = productFieldCommand(patch.field as ProductCardField, mutation.before, mutation.after);
      const derived:ProductPatchDerived={};
      if(patch.field==="quantity"||patch.field==="expectedPrice") {
        const quantity=patch.field==="quantity"?Number(value):current.quantity;
        const price=patch.field==="expectedPrice"?value:canonical("expectedPrice",current.expectedPrice);
        derived.quantity=quantity; derived.currentUnitPrice=price===null?null:String(price);
        derived.lineTotalBYN=productLineTotal(price===null?null:String(price),quantity);
      }
      if(patch.field==="engineerId")derived.engineerLabel=value?(await tx.user.findFirst({where:{id:String(value)},select:{name:true}}))?.name??null:null;
      result={...identity,kind:"saved",value,derived};
    } else {
      throw new Error("Не удалось прочитать изделие");
    }
    if(!result.noOp && "expectedValue" in patch)await writeChangeLogInTransaction(tx, {id:receiptId,actorType:"user",actorId:actor.id,actorName:actor.name,source:actor.source,
      entity:"product",entityId:patch.productId,action:"inline.update",field:patch.field,reversal,oldValue:json({value:patch.expectedValue}),newValue:json({fingerprint,result})},
      {...productJournalContext(current??permitted),kind:contact?'receipt':'event',before:{[patch.field]:patch.expectedValue},after:{[patch.field]:result.value},
        links:patch.field==='engineerId'?await journalPersonLinks(tx,[current?.engineerId,result.value===null?null:String(result.value)],actor):[]});
    return result;
  }); }catch(error){return {...identity,kind:"failure",error:error instanceof Error?error.message:"Не удалось сохранить поле"};}
}
