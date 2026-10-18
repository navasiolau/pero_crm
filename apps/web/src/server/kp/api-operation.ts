import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { KpApiScope } from "@/lib/kp-api-scopes";
import { apiFailure, type KpApiContext } from "./api-contract";
import { apiOperationScope } from "./api-resource-policy";

type ReceiptDb = Pick<PrismaClient, "changeLog" | "commercialProposal" | "client">;
export type ApiOperation = { operationId: string; kind: string; result: unknown };
export const kpJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export function stableApiJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableApiJson).join(",")}]`;
  return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${stableApiJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export const apiDigest = (value: unknown) => createHash("sha256").update(stableApiJson(value)).digest("hex");
export function apiReceiptId(context: KpApiContext, operationId: string) {
  return `kp.api:${apiDigest({ actorId: context.binding.id, source: context.binding.source, tokenId: context.binding.tokenId ?? null, operationId })}`;
}
export async function readApiReceipt(db: ReceiptDb, context: KpApiContext, operationId: string, fingerprint?: string, transaction?: Prisma.TransactionClient): Promise<ApiOperation | null> {
  const row = await db.changeLog.findUnique({ where: { id: apiReceiptId(context, operationId) } });
  if (!row) return null;
  const value = row.newValue;
  if (row.actorType !== "user" || row.entity !== "commercialProposal" || row.actorId !== context.binding.id || row.action !== "kp.api.command" || !value || typeof value !== "object" || Array.isArray(value) ||
    value.tokenId !== (context.binding.tokenId ?? null) || value.source !== context.binding.source || value.operationId !== operationId ||
    typeof value.scope !== "string" || typeof value.kind !== "string" || !("result" in value) || fingerprint !== undefined && value.fingerprint !== fingerprint)
    return apiFailure("KP_OPERATION_REUSED", 409, "UUID операции уже использован другим запросом");
  const requiredScope = apiOperationScope(value.kind);
  if (value.scope !== requiredScope) return apiFailure("KP_OPERATION_INVALID", 409, "Не совпало право сохранённой операции");
  await context.authorize(requiredScope, transaction);
  if (value.kind === "client.create") {
    if (!await db.client.findUnique({ where: { id: row.entityId }, select: { id: true } })) return apiFailure("KP_NOT_FOUND", 404, "Клиент операции недоступен");
  } else if (!value.kind.startsWith("contract.")) {
    const proposal = await db.commercialProposal.findFirst({ where: { id: row.entityId, deletedAt: null,
      OR: [{ projectId: null }, { project: { deletedAt: null } }] }, select: { id: true } });
    if (!proposal) return apiFailure("KP_NOT_FOUND", 404, "КП операции недоступно");
  }
  return { operationId, kind: value.kind, result: value.result };
}
export async function writeApiReceipt(tx: Prisma.TransactionClient, context: KpApiContext,
  command: { operationId: string; kind: string; scope: KpApiScope; fingerprint: string; entityId: string }, result: unknown) {
  await tx.changeLog.create({ data: { id: apiReceiptId(context, command.operationId), actorType: "user", actorId: context.actor.id,
    actorName: context.actor.name, source: context.binding.source, entity: "commercialProposal", entityId: command.entityId,
    action: "kp.api.command", newValue: kpJson({ ...command, tokenId: context.binding.tokenId ?? null, source: context.binding.source, result }) } });
}
/** Реплей проверяется до сети и ещё раз в final tx; результат хранится неизменяемым. */
export async function runApiCommand<T>(dependencies: {
  transaction: <R>(run: (tx: Prisma.TransactionClient) => Promise<R>) => Promise<R>;
  context: KpApiContext; scope: KpApiScope; kind: string; operationId: string; input: unknown;
  prepare?: () => Promise<T>;
  mutate: (tx: Prisma.TransactionClient, prepared: T | undefined) => Promise<{ result: unknown; entityId: string; afterCommit?: () => Promise<void> }>;
}): Promise<unknown> {
  const { context, scope, operationId, kind } = dependencies, fingerprint = apiDigest({ kind, input: dependencies.input });
  const read = () => dependencies.transaction(async tx => { await context.authorize(scope, tx); return readApiReceipt(tx, context, operationId, fingerprint, tx); });
  const replay = await read(); if (replay) return replay.result;
  let prepared: T | undefined;
  try { prepared = await dependencies.prepare?.(); }
  catch (error) { const committed = await read(); if (committed) return committed.result; throw error; }
  const saved = await dependencies.transaction(async tx => {
    context.actor = await context.authorize(scope, tx);
    const repeated = await readApiReceipt(tx, context, operationId, fingerprint, tx); if (repeated) return { result: repeated.result };
    const mutation = await dependencies.mutate(tx, prepared);
    await writeApiReceipt(tx, context, { operationId, kind, scope, fingerprint, entityId: mutation.entityId }, mutation.result);
    return mutation;
  });
  if ("afterCommit" in saved) await saved.afterCommit?.().catch(() => undefined);
  return saved.result;
}
