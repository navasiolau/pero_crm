import { z } from "zod";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { COUNTERPARTY_ROLES, FINANCE_ROLES, MANAGER_ROLES, canManagePrices, hasAnyRole } from "@/lib/roles";
import { DEFAULT_CASH_ACCOUNT_MANAGE_ROLES } from "@/lib/cash-account-default";
import type { DomainActor } from "@/server/actor";
import { DEFAULT_CASH_ACCOUNT_KEY, EMPTY_DEFAULT_CASH_ACCOUNT, defaultCashAccountSnapshotSchema } from "@/server/finance/default-cash-contracts";
import { defineJournalReversal, JournalReversalRefusal } from "./reversal-contract";

const fields = {
  client: ["name", "lastName", "middleName", "phone", "email", "address", "comment", "passportNumber", "passportIssuedBy", "isContactPerson", "deletedAt"],
  counterparty: ["type", "company", "phone", "comment", "deletedAt"],
  priceItem: ["name", "unit", "price", "category", "active"],
  cashAccount: ["name", "currency", "comment", "active"],
  expenseArticle: ["code", "name", "comment", "active"],
  projectContact: ["clientId", "contactPerson"],
  defaultCash: ["value"],
} as const;
type Kind = keyof typeof fields;
const kindSchema = z.enum(["client", "counterparty", "priceItem", "cashAccount", "expenseArticle", "projectContact", "defaultCash"]);
const scalar = z.union([z.string(), z.boolean(), z.number().int(), z.null()]);
const fieldState = z.object({ value: scalar, head: z.string().regex(/^(?:\d+|[ad]:[0-9a-f-]+)$/) }).strict();
const stepSchema = z.object({ kind: kindSchema, id: z.string().min(1),
  archiveCreated: z.boolean(), fields: z.array(z.object({ key: z.string(), from: fieldState, to: fieldState }).strict()).min(1),
}).strict();
const schema = z.object({ targetId: z.string().min(1), steps: z.array(stepSchema).min(1) }).strict();
type Command = z.output<typeof schema>;
type Step = z.output<typeof stepSchema>;
type Scalar = z.output<typeof scalar>;
type Tx = Prisma.TransactionClient;
type Snapshot = Readonly<{ officeFieldHeads?: Prisma.JsonValue }> & object;

function heads(row: Snapshot): Record<string, string> {
  const data = row.officeFieldHeads;
  return data && typeof data === "object" && !Array.isArray(data)
    ? Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
}

function valueOf(row: Snapshot, key: string): Scalar {
  const value = (row as Record<string, unknown>)[key];
  if (key === "deletedAt") return Boolean(value);
  if (value && typeof value === "object") return String(value);
  return scalar.parse(value === undefined ? null : value);
}

export function officePatch<Before extends Snapshot, After extends Snapshot>(kind: Kind, id: string, before: Before, after: After, keys: readonly string[], alsoGuard: readonly string[] = []): Step | undefined {
  if (after.officeFieldHeads === undefined) return undefined; // Старые снимки без данных о происхождении не обратимы.
  const delta = keys.map(key => ({ key,
    from: { value: valueOf(after, key), head: heads(after)[key] ?? "0" },
    to: { value: valueOf(before, key), head: heads(before)[key] ?? "0" },
  }));
  return delta.some(row => row.from.value !== row.to.value)
    ? { kind, id, archiveCreated: false, fields: delta.filter(row => row.from.value !== row.to.value || alsoGuard.includes(row.key)) } : undefined;
}

export function officeCreated(kind: Exclude<Kind, "projectContact" | "defaultCash">, id: string, after: Snapshot) {
  if (after.officeFieldHeads === undefined) return undefined;
  const key = kind === "client" || kind === "counterparty" ? "deletedAt" : "active";
  const step = officePatch(kind, id, { ...after, [key]: key === "deletedAt" ? true : false }, after, fields[kind], fields[kind]);
  return step ? officeCommand(id, [{ ...step, archiveCreated: true, fields: step.fields.map(field =>
    field.key === key ? { ...field, to: { ...field.to, head: `a:${randomUUID()}` } } : field) }]) : undefined;
}

export function officeCommand(targetId: string, steps: (Step | undefined)[]) {
  const defined = steps.filter((step): step is Step => Boolean(step));
  return defined.length ? officeDirectoryReversal.command({ targetId, steps: defined }) : undefined;
}

function permitted(actor: DomainActor, kind: Kind) {
  if (kind === "priceItem") return canManagePrices(actor.roles);
  if (kind === "counterparty") return hasAnyRole(actor.roles, COUNTERPARTY_ROLES);
  if (kind === "client" || kind === "projectContact") return hasAnyRole(actor.roles, MANAGER_ROLES);
  if (kind === "defaultCash") return hasAnyRole(actor.roles, DEFAULT_CASH_ACCOUNT_MANAGE_ROLES);
  return hasAnyRole(actor.roles, FINANCE_ROLES);
}

