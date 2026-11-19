import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/require-role";
import {Prisma} from '@prisma/client';
import {normalizeJournalQuery,normalizeJournalScope,type JournalQueryInput} from './query-contract';
import type {JournalScope} from './contract';
import {createJournalReadStore} from './sql-store';
import {readJournalPage,readJournalDetail,readJournalOptions} from './reader-core';

/** Count, legacy fallback и indexed rows видят один snapshot даже во время backfill. */
async function snapshot<T>(read:(db:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
 return prisma.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;return read(tx);},
  {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10_000,timeout:60_000});
}

export async function queryJournal(input:JournalQueryInput={}){
 await requireAdmin();const query=normalizeJournalQuery(input);
 return snapshot(db=>readJournalPage(createJournalReadStore(db),query));
}
export async function queryJournalEntry(id:string,scope:JournalScope={kind:'global'}){
 await requireAdmin();const normalized=normalizeJournalScope(scope);
 return snapshot(async db => {
  const detail = await readJournalDetail(createJournalReadStore(db), id, normalized);
  const command = await db.changeLog.findUnique({ where: { id }, select: {
    reversal: true, operationRoot: { select: { reversal: true } },
  }});
  return { ...detail, reversalAvailable: Boolean(command?.reversal ?? command?.operationRoot?.reversal) };
 });
}
export async function queryJournalFilterOptions(scope:JournalScope={kind:'global'}){
 await requireAdmin();const normalized=normalizeJournalScope(scope);
 return snapshot(db=>readJournalOptions(createJournalReadStore(db),normalized));
}

export type GlobalChangeLogFilters = { actor?: string; entity?: string; from?: string; to?: string };

/** Global audit reader, separate from entity/finance history and audit writers. */
export async function listGlobalChangeLog({ actor, entity, from, to }: GlobalChangeLogFilters) {
  await requireAdmin();
  const where = {
    // Durable receipt хранится в БД; интерфейс показывает один прежний business audit.
    NOT: { OR: [
      { entity: "task", action: "task.status.request", id: { startsWith: "task-status:" } },
      { entity: "task", action: "task.create.request", id: { startsWith: "task-create:" } },
      { entity: "product", action: "inline.receipt", id: { startsWith: "product-inline:" } },
    ] },
    ...(actor ? { OR: [
      { actorName: { contains: actor, mode: "insensitive" as const } },
      { actorId: { contains: actor, mode: "insensitive" as const } },
    ] } : {}),
    ...(entity ? { entity: { contains: entity, mode: "insensitive" as const } } : {}),
    ...(from || to ? { createdAt: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
    } } : {}),
  };
  return prisma.changeLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
}
