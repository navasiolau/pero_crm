import type { Prisma } from "@prisma/client";
import { COUNTERPARTY_ROLES, hasAnyRole } from "@/lib/roles";
import type { DomainActor } from "@/server/actor";
import { officeCommand, officeCreated, officePatch } from "@/server/changelog/office-directory-reversal";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { counterpartySchema, counterpartyUpdateSchema, counterpartySelect, type CounterpartyInput, type CounterpartyResult, type CounterpartyView } from "./contracts";

const journalSelect = { ...counterpartySelect, officeFieldHeads: true } as const;
type JournalCounterparty = CounterpartyView & { officeFieldHeads?: Prisma.JsonValue };
const fields = ["type", "company", "phone", "comment"] as const;
const forbidden = (): CounterpartyResult => ({ ok: false, kind: "forbidden", error: "Недостаточно прав" });
const conflict = (): CounterpartyResult => ({ ok: false, kind: "conflict", error: "Контрагент изменён другим пользователем — обновите карточку" });
function normalized(input: CounterpartyInput) {
  return { type: input.type, company: input.company, phone: input.phone?.trim() || null, comment: input.comment?.trim() || null };
}
function snapshot(item: CounterpartyView) {
  return { type: item.type, company: item.company, phone: item.phone, comment: item.comment };
}
function publicItem(item: CounterpartyView): CounterpartyView {
  return { id: item.id, revision: item.revision, ...snapshot(item) };
}

async function audit(tx: Prisma.TransactionClient, actor: DomainActor, item: JournalCounterparty, previous?: JournalCounterparty) {
  await writeChangeLogInTransaction(tx, { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "counterparty", entityId: item.id, action: previous ? "update" : "create",
    reversal: previous ? officeCommand(item.id, [officePatch("counterparty", item.id, previous, item, fields)]) : officeCreated("counterparty", item.id, item),
    oldValue: previous ? snapshot(previous) : {}, newValue: snapshot(item) }, {
    before: previous ? snapshot(previous) : null, after: snapshot(item), entity: { label: `Контрагент ${item.company}`, href: "/counterparties" },
  });
}

export async function createCounterpartyInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, input: unknown): Promise<CounterpartyResult> {
  if (!hasAnyRole(actor.roles, COUNTERPARTY_ROLES)) return forbidden();
  const parsed = counterpartySchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", error: parsed.error.issues[0]?.message ?? "Проверьте данные контрагента" };
  const item = await tx.counterparty.create({ data: normalized(parsed.data), select: journalSelect });
  await audit(tx, actor, item);
  return { ok: true, item: publicItem(item) };
}

export async function updateCounterpartyInTransaction(tx: Prisma.TransactionClient, actor: DomainActor, id: string, input: unknown, expectedRevision: number): Promise<CounterpartyResult> {
  if (!hasAnyRole(actor.roles, COUNTERPARTY_ROLES)) return forbidden();
  const parsed = counterpartyUpdateSchema.safeParse({ id, input, expectedRevision });
  if (!parsed.success) return { ok: false, kind: "validation", error: parsed.error.issues[0]?.message ?? "Проверьте данные контрагента" };
  const current = await tx.counterparty.findUnique({ where: { id: parsed.data.id, deletedAt: null }, select: journalSelect });
  if (!current) return { ok: false, kind: "not-found", error: "Контрагент не найден" };
  if (current.revision !== parsed.data.expectedRevision) return conflict();
  const desired = normalized(parsed.data.input);
  if (fields.every(field => current[field] === desired[field])) return { ok: true, item: publicItem(current), noOp: true };
  const saved = await tx.counterparty.updateMany({ where: { id: current.id, deletedAt: null, revision: parsed.data.expectedRevision },
    data: { ...desired, revision: { increment: 1 } } });
  if (saved.count !== 1) return conflict();
  const item = await tx.counterparty.findUniqueOrThrow({ where: { id: current.id }, select: journalSelect });
  await audit(tx, actor, item, current);
  return { ok: true, item: publicItem(item) };
}
