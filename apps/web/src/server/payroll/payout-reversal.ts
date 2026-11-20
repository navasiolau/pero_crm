import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Payout } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { payoutJournalSnapshot } from "@/server/finance/journal";
import { historicalByn } from "@/lib/history-byn";
import { assertPayoutRole, readCashBalance, readOrgBalance, readPayoutDebt, type PayoutActor } from "./cash-core";

const selection = { user: { select: { name: true, active: true } },
  cashAccount: { select: { name: true, currency: true, active: true } } } satisfies Prisma.PayoutInclude;
type StoredPayout = Prisma.PayoutGetPayload<{ include: typeof selection }>;

const schema = z.object({
  visible: z.boolean(),
  batchId: z.string().nullable(),
  rows: z.array(z.object({ id: z.string(), fingerprint: z.string().length(64),
    expectedHead: z.string().nullable(), priorHead: z.string().nullable() }).strict()).min(1),
}).strict();
type Command = z.output<typeof schema>;
const paths = ["/payroll", "/finance/payroll", "/finance/accounts", "/finance/accounts/report", "/finance/advances", "/advances"];

function fingerprint(row: Payout) {
  return createHash("sha256").update(JSON.stringify({ ...payoutJournalSnapshot(row), createdAt: row.createdAt, createdById: row.createdById, batchId: row.batchId })).digest("hex");
}

export function payoutVisibilityCommand(rows: readonly Payout[], visible: boolean, nextHead?: string, batchId: string | null = null) {
  return payoutVisibilityReversal.command({ visible, batchId, rows: rows.map(row => ({
    id: row.id, fingerprint: fingerprint(row), expectedHead: nextHead ?? row.lastActionId, priorHead: nextHead ? row.lastActionId : null,
  })) });
}

function add(target: Map<string, Prisma.Decimal>, key: string, delta: Prisma.Decimal) {
  target.set(key, (target.get(key) ?? new Prisma.Decimal(0)).plus(delta));
}

async function loadPayoutChanges(tx: Prisma.TransactionClient, actor: PayoutActor, command: Command, entityId: string) {
  const rows = await tx.payout.findMany({ where: command.batchId ? { batchId: command.batchId }
    : { id: { in: command.rows.map(row => row.id) } }, include: selection });
  if ((command.batchId ?? command.rows[0].id) !== entityId || (!command.batchId && command.rows.length !== 1) ||
      rows.length !== command.rows.length) {
    throw new JournalReversalRefusal("Состав выплат изменился");
  }
  const entries = new Map(command.rows.map(row => [row.id, row]));
  for (const row of rows) {
    const entry = entries.get(row.id);
    if (!entry || fingerprint(row) !== entry.fingerprint || row.lastActionId !== entry.expectedHead ||
      Boolean(row.deletedAt) !== command.visible) {
      throw new JournalReversalRefusal("Выплата уже изменена. Проверьте связанные операции в Журнале.");
    }
    assertPayoutRole(actor, row.kind);
  }
  if (command.visible) {
    const accountTotals = new Map<string, Prisma.Decimal>(), salaryTotals = new Map<string, Prisma.Decimal>();
    let orgTotal = new Prisma.Decimal(0);
    for (const row of rows) {
      const byn = historicalByn(row);
      if (!byn?.isFinite() || byn.lt(0)) throw new JournalReversalRefusal("Историческая сумма выплаты в BYN недоступна");
      if (row.cashAccountId) {
        if (!row.cashAccount?.active || row.cashAccount.currency !== row.cashCurrency || !row.cashAmount?.gt(0)) {
          throw new JournalReversalRefusal("Историческая касса или сумма выплаты недоступна");
        }
        add(accountTotals, row.cashAccountId, row.cashAmount);
      }
      if (row.kind === "ADVANCE" && !row.user.active) throw new JournalReversalRefusal("Сотрудник больше не активен");
      if (row.kind === "SALARY" && byn.gt(0)) add(salaryTotals, row.userId, byn);
      orgTotal = orgTotal.plus(byn);
    }
    for (const [id, amount] of accountTotals) {
      if ((await readCashBalance(tx, id)).lt(amount)) throw new JournalReversalRefusal("Недостаточно средств в выбранной кассе");
    }
    if ((await readOrgBalance(tx, "1", "0", orgTotal.toFixed(2))).lt(0)) {
      throw new JournalReversalRefusal("Недостаточно средств на балансе организации");
    }
    for (const [id, amount] of salaryTotals) {
      if ((await readPayoutDebt(tx, id)).lt(amount)) throw new JournalReversalRefusal("Выплата превышает текущий долг за прошлые месяцы");
    }
  }
  return rows;
}

