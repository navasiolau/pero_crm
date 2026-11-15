import { Prisma } from "@prisma/client";
import type { JournalEntryInput, JournalPresentationHints } from "./contract";
import { buildJournalPresentation, buildJournalSearchText } from "./presentation";

const rawJson = (value: unknown) => value === undefined ? undefined
  : value === null || value === Prisma.JsonNull ? Prisma.JsonNull
    : value === Prisma.DbNull ? Prisma.DbNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Обязательная запись в транзакции вызывающего сценария; ошибок и повторов здесь не поглощаем. */
export async function writeChangeLogInTransaction(
  tx: Pick<Prisma.TransactionClient, "changeLog">,
  entry: JournalEntryInput,
  hints: JournalPresentationHints = {},
) {
  const createdAt = entry.createdAt ?? new Date();
  const source = entry.source ?? "web";
  const normalized = { ...entry, createdAt, source,
    oldValue: entry.oldValue === Prisma.DbNull || entry.oldValue === Prisma.JsonNull ? null : entry.oldValue,
    newValue: entry.newValue === Prisma.DbNull || entry.newValue === Prisma.JsonNull ? null : entry.newValue };
  // При новой записи явный JSON null известен; чтение старого SQL NULL остаётся неизвестным.
  const presentation = buildJournalPresentation(normalized, {
    ...(entry.oldValue !== undefined ? { beforeKnown: entry.oldValue !== Prisma.DbNull } : {}),
    ...(entry.newValue !== undefined ? { afterKnown: entry.newValue !== Prisma.DbNull } : {}), ...hints,
  });
  return tx.changeLog.create({ data: {
    ...(entry.id === undefined ? {} : { id: entry.id }), actorType: entry.actorType, actorId: entry.actorId, actorName: entry.actorName,
    entity: entry.entity, entityId: entry.entityId, action: entry.action, field: entry.field,
    oldValue: rawJson(entry.oldValue), newValue: rawJson(entry.newValue), source, createdAt,
    presentation: JSON.parse(JSON.stringify(presentation)) as Prisma.InputJsonValue,
    searchText: buildJournalSearchText(normalized, presentation),
  } });
}
