import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { initialCashAccount } from "../src/lib/cash-account-default";
import { readDefaultCashAccount, saveDefaultCashAccount, toggleCashAccountCore, listActiveCashAccountOptions } from "../src/server/finance/default-cash-core";
import { DEFAULT_CASH_ACCOUNT_KEY } from "../src/server/finance/default-cash-contracts";
import { listCashAccounts } from "../src/server/finance/queries";
import { loadOrganizationPayments } from "../src/server/finance/organization-ledger";
import { getLogisticsMoneyOptionsCore } from "../src/server/logistics/money-query-core";

const actor = { id: "procurement", name: "Снабженец", roles: ["PROCUREMENT"] as Role[], source: "web" as const };
function fixture() {
  let stored: string | null = null, failAudit = false;
  const accounts = new Map([
    ["byn", { id: "byn", name: "Касса BYN", currency: "BYN", active: true }],
    ["rub", { id: "rub", name: "Касса RUB", currency: "RUB", active: true }],
    ["inactive", { id: "inactive", name: "Архив", currency: "USD", active: false }],
  ]);
  const audits: Prisma.ChangeLogCreateInput[] = [], reads: unknown[] = [];
  const tx = {
    orgSetting: {
      findUnique: async (input: { where: { key: string } }) => { assert.equal(input.where.key, DEFAULT_CASH_ACCOUNT_KEY); reads.push(input); return stored === null ? null : { value: stored }; },
      upsert: async (input: { create: { value: string } }) => { stored = input.create.value; return { value: stored }; },
    },
    cashAccount: {
      findUnique: async ({ where }: { where: { id: string } }) => accounts.get(where.id) ?? null,
      findMany: async (input: { where: { active: boolean } }) => { reads.push(input); return [...accounts.values()].filter(account => !input.where.active || account.active); },
      update: async ({ where, data }: { where: { id: string }; data: { active: boolean } }) => { const current = accounts.get(where.id)!; accounts.set(where.id, { ...current, ...data }); return accounts.get(where.id); },
    },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (failAudit) throw Error("audit-failed"); audits.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, accounts, audits, reads, set: (value: string) => { stored = value; }, failAudit: () => { failAudit = true; },
    async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
      const before = { stored, accounts: structuredClone(accounts), audits: audits.length };
      try { return await operation(tx); }
      catch (error) { stored = before.stored; accounts.clear(); before.accounts.forEach((value, key) => accounts.set(key, value)); audits.length = before.audits; throw error; }
    },
  };
}

test("default setting is absent initially; only allowed role union can assign it", async () => {
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["PROCUREMENT"], ["ACCOUNTANT", "PROCUREMENT"]] as Role[][]) {
    const f = fixture();
    assert.deepEqual(await readDefaultCashAccount(f.tx), { revision: 0, accountId: null });
    const saved = await f.transaction(tx => saveDefaultCashAccount({ ...actor, roles }, { accountId: "rub", expectedRevision: 0 }, tx));
    assert.deepEqual(saved, { ok: true, snapshot: { revision: 1, accountId: "rub" } });
    assert.equal(f.audits.length, 1); assert.equal(f.audits[0].actorId, actor.id); assert.equal(f.audits[0].entity, "orgSetting");
  }
  for (const roles of [["ACCOUNTANT"], ["MANAGER"], ["ENGINEER"], ["WORKER"], []] as Role[][]) {
    const f = fixture(), result = await saveDefaultCashAccount({ ...actor, roles }, { accountId: "rub", expectedRevision: 0 }, f.tx);
    assert.ok(!result.ok && result.kind === "forbidden"); assert.equal(f.reads.length, 0); assert.equal(f.audits.length, 0);
  }
});

test("CAS rejects stale/ABA revisions; no-op and inactive assignments do not write audit", async () => {
  const f = fixture();
  await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 0 }, f.tx);
  await saveDefaultCashAccount(actor, { accountId: "byn", expectedRevision: 1 }, f.tx);
  await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 2 }, f.tx);
  const stale = await saveDefaultCashAccount(actor, { accountId: null, expectedRevision: 1 }, f.tx);
  assert.ok(!stale.ok && stale.kind === "conflict"); assert.deepEqual(stale.current, { revision: 3, accountId: "rub" });
  assert.equal((await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 3 }, f.tx)).ok, true);
  for (const accountId of ["missing", "inactive"]) assert.equal((await saveDefaultCashAccount(actor, { accountId, expectedRevision: 3 }, f.tx)).ok, false);
  assert.equal(f.audits.length, 3);
});