function hints(row: StoredPayout, visible: boolean) {
  const value = payoutJournalSnapshot(row, { user: row.user.name, cashAccount: row.cashAccount?.name });
  return { entity: { label: `${row.kind === "ADVANCE" ? "Аванс" : "Выплата зарплаты"}: ${row.user.name}` }, contexts: [],
    links: [{ type: "user", id: row.userId, label: row.user.name },
      ...(row.cashAccountId && row.cashAccount ? [{ type: "cashAccount", id: row.cashAccountId, label: row.cashAccount.name }] : [])],
    before: visible ? null : value, after: visible ? value : null };
}

async function setVisibility(tx: Prisma.TransactionClient, row: Payout, actorId: string, visible: boolean, nextHead: string | null) {
  const updated = await tx.payout.updateMany({ where: { id: row.id, kind: row.kind, deletedAt: row.deletedAt, lastActionId: row.lastActionId },
    data: { deletedAt: visible ? null : new Date(), deletedById: visible ? null : actorId, lastActionId: nextHead } });
  if (updated.count !== 1) throw new JournalReversalRefusal("Выплата уже изменена");
}

export async function deletePayoutInTransaction(tx: Prisma.TransactionClient, actor: PayoutActor, id: string) {
  const target = await tx.payout.findUnique({ where: { id, deletedAt: null }, select: { kind: true } });
  if (!target) throw Error("Выплата не найдена");
  assertPayoutRole(actor, target.kind);
  const payout = await tx.payout.findUnique({ where: { id, deletedAt: null, kind: target.kind }, include: selection });
  if (!payout) throw Error("Выплата не найдена");
  const actionId = randomUUID();
  const reversal = payoutVisibilityCommand([payout], true, actionId);
  await setVisibility(tx, payout, actor.id, false, actionId);
  await writeChangeLogInTransaction(tx, { id: actionId, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
    entity: "payout", entityId: id, action: "delete", reversal, oldValue: { user: payout.user.name, amount: payout.amount.toFixed(2),
      cashAmount: payout.cashAmount?.toFixed(2) ?? null, cashCurrency: payout.cashCurrency, month: payout.month },
  }, hints(payout, false));
}

export const payoutVisibilityReversal = defineJournalReversal({
  kind: "payout.visibility", version: 1, schema,
  async preview({ tx, actor, entityId }, command) {
    await loadPayoutChanges(tx, actor, command, entityId);
    return null;
  },
  async apply({ tx, actor, entityId }, command) {
    const rows = await loadPayoutChanges(tx, actor, command, entityId);
    const nextHeads = new Map(command.rows.map(row => [row.id, row.priorHead]));
    for (const row of rows) await setVisibility(tx, row, actor.id, command.visible, nextHeads.get(row.id) ?? null);
    const values = rows.map(row => ({ id: row.id, amount: row.amount.toFixed(2), user: row.user.name, kind: row.kind }));
    return { inverse: { ...command, visible: !command.visible,
      rows: command.rows.map(row => ({ ...row, expectedHead: row.priorHead, priorHead: row.expectedHead })) },
      oldValue: command.visible ? null : { payouts: values }, newValue: command.visible ? { payouts: values } : null,
      ...(command.batchId ? {} : { hints: hints(rows[0], command.visible) }), cachePaths: paths };
  },
});
