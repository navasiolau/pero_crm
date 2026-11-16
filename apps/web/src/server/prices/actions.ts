"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { canManagePrices } from "@/lib/roles";

// Прайсы: управление — менеджмент или дополнительный ответственный (§4, §9);
// любое изменение — в журнал изменений. Цена в работах не переписывается.

const priceSchema = z.object({
  name: z.string().min(1, "Укажите название расценки"),
  unit: z.string().min(1, "Укажите единицу"),
  price: z.number().positive("Цена должна быть больше нуля"),
  category: z.string().optional(),
});

async function requireManage() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!canManagePrices(session.user.roles)) throw new Error("Недостаточно прав");
  return session;
}

export async function createPriceItem(
  input: z.infer<typeof priceSchema>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await requireManage();
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const item = await withTaskTransaction(async tx => {
  const item = await tx.priceItem.create({ data: parsed.data });
  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "priceItem",
    entityId: item.id,
    action: "create",
    newValue: { name: item.name, price: item.price.toString(), unit: item.unit },
  }, { entity: { label: `Расценка ${item.name}`, href: "/prices" }, contexts: [], before: null,
    after: { name: item.name, price: item.price.toString(), unit: item.unit, category: item.category, active: item.active } });
  return item;
  });
  revalidatePath("/prices");
  return { ok: true, id: item.id };
}

export async function updatePriceItem(
  itemId: string,
  input: z.infer<typeof priceSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireManage();
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ошибка данных" };
  const result = await withTaskTransaction(async tx => {
  const before = await tx.priceItem.findUnique({ where: { id: itemId } });
  if (!before) return { ok: false as const, error: "Расценка не найдена" };
  const after = await tx.priceItem.update({ where: { id: itemId }, data: parsed.data });
  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "priceItem",
    entityId: itemId,
    action: "update",
    oldValue: {
      name: before.name,
      price: before.price.toString(),
      unit: before.unit,
    },
    newValue: {
      name: parsed.data.name,
      price: parsed.data.price,
      unit: parsed.data.unit,
    },
  }, { entity: { label: `Расценка ${after.name}`, href: "/prices" }, contexts: [],
    before: { name: before.name, price: before.price.toString(), unit: before.unit, category: before.category, active: before.active },
    after: { name: after.name, price: after.price.toString(), unit: after.unit, category: after.category, active: after.active } });
  return { ok: true as const };
  });
  if (!result.ok) return result;
  revalidatePath("/prices");
  return { ok: true };
}

export async function togglePriceItem(
  itemId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireManage();
  const result = await withTaskTransaction(async tx => {
  const before = await tx.priceItem.findUnique({ where: { id: itemId } });
  if (!before) return { ok: false as const, error: "Расценка не найдена" };
  if (before.active === active) return { ok: true as const };
  await tx.priceItem.update({ where: { id: itemId }, data: { active } });
  await writeChangeLogInTransaction(tx, {
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "priceItem",
    entityId: itemId,
    action: "toggle",
    field: "active",
    oldValue: !active,
    newValue: active,
  }, { entity: { label: `Расценка ${before.name}`, href: "/prices" }, contexts: [] });
  return { ok: true as const };
  });
  if (!result.ok) return result;
  revalidatePath("/prices");
  return { ok: true };
}
