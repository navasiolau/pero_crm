import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import type { ProductPercentageView, ProductPercentageSectionView } from "@/lib/product-percentage-view";
import { PERCENTAGE_STAGE_POLICY } from "./stage-policy";
import { readWorkReview } from "./contracts";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { fileVisibilityWhere,hasFullProjectVisibility, productVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";

type Reader = Pick<PrismaClient, "product" | "task" | "productPercentageParticipant" | "user" | "payrollEntry">;
export async function getProductPercentageView(actor: { id: string; roles: Role[] }, productId: string,
  database: Reader = prisma): Promise<ProductPercentageView> {
  const visibilityActor = await resolveVisibilityActor(database, actor);
  const product = await database.product.findFirst({ where: { AND: [{ id: productId }, productVisibilityWhere(visibilityActor)] },
    include: { project: { select: { currency: true } }, engineer: { select: { id:true, name: true, active:true, roles:true } }, mounter: { select: { id:true,name:true,active:true,roles:true } },assembler: { select: {id:true,name:true,active:true,roles:true} },
      percentageConfigs: { include: { participants: { include: { user: { select: { name: true } } } } } },
      percentageCompletions: { include: { shares: true } },
      stagePayPools: { where: { kind: "ENGINEERING" }, include: { settlement: true } },
      works: { where: { paymentKind: { in: ["LEGACY", "INSTALLATION"] } },
        select: { id: true, title: true, paymentKind: true, projectId: true, stagePayPoolId: true, poolWeightUnits: true,
          tasks: { select: { id: true, projectId: true, productId: true } } } },
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
  const workIds = manager ? product.works.map((work) => work.id) : [];
  const taskIds = manager ? product.works.flatMap((work) => work.tasks.map((task) => task.id)) : [];
  const paid = manager && workIds.length ? await database.payrollEntry.findMany({ where: {
    OR: [{ workId: { in: workIds } }, { taskId: { in: taskIds } }],
  }, select: { workId: true, taskId: true } }) : [];
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
    if(!completion&&product.project.currency==="BYN"&&pool?.state!=="SETTLED"&&pool?.state!=="LEGACY_PROTECTED"&&config?.ratePercent!==null&&config?.ratePercent!==undefined){
      const rate=new Prisma.Decimal(config.ratePercent.toString());
      if(rate.isZero())draftTotal="0.00";
      else if(productTotal!==null&&assignee?.active&&assignee.eligible)draftTotal=new Prisma.Decimal(productTotal).mul(rate).div(100).toFixed(2,Prisma.Decimal.ROUND_HALF_UP);
    }
    const review=readWorkReview(config?.workReview);
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
      calculationVersion: completion?.calculationVersion===2 ? 2 : completion ? 1 : 2,
      workReview: manager ? review : [], canReview: manager&&!completion&&policy.requiresWorkReview,
      legacyWorkCandidates: manager&&policy.requiresWorkReview ? product.works.filter(work=>work.paymentKind==="LEGACY").map(work=>({id:work.id,title:work.title,paid:paid.some(entry=>entry.workId===work.id||work.tasks.some(task=>task.id===entry.taskId)),classification:review.find(row=>row.workId===work.id)?.classification??null})) : [],
      recipientCandidates: manager ? (kind==="ENGINEERING"?engineers:kind==="ASSEMBLY"?assemblers:mounters).map(user=>({userId:user.id,name:user.name})) : [],
      kind, state: completion?.state ?? (pool?.state === "SETTLED" || pool?.state === "LEGACY_PROTECTED" ? "LEGACY_PROTECTED" : "DRAFT"),
      ratePercent: financeView ? displayCompletion ? displayCompletion.ratePercentSnapshot?.toString()??null : config?.ratePercent?.toString()??null : null,
      price: financeView ? displayCompletion ? displayCompletion.priceSnapshot?.toString()??null : product.expectedPrice?.toString()??null : null,
      productCurrency: displayCompletion?.productCurrency ?? product.project.currency,
      payrollCurrency: displayCompletion?.payrollCurrency ?? null,
      total: financeView ? displayCompletion?.amount?.toString() ?? draftTotal : null,
      members: financeView ? members : ownMember ? [ownMember] : [], revision: config?.revision ?? 0,
      canManage: manager,
      canTransfer: false,
      ownMember, legacyPaidSummary,
      skippedSnapshot: editableAfterSkip && financeView ? { completedAt: completion.completedAt.toISOString(), reason: completion.reason,
        price: completion.priceSnapshot?.toString() ?? null, ratePercent: completion.ratePercentSnapshot?.toString() ?? null,
        productCurrency: completion.productCurrency,
        members: completion.shares.map((row) => ({ userId: row.userId, name: row.userNameSnapshot, shareUnits: row.shareUnits })) } : null,
      requiresManagerReview: kind === "ENGINEERING" ? !!pool && pool.state === "DRAFT" && !config
        : !config && product.works.some((work) => work.paymentKind === "LEGACY"),
      installationWorkCandidates: kind === "INSTALLATION" && manager && (!completion || editableAfterSkip) ? product.works
        .filter((work) => work.paymentKind === "LEGACY")
        .map((work) => { const hasPaid = paid.some((entry) => entry.workId === work.id || work.tasks.some((task) => task.id === entry.taskId));
          const mismatched = work.projectId !== product.projectId || work.tasks.some((task) => task.projectId !== product.projectId || task.productId !== product.id);
          return { id: work.id, title: work.title, canConvert: !editableAfterSkip && !hasPaid && !mismatched && work.stagePayPoolId === null && work.poolWeightUnits === null,
            reason: editableAfterSkip ? "После пропуска этапа источник оплаты этой работы не меняется"
              : hasPaid ? "Уже есть начисление" : mismatched ? "Связь задачи и изделия не совпадает"
              : work.stagePayPoolId !== null || work.poolWeightUnits !== null ? "Связана со старым фондом" : null }; }) : [],
      classifiedInstallationWorkIds: kind === "INSTALLATION" && manager ? product.works
        .filter((work) => work.paymentKind === "INSTALLATION").map((work) => work.id) : [],
      transferCandidates: [],
    };
    return [kind, view];
  })) as ProductPercentageView["sections"];
  return { productId, noModel: product.noModel, hasB3d: product.files.length > 0, sections };
}
