import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../projects/core";
import { withTaskTransaction, type TaskTransaction } from "../tasks/transaction";
import { canManageFinishCatalog } from "@/lib/finish-catalog-access";
import { finishFieldsSchema, finishUpdateSchema, finishActiveSchema, finishView, type FinishMutationResult } from "./contracts";
const denied = (): FinishMutationResult => ({ ok: false, kind: "forbidden", error: "Недостаточно прав" });
function failure(error: unknown): FinishMutationResult {
  return error && typeof error === "object" && "code" in error && error.code === "P2002"
    ? { ok: false, kind: "validation", error: "Код уже используется для этого типа отделки" }
    : { ok: false, kind: "failure", error: "Не удалось сохранить вариант отделки" };
}
async function audit(tx: Prisma.TransactionClient, actor: DomainActor, id: string, action: string, oldValue: Prisma.InputJsonValue, newValue: Prisma.InputJsonValue) {
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source, entity: "finish", entityId: id, action, oldValue, newValue } });
}
export async function createFinishCore(actor: DomainActor, input: unknown, transaction: TaskTransaction = withTaskTransaction): Promise<FinishMutationResult> {
  if (!canManageFinishCatalog(actor.roles)) return denied();
  const parsed = finishFieldsSchema.safeParse(input); if (!parsed.success) return { ok: false, kind: "validation", error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  try { return await transaction(async tx => { const row = await tx.finish.create({ data: { id: randomUUID(), ...parsed.data } }); const view = finishView(row); await audit(tx, actor, row.id, "create", {}, view); return { ok: true, row: view }; }); } catch (error) { return failure(error); }
}
async function update(actor: DomainActor, input: unknown, activeOnly: boolean, transaction: TaskTransaction): Promise<FinishMutationResult> {
  if (!canManageFinishCatalog(actor.roles)) return denied();
  const parsed = (activeOnly ? finishActiveSchema : finishUpdateSchema).safeParse(input); if (!parsed.success) return { ok: false, kind: "validation", error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const { id, expectedRevision, ...data } = parsed.data;
  try { return await transaction(async tx => {
    const current = await tx.finish.findUnique({ where: { id } }); if (!current) return { ok: false, kind: "not-found", error: "Вариант отделки не найден" };
    const conflict: FinishMutationResult = { ok: false, kind: "conflict", error: "Вариант изменён другим пользователем. Обновите каталог и повторите" };
    if (current.revision !== expectedRevision) return conflict;
    if (Object.entries(data).every(([key, value]) => current[key as keyof typeof current] === value)) return { ok: true, row: finishView(current), noOp: true };
    const changed = await tx.finish.updateMany({ where: { id, revision: expectedRevision }, data: { ...data, revision: { increment: 1 } } }); if (changed.count !== 1) return conflict;
    const row = await tx.finish.findUnique({ where: { id } }); if (!row) throw Error("FINISH_MISSING_AFTER_UPDATE");
    const view = finishView(row); await audit(tx, actor, id, activeOnly ? "activity" : "update", finishView(current), view); return { ok: true, row: view };
  }); } catch (error) { return failure(error); }
}
export const updateFinishCore = (actor: DomainActor, input: unknown, transaction: TaskTransaction = withTaskTransaction) => update(actor, input, false, transaction);
export const setFinishActiveCore = (actor: DomainActor, input: unknown, transaction: TaskTransaction = withTaskTransaction) => update(actor, input, true, transaction);
