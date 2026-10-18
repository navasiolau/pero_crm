import type { KpApiScope } from "@/lib/kp-api-scopes";
import { apiFailure, type KpApiContext } from "./api-contract";
import type { Prisma } from "@prisma/client";

/** Kind берётся из сохранённой строки БД; query/body его не задают. */
export async function authorizeKpResource(context: KpApiContext, kind: string, tx?: Prisma.TransactionClient) {
  const scope: KpApiScope = kind === "PDF" ? "kp:read" : kind === "DOCX" || kind === "CONTRACT" ? "kp:contracts:read"
    : apiFailure("KP_NOT_FOUND", 404, "Документ или задание недоступны");
  await context.authorize(scope, tx); return scope;
}
export function apiOperationScope(kind: string): KpApiScope {
  if (["document.create", "document.save", "version.restore", "client.create"].includes(kind)) return "kp:write";
  if (kind === "upload") return "kp:media:write";
  if (kind === "pdf") return "kp:export";
  if (kind === "contract.save") return "kp:contracts:write";
  if (kind === "contract.generate") return "kp:contracts:generate";
  return apiFailure("KP_OPERATION_INVALID", 409, "Не распознан результат операции");
}
