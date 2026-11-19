import type { Prisma, ProductPercentageKind } from "@prisma/client";
import { z } from "zod";
import { cardFieldRevision } from "@/server/changelog/field-reversal";
import { readWorkflowCompensation } from "@/server/changelog/workflow-dependencies";
import { liveProductWhere } from "@/server/access/live-entities";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";
import { lockProductRow } from "@/server/products/quantity-core";
import { PERCENTAGE_STAGE_POLICY } from "./stage-policy";

const schema = z.object({
  kind: z.enum(["ENGINEERING", "ASSEMBLY", "INSTALLATION"]), field: z.enum(["ratePercent", "assigneeId"]),
  previous: z.string().nullable(), expected: z.string().nullable(), revision: z.number().int(),
  dependency: z.string(), compensation: z.json(),
});
type Settings = z.infer<typeof schema>;

export async function percentageSettingsDependency(tx: Prisma.TransactionClient, productId: string, kind: ProductPercentageKind) {
  const latest = await tx.productPercentageAdjustment.findFirst({
    where: { completionShare: { completion: { productId, kind } } }, orderBy: { configRevision: "desc" }, select: { id: true },
  });
  const completion = await tx.productPercentageCompletion.findUnique({ where: { productId_kind: { productId, kind } },
    select: { id: true, state: true, settledAt: true } });
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId },
    select: { workflowRevision: true, fieldRevisions: true, engineerId: true, assemblerId: true, mounterId: true } });
  const assignment = PERCENTAGE_STAGE_POLICY[kind].assignment;
  return JSON.stringify([latest?.id, completion, product.workflowRevision, product[assignment], cardFieldRevision(product.fieldRevisions, assignment)]);
}

export async function validatePercentageRecipient(tx: Prisma.TransactionClient, kind: ProductPercentageKind, value: string | null) {
  if (!value) return null;
  const recipient = await tx.user.findUnique({ where: { id: value }, select: { name: true, active: true, roles: true } });
  if (!recipient?.active || !recipient.roles.includes(PERCENTAGE_STAGE_POLICY[kind].role))
    throw new JournalReversalRefusal("Выберите активного сотрудника нужной роли");
  return recipient.name;
}

export async function persistPercentageSettings(tx: Prisma.TransactionClient, productId: string, kind: ProductPercentageKind,
  config: { id: string } | null, field: Settings["field"], value: string | null) {
  if (field === "assigneeId") await tx.product.update({ where: { id: productId }, data: { [PERCENTAGE_STAGE_POLICY[kind].assignment]: value } });
  const fields = field === "ratePercent" ? { ratePercent: value } : {};
  return config
    ? tx.productPercentageConfig.update({ where: { id: config.id }, data: { ...fields, revision: { increment: 1 } } })
    : tx.productPercentageConfig.create({ data: { productId, kind, ...fields, revision: 1 } });
}

const href = (id: string) => `/products/${encodeURIComponent(id)}`;
async function eligible(tx: Prisma.TransactionClient, id: string, data: Settings) {
  const product = await tx.product.findFirst({ where: { ...liveProductWhere, id }, select: {
    projectId: true, status: true, engineerId: true, assemblerId: true, mounterId: true, number: true,
  } });
  const config = await tx.productPercentageConfig.findUnique({ where: { productId_kind: { productId: id, kind: data.kind } } });
  const value = data.field === "ratePercent" ? config?.ratePercent?.toString() ?? null : product?.[PERCENTAGE_STAGE_POLICY[data.kind].assignment];
  if (!product || product.status === "DONE" || !config || config.revision !== data.revision || value !== data.expected ||
    await percentageSettingsDependency(tx, id, data.kind) !== data.dependency)
    throw new JournalReversalRefusal("После правки изменились процент, назначение или связанный расчёт", href(id));
  return { product, config };
}

export function percentageSettingsCommand(data: Omit<Settings, "compensation">, compensation: unknown) {
  return productPercentageSettingsReversal.command({ ...data, compensation: schema.shape.compensation.parse(compensation) });
}

export const productPercentageSettingsReversal = defineJournalReversal({
  kind: "product.workflow.percentageSetting", version: 1, schema,
  async preview(ctx, data) {
    await eligible(ctx.tx, ctx.entityId, data);
    if (data.field === "assigneeId") await validatePercentageRecipient(ctx.tx, data.kind, data.previous);
    await readWorkflowCompensation(data.compensation)?.preview(ctx);
    return null;
  },
  async apply(ctx, data) {
    const { tx, entityId } = ctx;
    const binding = await tx.product.findFirst({ where: { ...liveProductWhere, id: entityId }, select: { projectId: true } });
    if (!binding) throw new JournalReversalRefusal("Изделие не найдено");
    await lockProjectRow(tx, binding.projectId);
    await lockProductRow(tx, entityId);
    const { config, product } = await eligible(tx, entityId, data);
    if (data.field === "assigneeId") await validatePercentageRecipient(tx, data.kind, data.previous);
    const compensation = await readWorkflowCompensation(data.compensation)?.apply(ctx);
    const restored = await persistPercentageSettings(tx, entityId, data.kind, config, data.field, data.previous);
    return {
      inverse: { ...data, previous: data.expected, expected: data.previous, revision: restored.revision,
        dependency: await percentageSettingsDependency(tx, entityId, data.kind),
        compensation: compensation ? schema.shape.compensation.parse(compensation.reversal.data) : null },
      oldValue: { kind: data.kind, [data.field]: data.expected },
      newValue: { kind: data.kind, [data.field]: data.previous, compensation: compensation?.newValue },
      cachePaths: ["/products", `/products/${encodeURIComponent(product.number)}`, ...(compensation?.cachePaths ?? [])],
    };
  },
});
