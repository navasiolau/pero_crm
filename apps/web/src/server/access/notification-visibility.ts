import type { PrismaClient } from "@prisma/client";
import { hasRole } from "@/lib/roles";
import { hasFullProjectVisibility, productVisibilityWhere, projectVisibilityWhere, taskVisibilityWhere, type VisibilityActor } from "./visibility";

type NotificationContent = { type: string; title: string; body: string | null; link: string | null };
type Lookup = Pick<PrismaClient, "product" | "project" | "task">;

/** Legacy task notifications have only /my, not an entity ID. Redact on read;
 * never rewrite history or attempt to identify a task from its free-text title. */
export async function scopeNotificationContent<T extends NotificationContent>(
  actor: VisibilityActor,
  items: T[],
  db: Lookup,
): Promise<T[]> {
  if (!hasRole(actor.roles, "ENGINEER") || hasFullProjectVisibility(actor)) return items;
  const checked = new Map<string, Promise<boolean>>();
  const canReadLink = (link: string | null): Promise<boolean> => {
    if (!link) return Promise.resolve(false);
    const match = /^\/(products|projects|tasks)\/([^/?#]+)/.exec(link);
    if (!match) return Promise.resolve(false);
    let key: string;
    try { key = decodeURIComponent(match[2]); } catch { return Promise.resolve(false); }
    const cacheKey = `${match[1]}/${key}`;
    const previous = checked.get(cacheKey);
    if (previous) return previous;
    const allowed = (async () => {
      if (match[1] === "products") return Boolean(await db.product.findFirst({
        where: { AND: [productVisibilityWhere(actor), { OR: [{ id: key }, { number: key }] }] }, select: { id: true },
      }));
      if (match[1] === "projects") return Boolean(await db.project.findFirst({
        where: { AND: [projectVisibilityWhere(actor), { id: key }] }, select: { id: true },
      }));
      return Boolean(await db.task.findFirst({
        where: { AND: [taskVisibilityWhere(actor), { id: key }] }, select: { id: true },
      }));
    })();
    checked.set(cacheKey, allowed);
    return allowed;
  };
  return Promise.all(items.map(async (item) => {
    if (item.type.startsWith("payroll.") || item.type === "user.accountChanged" || await canReadLink(item.link)) return item;
    return { ...item, title: "Список доступных задач обновлён", body: null, link: "/my" };
  }));
}
