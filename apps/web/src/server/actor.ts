import { hasAnyRole, type Role } from "@/lib/roles";

/** Автор доменной операции; транспорт разрешает текущего пользователя до вызова ядра. */
export interface DomainActor {
  id: string;
  name: string;
  roles: Role[];
  source: "web" | "telegram" | "api";
}

export function requireActorRoles(actor: DomainActor, allowed: Role[]): void {
  if (!hasAnyRole(actor.roles, allowed)) throw new Error("Недостаточно прав");
}
