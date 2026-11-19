import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import type { MaterialUnit, Prisma } from "@prisma/client";
import { hasAnyRole, WAREHOUSE_UNIT_ADMIN_ROLES } from "@/lib/roles";
import type { DomainActor } from "@/server/actor";
import { catalogCommand, unitSnapshot } from "./catalog-reversal-contract";
import { materialUnitSchema, type MaterialUnitInput } from "./unit-contracts";

type Tx = Prisma.TransactionClient;
const forbidden = () => Error("Настраивать единицы измерения может только администратор");
async function requireUnitAdministrator(tx: Tx, actor: DomainActor) {
  if (!hasAnyRole(actor.roles, WAREHOUSE_UNIT_ADMIN_ROLES)) throw forbidden();
  const current = await tx.user.findUnique({ where: { id: actor.id }, select: { roles: true, active: true } });
  if (!current?.active || !hasAnyRole(current.roles, WAREHOUSE_UNIT_ADMIN_ROLES)) throw forbidden();
}
async function audit(tx: Tx, actor: DomainActor, action: string,
  before: MaterialUnit | null, after: MaterialUnit) {
  const id = after.id, oldName = before?.name, newName = after.name;
  await writeChangeLogInTransaction(tx, {
    actorType: "user", actorId: actor.id, actorName: actor.name, entity: "materialUnit", entityId: id, action,
    reversal: await catalogCommand(tx, { entity: "materialUnit", before, after }),
    oldValue: oldName === undefined ? undefined : { name: oldName },
    newValue: { name: newName }, source: actor.source,
  }, { entity: { label: `Единица измерения ${newName ?? oldName ?? ""}`.trim(), href: "/settings/warehouse-units" }, contexts: [], before: before ? unitSnapshot(before) : null, after: unitSnapshot(after) });
}
export async function createMaterialUnitInTransaction(tx: Tx, actor: DomainActor, input: MaterialUnitInput) {
  await requireUnitAdministrator(tx, actor);
  const data = materialUnitSchema.parse(input);
  const previous = await tx.materialUnit.findUnique({ where: { name: data.name } });
  const unit = previous?.deletedAt
    ? await tx.materialUnit.update({ where: { id: previous.id, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null } })
    : await tx.materialUnit.create({ data });
  await audit(tx, actor, "create", previous, unit);
  return unit;
}
export async function renameMaterialUnitInTransaction(tx: Tx, actor: DomainActor, id: string, input: MaterialUnitInput) {
  await requireUnitAdministrator(tx, actor);
  const data = materialUnitSchema.parse(input);
  await tx.$queryRaw`SELECT id FROM "MaterialUnit" WHERE id=${id} FOR UPDATE`;
  const previous = await tx.materialUnit.findUnique({ where: { id, deletedAt: null } });
  if (!previous) throw Error("Единица измерения не найдена");
  if (previous.name === data.name) return previous;
  const unit = await tx.materialUnit.update({ where: { id }, data });
  await audit(tx, actor, "update", previous, unit);
  return unit;
}
export async function deleteMaterialUnitInTransaction(tx: Tx, actor: DomainActor, id: string) {
  await requireUnitAdministrator(tx, actor);
  await tx.$queryRaw`SELECT id FROM "MaterialUnit" WHERE id=${id} FOR UPDATE`;
  const unit = await tx.materialUnit.findUnique({ where: { id, deletedAt: null } });
  if (!unit) throw Error("Единица измерения не найдена");
  if (await tx.material.count({ where: { unitId: id } })) throw Error("Единица используется в номенклатуре. Сначала выберите другую единицу во всех материалах, включая неактивные.");
  const after = await tx.materialUnit.update({ where: { id }, data: { deletedAt: new Date(), deletedById: actor.id } });
  await audit(tx, actor, "delete", unit, after);
}
export function materialUnitError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") return "Единица с таким обозначением уже существует";
    if (error.code === "P2003") return "Единица используется в номенклатуре. Сначала выберите другую единицу во всех материалах, включая неактивные.";
    if (error.code === "P2025") return "Единица измерения не найдена";
  }
  return error instanceof Error ? error.message : "Не удалось изменить единицу измерения";
}
