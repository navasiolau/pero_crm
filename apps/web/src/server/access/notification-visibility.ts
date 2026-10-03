import {currentReminderNamespace} from "@/server/calendar/reminder-visibility";
import type { PrismaClient } from "@prisma/client";
import {FINANCIAL_ORG_NOTIFICATION_TYPES,canReceiveNotificationContent} from '@/lib/notification-access';
import { hasFullProjectVisibility, productVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor, taskVisibilityWhere, type VisibilityActor } from "./visibility";

type NotificationContent = { id?:string; type: string; title: string; body: string | null; link: string | null };
type Lookup = Pick<PrismaClient, "product" | "project" | "task"> & Partial<Pick<PrismaClient,"user"|"calendarReminderFact">>;

/** Legacy task notifications have only /my, not an entity ID. Redact on read;
 * never rewrite history or attempt to identify a task from its free-text title. */
export async function scopeNotificationContent<T extends NotificationContent>(
  actor: VisibilityActor,
  items: T[],
  db: Lookup,
): Promise<T[]> {
  items=items.filter(item=>canReceiveNotificationContent(actor.roles,item.type));
  const planItems=items.filter(item=>item.type==='plan.reminder');
  if(planItems.length){
    const namespace=db.user?await currentReminderNamespace(actor.id,db as Pick<PrismaClient,'user'>):null;
    const facts=namespace&&db.calendarReminderFact?await db.calendarReminderFact.findMany({where:{namespace,ownerId:actor.id,webState:'DELIVERED',webNotificationId:{in:planItems.flatMap(item=>item.id?[item.id]:[])},entry:{ownerId:actor.id}},select:{webNotificationId:true}}):[];
    const confirmed=new Set(facts.map(fact=>fact.webNotificationId));
    items=items.filter(item=>item.type!=='plan.reminder'||!!item.id&&confirmed.has(item.id));
  }
  actor = await resolveVisibilityActor(db, actor);
  if (hasFullProjectVisibility(actor)) return items;
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
    if(item.type==="plan.reminder")return item;
    if(FINANCIAL_ORG_NOTIFICATION_TYPES.includes(item.type))return{...item,link:await canReadLink(item.link)?item.link:'/finance'};
    if (item.type.startsWith("payroll.") || item.type === "user.accountChanged" || await canReadLink(item.link)) return item;
    return { ...item, title: "Список доступных задач обновлён", body: null, link: "/my" };
  }));
}
