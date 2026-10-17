import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { createCounterpartyInTransaction, updateCounterpartyInTransaction } from "../src/server/counterparties/core";
import type { CounterpartyInput, CounterpartyView } from "../src/server/counterparties/contracts";

const actor = (roles: Role[] = ["PROCUREMENT"]) => ({ id: "actor", name: "Сотрудник", roles, source: "web" as const });
const input: CounterpartyInput = { type: "SUPPLIER", company: "Компания", phone: "+375 00 100", comment: "Условия" };
function fixture() {
  let item: CounterpartyView = { id: "counterparty", ...input, phone: input.phone!, comment: input.comment!, revision: 0 };
  const audits: Prisma.ChangeLogCreateInput[] = [], writes: unknown[] = [];
  let race = false, failAudit = false;
  const tx = {
    counterparty: {
      create: async ({ data }: { data: Pick<CounterpartyView, "type" | "company" | "phone" | "comment"> }) => { writes.push(data); item = { id: "counterparty", revision: 0, ...data }; return { ...item }; },
      findUnique: async ({ where }: { where: { id: string } }) => where.id === item.id ? { ...item } : null,
      findUniqueOrThrow: async () => ({ ...item }),
      updateMany: async ({ where, data }: { where: { id: string; revision: number }; data: Pick<CounterpartyView, "type" | "company" | "phone" | "comment"> & { revision: { increment: number } } }) => {
        if (race) { race = false; item = { ...item, revision: item.revision + 1, company: "Конкурентная правка" }; }
        if (where.id !== item.id || where.revision !== item.revision) return { count: 0 };
        writes.push({ where, data }); item = { ...item, ...data, revision: item.revision + data.revision.increment }; return { count: 1 };
      },
    },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (failAudit) throw Error("QA174_AUDIT_FAILURE"); audits.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, audits, writes, item: () => item, race: () => { race = true; }, failAudit: () => { failAudit = true; } };
}

test("counterparty core normalizes both types, optional contacts and returns only card DTO", async () => {
  for (const type of ["SUPPLIER", "CARRIER"] as const) {
    const f = fixture(), result = await createCounterpartyInTransaction(f.tx, actor(), { type, company: "  Компания  ", phone: " +375 00 100 ", comment: "  Условия  " });
    assert.equal(result.ok, true); assert.deepEqual(f.item(), { id: "counterparty", type, company: "Компания", phone: "+375 00 100", comment: "Условия", revision: 0 });
    assert.equal(f.audits[0].entity, "counterparty"); assert.deepEqual(f.audits[0].newValue, { type, company: "Компания", phone: "+375 00 100", comment: "Условия" });
    assert.equal((await createCounterpartyInTransaction(f.tx, actor(), { type, company: "Без контактов" })).ok, true);
    assert.equal(f.item().phone, null); assert.equal(f.item().comment, null);
  }
});

test("counterparty create/update refuse invalid input and missing revision before data writes", async () => {
  const f = fixture();
  for (const invalid of [{ ...input, company: " " }, { ...input, type: "CLIENT" }, { ...input, company: 42 }, { ...input, cashAccountId: "unexpected" }]) {
    assert.equal((await createCounterpartyInTransaction(f.tx, actor(), invalid)).ok, false);
    assert.equal((await updateCounterpartyInTransaction(f.tx, actor(), "counterparty", invalid, 0)).ok, false);
  }
  for (const revision of [undefined, -1, 0.5, 2147483647]) assert.equal((await updateCounterpartyInTransaction(f.tx, actor(), "counterparty", input, revision as number)).ok, false);
  assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
});

test("counterparty core denies pure engineering/accounting before any database access and preserves role unions", async () => {
  const untouched = new Proxy({}, { get() { throw Error("UNEXPECTED_DATABASE_ACCESS"); } }) as Prisma.TransactionClient;
  for (const roles of [["ENGINEER"], ["ACCOUNTANT"], ["WORKER"], ["MOUNTER"], ["WORK_COORDINATOR"], [], ["ENGINEER", "ACCOUNTANT"]] as Role[][]) {
    assert.deepEqual(await createCounterpartyInTransaction(untouched, actor(roles), input), { ok: false, kind: "forbidden", error: "Недостаточно прав" });
    assert.equal((await updateCounterpartyInTransaction(untouched, actor(roles), "counterparty", input, 0)).ok, false);
  }
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["PROCUREMENT"], ["PROCUREMENT", "ENGINEER"]] as Role[][]) {
    const f = fixture(); assert.equal((await createCounterpartyInTransaction(f.tx, actor(roles), input)).ok, true);
  }
});

test("counterparty revision CAS handles no-op, clearing, stale full editors and a race between read and update", async () => {
  const f = fixture();
  const noop = await updateCounterpartyInTransaction(f.tx, actor(), "counterparty", { ...input }, 0);
  assert.ok(noop.ok && noop.noOp); assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
  const cleared = await updateCounterpartyInTransaction(f.tx, actor(), "counterparty", { ...input, type: "CARRIER", phone: " ", comment: "" }, 0);
  assert.ok(cleared.ok); assert.equal(cleared.item.revision, 1); assert.equal(cleared.item.phone, null); assert.equal(cleared.item.comment, null);
  assert.equal(f.audits.length, 1); assert.equal(f.audits[0].action, "update");
  const stale = await updateCounterpartyInTransaction(f.tx, actor(), "counterparty", { ...input, company: "Устаревшая форма" }, 0);
  assert.ok(!stale.ok && stale.kind === "conflict"); assert.equal(f.writes.length, 1); assert.equal(f.item().company, "Компания");
  f.race(); const race = await updateCounterpartyInTransaction(f.tx, actor(), "counterparty", { ...input, company: "Моя правка" }, 1);
  assert.ok(!race.ok && race.kind === "conflict"); assert.equal(f.item().company, "Конкурентная правка"); assert.equal(f.audits.length, 1);
  const missing = await updateCounterpartyInTransaction(f.tx, actor(), "missing", input, 0); assert.ok(!missing.ok && missing.kind === "not-found");
});

test("counterparty audit failure propagates so the transaction wrapper can roll back", async () => {
  const f = fixture(); f.failAudit();
  await assert.rejects(createCounterpartyInTransaction(f.tx, actor(), input), /QA174_AUDIT_FAILURE/);
  await assert.rejects(updateCounterpartyInTransaction(f.tx, actor(), "counterparty", { ...input, company: "Правка" }, 0), /QA174_AUDIT_FAILURE/);
});