function storedDefault(row: { value: string; officeFieldHeads?: Prisma.JsonValue } | null) {
  if (!row) return { revision: EMPTY_DEFAULT_CASH_ACCOUNT.revision, value: null, officeFieldHeads: {} };
  const setting = defaultCashAccountSnapshotSchema.parse(JSON.parse(row.value));
  return { revision: setting.revision, value: setting.accountId, officeFieldHeads: row.officeFieldHeads };
}

export function officeDefaultSnapshot(accountId: string | null, officeFieldHeads: Prisma.JsonValue | undefined) {
  return { officeFieldHeads, value: accountId };
}

function read(tx: Tx, kind: Kind, id: string) {
  switch (kind) {
    case "client": return tx.client.findUnique({ where: { id } });
    case "counterparty": return tx.counterparty.findUnique({ where: { id } });
    case "priceItem": return tx.priceItem.findUnique({ where: { id } });
    case "cashAccount": return tx.cashAccount.findUnique({ where: { id } });
    case "expenseArticle": return tx.expenseArticle.findUnique({ where: { id } });
    case "projectContact": return tx.project.findUnique({ where: { id, deletedAt: null }, select: { officeFieldHeads: true, clientId: true, contactPerson: true } });
    case "defaultCash": return tx.orgSetting.findUnique({ where: { key: DEFAULT_CASH_ACCOUNT_KEY } }).then(storedDefault);
  }
}

async function checkCreatedUse(tx: Tx, step: Step) {
  const undo = step.fields.some(field => (field.key === "active" && field.to.value === false) ||
    (field.key === "deletedAt" && field.to.value === true));
  if (!step.archiveCreated || !undo) return;
  const id = step.id;
  let blocked = false;
  switch (step.kind) {
    case "client":
      blocked = Boolean(await tx.project.count({ where: { clientId: id } }) ||
        await tx.commercialProposal.count({ where: { clientId: id } }) || await tx.communication.count({ where: { clientId: id } }));
      break;
    case "priceItem": blocked = Boolean(await tx.work.count({ where: { priceItemId: id } })); break;
    case "cashAccount":
      blocked = Boolean((await read(tx, "defaultCash", DEFAULT_CASH_ACCOUNT_KEY) as ReturnType<typeof storedDefault>).value === id ||
        await tx.payment.count({ where: { cashAccountId: id } }) || await tx.payout.count({ where: { cashAccountId: id } }) ||
        await tx.logisticsPosting.count({ where: { cashAccountId: id } }));
      break;
    case "expenseArticle":
      blocked = Boolean(await tx.payment.count({ where: { expenseArticleId: id } }) ||
        await tx.logisticsPosting.count({ where: { expenseArticleId: id } }));
      break;
  }
  if (blocked) throw new JournalReversalRefusal("У записи появились связанные операции. Отмена создания недоступна.");
}

function mutable(step: Step, key: string) {
  if (step.kind === "cashAccount" || step.kind === "expenseArticle") return key === "active";
  if (step.kind === "projectContact") return key === "contactPerson";
  return true;
}

async function prepare(tx: Tx, actor: DomainActor, entityId: string, command: Command) {
  if (command.targetId !== entityId || command.steps[0].id !== entityId) throw new JournalReversalRefusal("Запись не соответствует операции");
  const cashToggle = command.steps.find(step => step.kind === "cashAccount")?.fields.find(field => field.key === "active");
  const defaultStep = command.steps.find(step => step.kind === "defaultCash");
  const rows = [];
  for (const step of command.steps) {
    if ((!permitted(actor, step.kind) && !(step.kind === "defaultCash" && cashToggle && hasAnyRole(actor.roles, FINANCE_ROLES))) ||
        (step.kind === "defaultCash" && step.id !== DEFAULT_CASH_ACCOUNT_KEY) ||
        step.fields.some(field => !(fields[step.kind] as readonly string[]).includes(field.key) ||
          (field.from.value !== field.to.value && !mutable(step, field.key)))) {
      throw new JournalReversalRefusal("Нет прав на связанное действие справочника");
    }
    const row = await read(tx, step.kind, step.id);
    if (!row || step.fields.some(field =>
      valueOf(row, field.key) !== field.from.value || (heads(row)[field.key] ?? "0") !== field.from.head)) {
      throw new JournalReversalRefusal("Поле уже изменено. Проверьте последующие записи Журнала.");
    }
    if (!step.archiveCreated && (step.kind === "client" || step.kind === "counterparty") && valueOf(row, "deletedAt")) {
      throw new JournalReversalRefusal("Запись находится в архиве");
    }
    await checkCreatedUse(tx, step);
    if (step.kind === "defaultCash") {
      const desired = step.fields.find(field => field.key === "value")!.to.value;
      const willActivate = cashToggle?.to.value === true && command.steps[0].id === desired;
      if (typeof desired === "string" && !willActivate &&
          !(await tx.cashAccount.findUnique({ where: { id: desired }, select: { active: true } }))?.active) {
        throw new JournalReversalRefusal("Касса для восстановления назначения не активна");
      }
    }
    if (step.kind === "cashAccount" && cashToggle?.to.value === false && !defaultStep &&
        (await read(tx, "defaultCash", DEFAULT_CASH_ACCOUNT_KEY) as ReturnType<typeof storedDefault>).value === step.id) {
      throw new JournalReversalRefusal("Касса уже назначена по умолчанию. Сначала измените назначение.");
    }
    rows.push({ step, row });
  }
  return rows;
}

