import { Prisma } from "@prisma/client";
import type { NextAuthConfig } from "next-auth";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";

type Store = Pick<Prisma.TransactionClient, "changeLog">;
type AuthAction = "login" | "logout";
export interface AuthenticationJournalEvent { action: AuthAction; operationId: string; userId: string; name: string }
export interface AuthenticationAuditDiagnostic { code: "AUTH_AUDIT_WRITE_FAILED" | "AUTH_AUDIT_ID_MISSING"; action: AuthAction; operationId?: string }
const validOperationId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const confirmedSignIns = new WeakSet<object>();

/** Только наблюдение результата прежнего JWT callback: не меняет токен и не сохраняет данные сессии. */
export function markJournalSignIn(user: object, confirmed: boolean): void {
  if (confirmed) confirmedSignIns.add(user); else confirmedSignIns.delete(user);
}

/** Cookie и БД не имеют общей транзакции; событие имеет собственный устойчивый ключ. */
export async function recordAuthenticationEvent(db: Store, event: AuthenticationJournalEvent): Promise<boolean> {
  if (!validOperationId(event.operationId)) throw new Error("AUTH_AUDIT_ID_INVALID");
  const id = `auth-${event.action}:${event.operationId}`;
  const repeated = async () => {
    const existing = await db.changeLog.findUnique({ where: { id }, select: { actorId: true, actorType: true, entity: true, entityId: true, action: true } });
    if (!existing) return false;
    if (existing.actorId !== event.userId || existing.actorType !== "user" || existing.entity !== "user" || existing.entityId !== event.userId || existing.action !== event.action)
      throw new Error("AUTH_AUDIT_ID_CONFLICT");
    return true;
  };
  if (await repeated()) return false;
  try {
    await writeChangeLogInTransaction(db, { id, actorType: "user", actorId: event.userId, actorName: event.name,
      source: "web", entity: "user", entityId: event.userId, action: event.action }, {
      entity: { label: `Пользователь ${event.name}`, href: "/settings/users" }, changes: [],
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && await repeated()) return false;
    throw error;
  }
}

type AuthEvents = NonNullable<NextAuthConfig["events"]>;
export function createJournalAuthEvents(db: Store, report: (diagnostic: AuthenticationAuditDiagnostic) => void = diagnostic => {
  console.error("[journal] Ошибка записи события аутентификации", diagnostic);
}) {
  const record = async (action: AuthAction, operationId: unknown, userId: unknown, name: unknown) => {
    if (typeof userId !== "string" || !userId) return;
    if (!validOperationId(operationId)) { report({ code: "AUTH_AUDIT_ID_MISSING", action }); return; }
    try { await recordAuthenticationEvent(db, { action, operationId, userId, name: typeof name === "string" && name ? name : "Имя не сохранено" }); }
    catch { report({ code: "AUTH_AUDIT_WRITE_FAILED", action, operationId }); }
  };
  return {
    async signIn({ user }: Parameters<NonNullable<AuthEvents["signIn"]>>[0]) {
      // Auth.js вызывает signIn event также после JWT=null: такой вход не был подтверждён.
      if (!confirmedSignIns.has(user)) return;
      confirmedSignIns.delete(user);
      await record("login", "auditLoginId" in user ? user.auditLoginId : undefined, user.id, user.name);
    },
    async signOut(message: Parameters<NonNullable<AuthEvents["signOut"]>>[0]) {
      // В проекте JWT strategy; не журналируем отсутствие/некорректность cookie как успешный вход пользователя.
      if ("token" in message && message.token) await record("logout", message.token.jti, message.token.id, message.token.name);
    },
  } satisfies Pick<AuthEvents, "signIn" | "signOut">;
}