test("deactivation clears default atomically; reactivation does not restore it; stale setting fails CAS", async () => {
  const f = fixture(); await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 0 }, f.tx);
  assert.equal((await f.transaction(tx => toggleCashAccountCore(actor, "rub", tx))).ok, true);
  assert.equal(f.accounts.get("rub")?.active, false); assert.deepEqual(await readDefaultCashAccount(f.tx), { revision: 2, accountId: null });
  assert.equal(f.audits.length, 3);
  assert.equal((await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 1 }, f.tx)).ok, false);
  await f.transaction(tx => toggleCashAccountCore(actor, "rub", tx));
  assert.deepEqual(await readDefaultCashAccount(f.tx), { revision: 2, accountId: null });
  assert.equal((await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 2 }, f.tx)).ok, true);
});

test("an audit failure escapes the callback and rolls both account and setting back", async () => {
  const f = fixture(); await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 0 }, f.tx); f.failAudit();
  await assert.rejects(f.transaction(tx => toggleCashAccountCore(actor, "rub", tx)), /audit-failed/);
  assert.equal(f.accounts.get("rub")?.active, true); assert.deepEqual(await readDefaultCashAccount(f.tx), { revision: 1, accountId: "rub" });
  await assert.rejects(f.transaction(tx => saveDefaultCashAccount(actor, { accountId: "byn", expectedRevision: 1 }, tx)), /audit-failed/);
  assert.deepEqual(await readDefaultCashAccount(f.tx), { revision: 1, accountId: "rub" }); assert.equal(f.audits.length, 1);
});

test("option loader preserves cash currency, marks only active default and never guesses malformed setting", async () => {
  const f = fixture(); await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 0 }, f.tx);
  const options = await listActiveCashAccountOptions(f.tx);
  assert.deepEqual(options.map(account => [account.id, account.currency, account.isDefault]), [["byn", "BYN", false], ["rub", "RUB", true]]);
  f.set(JSON.stringify({ revision: 4, accountId: "inactive" })); assert.ok((await listActiveCashAccountOptions(f.tx)).every(account => !account.isDefault));
  f.set("broken-setting"); await assert.rejects(readDefaultCashAccount(f.tx), /настройку кассы/);
});

test("initial choice uses active default and currency; absent default preserves each form fallback", () => {
  const options = [{ id: "byn", currency: "BYN" }, { id: "rub", currency: "RUB", isDefault: true }];
  assert.deepEqual(initialCashAccount(options, { currency: "BYN", fallback: "currency" }), { cashAccountId: "rub", currency: "RUB" });
  const absent = options.map(option => ({ ...option, isDefault: false }));
  assert.deepEqual(initialCashAccount(absent), { cashAccountId: "", currency: "BYN" });
  assert.deepEqual(initialCashAccount(absent, { currency: "BYN", fallback: "currency" }), { cashAccountId: "byn", currency: "BYN" });
  assert.deepEqual(initialCashAccount(absent, { fallback: "first" }), { cashAccountId: "byn", currency: "BYN" });
  assert.equal(initialCashAccount(options.map(option => ({ ...option, active: option.id !== "rub" }))).cashAccountId, "");
});

test("organization, salary/advance registry and logistics options carry default without changing currency or balances", async () => {
  const f = fixture(); await saveDefaultCashAccount(actor, { accountId: "rub", expectedRevision: 0 }, f.tx);
  const db = {
    ...f.tx,
    project: { findMany: async () => [] },
    user: { findUnique: async () => ({ ...actor, active: true }) },
    cashAccount: { ...f.tx.cashAccount, findMany: async () => [...f.accounts.values()] },
    payment: { findMany: async () => [], groupBy: async () => [{ cashAccountId: "rub", direction: "INCOME", _sum: { amount: new Prisma.Decimal("100") } }] },
    payout: { groupBy: async () => [{ cashAccountId: "rub", _sum: { cashAmount: new Prisma.Decimal("12.34") } }], aggregate: async () => ({ _sum: { cashAmount: new Prisma.Decimal("12.34") } }) },
  } as unknown as Parameters<typeof loadOrganizationPayments>[2] & Parameters<typeof listCashAccounts>[0] & Prisma.TransactionClient;
  // Реальный helper сохраняет фильтр активных опций; реестр дополнительно содержит архивные кассы.
  const registry = await listCashAccounts(db);
  assert.equal(registry.find(account => account.id === "rub")?.balance, 87.66);
  assert.equal(registry.find(account => account.id === "rub")?.isDefault, true);
  assert.equal(registry.find(account => account.id === "inactive")?.isDefault, false);
  db.cashAccount.findMany = f.tx.cashAccount.findMany;
  const organization = await loadOrganizationPayments(actor, "EXPENSE", db);
  assert.deepEqual(organization.cashAccounts.map(account => [account.id, account.isDefault]), [["byn", false], ["rub", true]]);
  const logistics = await getLogisticsMoneyOptionsCore(actor.id, db);
  assert.equal(logistics.cashAccounts.find(account => account.id === "rub")?.isDefault, true);
  assert.equal(logistics.cashAccounts.find(account => account.id === "rub")?.currency, "RUB");
  assert.equal(logistics.cashAccounts.find(account => account.id === "rub")?.balance, 87.66);
});
