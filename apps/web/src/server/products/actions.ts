"use server";

import { revalidatePath } from "next/cache";
import { deliverPostCommit } from "@/server/operations/post-commit";
import type { ProductStatus } from "@prisma/client";
import { auth } from "@/auth";
import {prisma} from '@/lib/prisma';
import {MANAGER_ROLES,hasAnyRole} from '@/lib/roles';
import { productVisibilityWhere } from "../access/visibility";
import {productDeleteSchema,type ProductDeleteInput,type ProductDeleteResult,type ProductDeleteBaseline} from './delete-contract';
import { productStatusLabels } from "@/lib/product-statuses";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { revalidateProductPaths } from "./revalidate";
import { listProductOptions } from "./queries";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { settlePendingProductPercentage, deliverProductPercentageEffects } from "@/server/product-percentage-pay/core";
import { changeProductStatusTransaction } from "./status-core";
import { createProductCore, updateProductCore, deleteProductCore, patchProductCore, type CreateProductInput, type UpdateProductInput, type ProductUpdateBaseline } from "./core";
import { malformedProductPatch, productPatchSchema, type ProductPatch, type ProductPatchResult } from "./patch-contract";

type FinanceState = "PENDING_FX" | "SETTLED" | "SKIPPED_ONCE" | "LEGACY_PROTECTED" | null;
async function requireUser() {
  const session=await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}
function domainActor(session: Awaited<ReturnType<typeof requireUser>>) {
  return {id:session.user.id,name:session.user.name??"",roles:session.user.roles,source:"web" as const};
}
async function revalidateProduct(product: { id: string; projectId: string }) {
  await deliverPostCommit("product-cache", product.id, [{ kind: "cache", run: () => revalidateProductPaths(product.id) },
    { kind: "cache", run: () => revalidatePath("/projects") }]);
}
export async function createProduct(input:CreateProductInput):Promise<{ok:boolean;id?:string;error?:string}> {
  const session=await requireUser();
  const result=await createProductCore(domainActor(session),input);
  if(!result.ok)return result;
  await revalidateProduct(result.product);
  return{ok:true,id:result.product.id};
}
/** Прежняя форма должна передать свой исходный baseline, а не снимок с сервера в момент записи. */
export async function updateProduct(productId:string,input:UpdateProductInput,baseline?:ProductUpdateBaseline):Promise<{ok:boolean;error?:string}> {
  const session=await requireUser();
  const result=await updateProductCore(domainActor(session),productId,input,baseline);
  if(!result.ok)return result;
  if(result.noOp)return{ok:true};
  await revalidateProduct(result.before);
  if(input.quantity!==undefined) await deliverPostCommit("product-update", productId, ["/","/warehouse","/warehouse/stock","/warehouse/items","/finance"].map(path => ({ kind: "cache" as const, run: () => revalidatePath(path) })));
  return{ok:true};
}
/** Compact field action: no Next cache invalidation, no full RSC/card reload. */
export async function patchProduct(input:ProductPatch):Promise<ProductPatchResult> {
  const session=await auth();
  if(!session?.user) {
    const parsed=productPatchSchema.safeParse(input);
    if(!parsed.success)return malformedProductPatch(input);
    return{kind:"forbidden",field:parsed.data.field,clientMutationId:parsed.data.clientMutationId,error:"Не авторизован"};
  }
  return patchProductCore(domainActor(session),input);
}
export async function readProductDeleteBaseline(productId:string):Promise<{ok:true;baseline:ProductDeleteBaseline}|{ok:false;error:string}>{
  const session=await auth();if(!session?.user||!hasAnyRole(session.user.roles,MANAGER_ROLES))return{ok:false,error:'Недостаточно прав'};
  const product=await prisma.product.findFirst({where:{id:productId,AND:[productVisibilityWhere(session.user)]},select:{id:true,number:true,title:true,updatedAt:true}});
  if(!product)return{ok:false,error:'Изделие не найдено'};
  return{ok:true,baseline:{productId:product.id,number:product.number,title:product.title,expectedUpdatedAt:product.updatedAt.toISOString()}};
}
export async function deleteProduct(input:string|ProductDeleteInput):Promise<ProductDeleteResult> {
  const session=await auth();if(!session?.user)return{ok:false,kind:'forbidden',error:'Не авторизован'};
  const parsed=productDeleteSchema.safeParse(input);if(!parsed.success)return{ok:false,kind:'validation',error:'Обновите подтверждение удаления изделия'};
  const data=parsed.data,result=await deleteProductCore(domainActor(session),data.productId,withTaskTransaction,data);
  if(result.ok)await revalidateProductPaths(result.productId).catch(()=>{});
  return result;
}
export async function deleteProductAction(input:ProductDeleteInput):Promise<ProductDeleteResult>{return deleteProduct(input);}
export async function changeProductStatus(
  productId: string, toStatus: ProductStatus, comment?: string,
): Promise<{ ok: boolean; error?: string; financeState?: FinanceState }> {
  const session = await requireUser();
  if (!Object.hasOwn(productStatusLabels, toStatus)) return { ok: false, error: "Неизвестный статус изделия" };
  try {
    const result = await withTaskTransaction((tx) => changeProductStatusTransaction(tx,
      { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" },
      productId, toStatus, comment));
    if (!result.ok) return result;
    await deliverPostCommit("product-status", productId, [{ kind: "payroll", run: () => deliverProductPercentageEffects(result.percentageEffects, productId, session.user.id) }]);
    let financeState: FinanceState = result.percentageEffects.earnings.length ? "SETTLED" : null;
    for (const kind of result.captured) {
      let current: FinanceState;
      try { current = await settlePendingProductPercentage(productId, kind); }
      catch { current = "PENDING_FX"; }
      financeState = current === "PENDING_FX" || (financeState as FinanceState) === "PENDING_FX" ? "PENDING_FX" : current;
    }
    if (result.eventId) {
      await deliverPostCommit("product-status", productId, [{ kind: "dispatch", run: () => dispatchEvent(result.eventId!) },
      { kind: "org", run: () => notifyOrg({ type: "product.statusChanged",
        title: `${result.product.number}: ${productStatusLabels[result.product.status]} → ${productStatusLabels[toStatus]}`,
        body: result.product.title, link: `/products/${productId}`, exceptUserId: session.user.id,
      }) }]);

    }
    await revalidateProduct(result.product);
    return { ok: true, financeState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось изменить статус изделия" };
  }
}

export async function fetchProductOptions(
  projectId: string,
): Promise<{ id: string; number: string; title: string }[]> {
  const session = await requireUser();
  return listProductOptions(projectId, session.user);
}