async function applyStep(tx: Tx, step: Step, row: Snapshot) {
  const patch = step.fields.filter(field => field.from.value !== field.to.value);
  const officeFieldHeads = { ...heads(row), ...Object.fromEntries(patch.map(field => [field.key, field.to.head])) };
  const data = Object.fromEntries(patch.map(field => [field.key,
    field.key === "deletedAt" ? field.to.value ? new Date() : null : field.to.value]));
  const where = { id: step.id };
  switch (step.kind) {
    case "client": await tx.client.update({ where, data: { ...data, officeFieldHeads } }); break;
    case "counterparty": await tx.counterparty.update({ where, data: { ...data, officeFieldHeads, revision: { increment: 1 } } }); break;
    case "priceItem": await tx.priceItem.update({ where, data: { ...data, officeFieldHeads } }); break;
    case "cashAccount": await tx.cashAccount.update({ where, data: { ...data, officeFieldHeads } }); break;
    case "expenseArticle": await tx.expenseArticle.update({ where, data: { ...data, officeFieldHeads } }); break;
    case "projectContact": await tx.project.update({ where, data: { ...data, officeFieldHeads } }); break;
    case "defaultCash": {
      const revision = (row as ReturnType<typeof storedDefault>).revision + 1;
      const value = JSON.stringify({ revision, accountId: data.value ?? null });
      await tx.orgSetting.upsert({ where: { key: DEFAULT_CASH_ACCOUNT_KEY },
        create: { key: DEFAULT_CASH_ACCOUNT_KEY, value, officeFieldHeads }, update: { value, officeFieldHeads } });
      break;
    }
  }
}

const lockTables: Record<Kind, string> = {
  client: '"Client"', counterparty: '"Counterparty"', priceItem: '"PriceItem"', cashAccount: '"CashAccount"',
  expenseArticle: '"ExpenseArticle"', projectContact: '"Project"', defaultCash: '"OrgSetting"',
};

async function lockSteps(tx: Tx, command: Command) {
  const ordered = [...command.steps].sort((a, b) => lockTables[a.kind].localeCompare(lockTables[b.kind]) || a.id.localeCompare(b.id));
  for (const step of ordered) {
    const pk = step.kind === "defaultCash" ? Prisma.sql`key` : Prisma.sql`id`;
    await tx.$queryRaw(Prisma.sql`SELECT ${pk} FROM ${Prisma.raw(lockTables[step.kind])} WHERE ${pk} = ${step.id} FOR UPDATE`);
  }
}

export const officeDirectoryReversal = defineJournalReversal({
  kind: "office.directory", version: 1, schema,
  async preview({ tx, actor, entityId }, command) {
    await prepare(tx, actor, entityId, command);
    return null;
  },
  async apply({ tx, actor, entityId }, command) {
    await lockSteps(tx, command);
    const rows = await prepare(tx, actor, entityId, command);
    const eventIds: string[] = [];
    const cachePaths = new Set<string>(["/clients", "/counterparties", "/prices", "/projects", "/products",
      "/finance", "/finance/accounts", "/finance/articles", "/finance/income", "/finance/expenses", "/finance/payroll", "/finance/advances"]);
    for (const { step, row } of rows) {
      await applyStep(tx, step, row);
      if (step.kind === "projectContact" || step.kind === "client") {
        const entity = step.kind === "projectContact" ? "project" : "client";
        const event = await tx.domainEvent.create({ data: { type: `${entity}.updated`, actor: actor.id,
          payload: { [`${entity}Id`]: step.id, ...(entity === "project" ? { field: "contactPerson" } : {}) } } });
        eventIds.push(event.id);
        cachePaths.add(`/${entity}s/${encodeURIComponent(step.id)}`);
      }
    }
    return { inverse: { ...command, steps: command.steps.map(step => ({ ...step,
      fields: step.fields.map(field => ({ ...field, from: field.to, to: field.from })) })) },
      oldValue: command.steps.map(step => Object.fromEntries(step.fields.map(field => [field.key, field.from.value]))),
      newValue: command.steps.map(step => Object.fromEntries(step.fields.map(field => [field.key, field.to.value]))),
      cachePaths: [...cachePaths], eventIds };
  },
});
