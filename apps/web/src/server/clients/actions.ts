"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { clientVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";

// Клиенты — офисные роли (§4, комбинированные роли: достаточно любой).

const clientSchema = z.object({
  name: z.string().min(1, "Укажите имя"),
  lastName: z.string().optional(),
  middleName: z.string().optional(),
  phone: z.string().min(1, "Укажите телефон"),
  email: z.string().optional(),
  address: z.string().optional(),
  comment: z.string().optional(),
});

async function requireAllowed() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, OFFICE_ROLES)) throw new Error("Недостаточно прав");
  return session;
}

export async function createClient(
  input: z.infer<typeof clientSchema>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await requireAllowed();
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const client = await prisma.client.create({ data: parsed.data });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "client",
    entityId: client.id,
    action: "create",
    newValue: { name: client.name, phone: client.phone },
  });
  revalidatePath("/clients");
  revalidatePath("/projects");
  return { ok: true, id: client.id };
}

export async function updateClient(
  clientId: string,
  input: z.infer<typeof clientSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAllowed();
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ошибка данных" };
  const actor = await resolveVisibilityActor(prisma, session.user);
  const before = await prisma.client.findFirst({ where: { AND: [{ id: clientId }, clientVisibilityWhere(actor)] } });
  if (!before) return { ok: false, error: "Клиент не найден" };
  await prisma.client.update({ where: { id: clientId }, data: parsed.data });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "client",
    entityId: clientId,
    action: "update",
    oldValue: { name: before.name, phone: before.phone },
    newValue: { name: parsed.data.name, phone: parsed.data.phone },
  });
  revalidatePath("/clients");
  return { ok: true };
}
