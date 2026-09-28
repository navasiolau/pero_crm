"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { notifyOrg } from "@/server/notifications/notify";
import { OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { projectVisibilityWhere } from "@/server/access/visibility";


const schema = z.object({
  projectId: z.string(),
  type: z.enum(["CALL", "EMAIL", "MESSENGER", "MEETING", "NOTE"]),
  text: z.string().min(1, "Введите текст"),
});

export async function addCommunication(
  input: z.infer<typeof schema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, OFFICE_ROLES)) throw new Error("Недостаточно прав");
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  const project = await prisma.project.findFirst({
    where: { AND: [{ id: data.projectId }, projectVisibilityWhere(session.user)] },
    select: { id: true, number: true, clientId: true },
  });
  if (!project) return { ok: false, error: "Проект не найден" };

  const entry = await prisma.communication.create({
    data: {
      projectId: data.projectId,
      clientId: project.clientId,
      type: data.type,
      text: data.text,
      createdById: session.user.id,
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "communication",
    entityId: entry.id,
    action: "create",
    newValue: { project: project.number, type: data.type },
  });
  await notifyOrg({
    type: "communication.added",
    title: `Коммуникация по ${project.number}`,
    body: data.text.slice(0, 120),
    link: `/projects/${data.projectId}`,
    exceptUserId: session.user.id,
  });

  revalidatePath(`/projects/${data.projectId}`);
  return { ok: true };
}
