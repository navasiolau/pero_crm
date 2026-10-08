import type { Prisma } from "@prisma/client";
import { hasAnyRole, WAREHOUSE_UNIT_ADMIN_ROLES } from "@/lib/roles";
import type { DomainActor } from "@/server/actor";
import { materialUnitSchema, type MaterialUnitInput } from "./unit-contracts";

type Tx = Prisma.TransactionClient;
const forbidden = () => Error("Настраивать единицы измерения может только администратор");
async function requireUnitAdministrator(tx: Tx, actor: DomainActor) {
  if (!hasAnyRole(actor.roles, WAREHOUSE_UNIT_ADMIN_ROLES)) throw forbidden();
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { roles: true, active: true } });
  if (!current?.active || !hasAnyRole(current.roles, WAREHOUSE_UNIT_ADMIN_ROLES)) throw forbidden();
}
async function audit(tx: Tx, actor: DomainActor, id: string, action: string, oldName?: string, newName?: string) {
  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name, entity: "materialUnit", entityId: id, action,
    oldValue: oldName === undefined ? undefined : { name: oldName },
    newValue: newName === undefined ? undefined : { name: newName }, source: actor.source,
  } });
}
export async function createMaterialUnitInTransaction(tx: Tx, actor: DomainActor, input: MaterialUnitInput) {
  await requireUnitAdministrator(tx, actor);
  const data = materialUnitSchema.parse(input);
  const unit = await tx.materialUnit.create({ data });
  await audit(tx, actor, unit.id, "create", undefined, unit.name);
  return unit;
}
export async function renameMaterialUnitInTransaction(tx: Tx, actor: DomainActor, id: string, input: MaterialUnitInput) {
  await requireUnitAdministrator(tx, actor);
  const data = materialUnitSchema.parse(input);
  const previous = await tx.materialUnit.findUnique({ where: { id } });
  if (!previous) throw Error("Единица измерения не найдена");
  if (previous.name === data.name) return previous;
  const unit = await tx.materialUnit.update({ where: { id }, data });
  await audit(tx, actor, unit.id, "update", previous.name, unit.name);
  return unit;
}
export async function deleteMaterialUnitInTransaction(tx: Tx, actor: DomainActor, id: string) {
  await requireUnitAdministrator(tx, actor);
  const unit = await tx.materialUnit.findUnique({ where: { id } });
  if (!unit) throw Error("Единица измерения не найдена");
  if (await tx.material.count({ where: { unitId: id } })) throw Error("Единица используется в номенклатуре. Сначала выберите другую единицу во всех материалах, включая неактивные.");
  await tx.materialUnit.delete({ where: { id } });
  await audit(tx, actor, id, "delete", unit.name);
}
export function materialUnitError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") return "Единица с таким обозначением уже существует";
    if (error.code === "P2003") return "Единица используется в номенклатуре. Сначала выберите другую единицу во всех материалах, включая неактивные.";
    if (error.code === "P2025") return "Единица измерения не найдена";
  }
  return error instanceof Error ? error.message : "Не удалось изменить единицу измерения";
}
