import { calculateWholeProductPercentage } from "@/lib/product-percentage-ceil";
import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import { MAX_PRODUCT_PERCENTAGE_RATE } from "@/lib/product-percentage-rate-limit";
import type { ProductPercentageView, ProductPercentageSectionView } from "@/lib/product-percentage-view";
import { PERCENTAGE_STAGE_POLICY } from "./stage-policy";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { fileVisibilityWhere,hasFullProjectVisibility, productVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";

// Зависимость от feature/81: enum DELIVERY переименован в STORAGE, мерж идёт после feature/81.
// Новый код видимости не вводит DELIVERY; где потребуется статус доставки, использовать строковый литерал "STORAGE".

type Reader = Pick<PrismaClient, "product" | "task" | "productPercentageParticipant" | "user" | "payrollEntry">;
export async function getProductPercentageView(actor: { id: string; roles: Role[] }, productId: string,
  database: Reader = prisma): Promise<ProductPercentageView> {
  const visibilityActor = await resolveVisibilityActor(database, actor);
  const product = await database.product.findFirst({ where: { AND: [{ id: productId }, productVisibilityWhere(visibilityActor)] },
    include: { project: { select: { currency: true } }, engineer: { select: { id:true, name: true, active:true, roles:true } }, mounter: { select: { id:true,name:true,active:true,roles:true } },assembler: { select: {id:true,name:true,active:true,roles:true} },
      percentageConfigs: { include: { participants: { include: { user: { select: { name: true } } } } } },
      percentageCompletions: { include: { shares: true } },
      stagePayPools: { where: { kind: "ENGINEERING" }, include: { settlement: true } },
      files: { where: { AND:[fileVisibilityWhere(visibilityActor),{ fileName: { endsWith: ".b3d", mode: "insensitive" } }] }, select: { id: true }, take: 1 },
    } });
  if (!product) throw new Error("Изделие не найдено");
  const manager = hasAnyRole(actor.roles, MANAGER_ROLES);
  const financeView = hasFullProjectVisibility(visibilityActor);
  const [engineers,assemblers,mounters] = await Promise.all([
    database.user.findMany({ where: { active: true, roles: { hasSome: ["ENGINEER"] } }, select: { id: true, name: true } }),
    database.user.findMany({ where: { active: true, roles: { hasSome: ["WORKER"] } }, select: {id:true,name:true} }),
    database.user.findMany({ where: { active: true, roles: { hasSome: ["MOUNTER"] } }, select: { id: true, name: true } }),
  ]);
  const sections = Object.fromEntries((["ENGINEERING","ASSEMBLY", "INSTALLATION"] as const).map((kind) => {
    const policy=PERCENTAGE_STAGE_POLICY[kind];
    const config = product.percentageConfigs.find((row) => row.kind === kind);
    const completion = product.percentageCompletions.find((row) => row.kind === kind);
    const editableAfterSkip = completion?.state === "SKIPPED_ONCE";
    const displayCompletion = editableAfterSkip ? null : completion;
    const pool = kind === "ENGINEERING" ? product.stagePayPools.at(0) : null;
    const assigneeUser = product[policy.recipient];
    const assignee = assigneeUser ? {userId:product[policy.assignment]!,name:assigneeUser.name,active:assigneeUser.active,eligible:assigneeUser.roles?.includes(policy.role) ?? false} : null;
    const quantity=Number.isSafeInteger(product.quantity)&&product.quantity>0?product.quantity:null;
    const productTotal=product.expectedPrice!==null&&quantity!==null?new Prisma.Decimal(product.expectedPrice.toString()).mul(quantity).toFixed(2):null;
    let draftTotal:string|null=null;
    // Прогноз суммы виден ДО назначения исполнителя: нужны только ставка и цена.
    if(!completion&&product.project.currency==="BYN"&&pool?.state!=="SETTLED"&&pool?.state!=="LEGACY_PROTECTED"&&config?.ratePercent!==null&&config?.ratePercent!==undefined){
      const rate=new Prisma.Decimal(config.ratePercent.toString());
      if(rate.isZero())draftTotal="0.00";
      else if(rate.lte(MAX_PRODUCT_PERCENTAGE_RATE)&&productTotal!==null&&product.expectedPrice!==null){try{draftTotal=calculateWholeProductPercentage({kind,unitPrice:product.expectedPrice!.toString(),quantity,rate:rate.toString()})?.amount??null;}catch{draftTotal=null;}}

    }
    const legacyPaidSummary = financeView && pool?.settlement
      ? { amount: pool.settlement.amount.toString(), currency: pool.settlement.payrollCurrency, count: 1 } : null;
    const members = completion ? completion.shares.map(row=>({userId:row.userId,name:row.userNameSnapshot,shareUnits:row.shareUnits,amount:row.amount?.toString()??null}))
      : assignee ? [{userId:assignee.userId,name:assignee.name,shareUnits:1000000,amount:draftTotal}] : [];
    const ownMember = members.find((row) => row.userId === actor.id) ?? null;
    const view: ProductPercentageSectionView = {
      hasConfiguration: Boolean(config),
      currentRatePercent: financeView ? config?.ratePercent?.toString()??null : null,
      assignee,
      unitPrice: financeView ? completion ? completion.priceSnapshot?.toString()??null : product.expectedPrice?.toString()??null : null,
      quantity: completion ? completion.quantitySnapshot??null : quantity,
      productTotal: financeView ? completion ? completion.totalSnapshot?.toString()??null : productTotal : null,
      calculationVersion: completion?.calculationVersion===4 ? 4 : completion?.calculationVersion===3 ? 3 : completion?.calculationVersion===2 ? 2 : completion ? 1 : 4,
      recipientCandidates: manager ? (kind==="ENGINEERING"?engineers:kind==="ASSEMBLY"?assemblers:mounters).map(user=>({userId:user.id,name:user.name})) : [],
      kind, state: completion?.state ?? (pool?.state === "SETTLED" || pool?.state === "LEGACY_PROTECTED" ? "LEGACY_PROTECTED" : "DRAFT"),
      ratePercent: financeView ? displayCompletion ? displayCompletion.ratePercentSnapshot?.toString()??null : config?.ratePercent?.toString()??null : null,
      price: financeView ? displayCompletion ? displayCompletion.priceSnapshot?.toString()??null : product.expectedPrice?.toString()??null : null,
      productCurrency: displayCompletion?.productCurrency ?? product.project.currency,
      payrollCurrency: displayCompletion?.payrollCurrency ?? null,
      // Сумма (прогноз DRAFT) видна всем, включая поле без назначения; ставки/база скрыты ниже.
      // Не-финансы (не MANAGER/PROCUREMENT): members только своя строка, имена исполнителей оставлены через assignee.
      total: displayCompletion?.amount?.toString() ?? draftTotal,
      members: financeView ? members : ownMember ? [ownMember] : [], revision: config?.revision ?? 0,
      canManage: manager,
      canTransfer: false,
      ownMember, legacyPaidSummary,
      skippedSnapshot: editableAfterSkip && financeView ? { completedAt: completion.completedAt.toISOString(), reason: completion.reason,
        price: completion.priceSnapshot?.toString() ?? null, ratePercent: completion.ratePercentSnapshot?.toString() ?? null,
        productCurrency: completion.productCurrency,
        members: completion.shares.map((row) => ({ userId: row.userId, name: row.userNameSnapshot, shareUnits: row.shareUnits })) } : null,
      transferCandidates: [],
    };
    return [kind, view];
  })) as ProductPercentageView["sections"];
  return { productId, noModel: product.noModel, hasB3d: product.files.length > 0, sections };
}
