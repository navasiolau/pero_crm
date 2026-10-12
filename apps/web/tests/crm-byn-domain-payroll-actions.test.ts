import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { beforeEach, afterEach, test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

const require = createRequire(import.meta.url);
let history: { userId: string; amount: string; currency: string; bynAmount: string | null }[] = [];
let due: number | null = 10;
let balance: number | null = 100;
type Due = {userId:string;name:string;due:number|null};
type Preview = {month:string;userScope:string|null;dues:Due[];orgBalance:number|null};
let debtorRows:Due[]|null=null, cashBalance=100, rateReads=0;
let afterFirst:'lower-next'|'unknown-next'|null=null;
const previews:Preview[]=[], payoutWrites:{userId:string;cashAmount:string}[]=[];
const savedPayouts=new Map<string,Prisma.Decimal>();
const writes: { amount: string; bynAmount: string; currency: string }[] = [];
const actor = { id: "accountant", name: "Бухгалтер", roles: ["ACCOUNTANT"] };
let actions: typeof import("../src/server/payroll/actions");
function makeScope() {
  const prisma = {
    user: { findMany: async () => [{ id: "u", name: "U", roles: ["MANAGER"], payPercent: "5" }] },
    payrollEntry: { findMany: async () => history, create: async ({ data }: { data: typeof writes[number] }) => { writes.push(data); return { id: "payroll" }; } },
    payout:{findUnique:async({where}:{where:{id:string}})=>savedPayouts.has(where.id)?{amount:savedPayouts.get(where.id)}:null},
    payment: { aggregate: async () => ({ _sum: { bynAmount: new Prisma.Decimal(1000) }, _count: { _all: 1 } }) },
    changeLog: { create: async () => ({ id: "audit" }) }, domainEvent: { create: async () => ({ id: "event" }) },
  } as unknown as PrismaClient;
  const overrides = {
    "../src/server/tasks/transaction": { withTaskTransaction: async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => operation((globalThis as unknown as { prisma: PrismaClient }).prisma) },
    "next/cache": { revalidatePath: () => {} },
    "../src/server/require-role": { requireAdmin: async () => ({ user: actor }), requireFinance: async () => ({ user: actor }) },
    "../src/server/plugins/changelog": { writeChangeLog: async () => {} },
    "../src/server/plugins/events": { emitDomainEvent: async () => {}, dispatchEvent: async () => {} },
    "../src/server/notifications/notify": { notifyOrg: async () => {}, notifyPerson: async () => {} },
    "../src/server/finance/queries": { listCashAccounts: async () => [{ id: "cash", active: true, currency: "BYN", balance: cashBalance }] },
    "../src/server/finance/nbrb":{getNbrbRate:async(currency:string,date:Date)=>{rateReads++;return{currency,rate:1,date:date.toISOString().slice(0,10)};}},
    "../src/server/payroll/cash-service":{executeCashPayout:async(_actor:unknown,input:{userId:string;cashAmount:string})=>{
      const id='saved-'+payoutWrites.length;payoutWrites.push({userId:input.userId,cashAmount:input.cashAmount});
      savedPayouts.set(id,new Prisma.Decimal(input.cashAmount));
      if(payoutWrites.length===1&&afterFirst&&debtorRows){
        debtorRows=debtorRows.map(row=>row.userId==='v'?{...row,due:afterFirst==='unknown-next'?null:4}:row);
        balance=afterFirst==='unknown-next'?null:4;cashBalance=5;
      }
      return{ok:true,payoutId:id};
    }},
    "../src/server/payroll/queries": {
      currentMonth: () => "2026-10", isValidMonth: () => true,
      getMonthTurnover: async () => ({ total: 1000, currency: "BYN" }),
      readPayrollSummary:async(month:string,userScope:string|null=null)=>{
        const rows=debtorRows??[{userId:'u',name:'U',due}];
        const preview:Preview={month,userScope,dues:rows.filter(row=>userScope===null||row.userId===userScope).map(row=>({...row})),orgBalance:balance};
        previews.push(preview);return preview;
      },
      getEmployeeDues: async (preview?:Preview) => preview?.dues??[{ userId: "u", name: "U", due }],
      getOrgBalance: async (preview?:Preview) => preview?preview.orgBalance:balance,
      getPayrollCurrency: async () => "BYN", round2: (amount: number) => Math.round(amount * 100) / 100,
    },
  };
  return guardedModuleCache(import.meta.url, { targets: ["../src/server/payroll/actions"], allowedOverrides: Object.keys(overrides), overrides, prisma });
}
let scope: ReturnType<typeof guardedModuleCache>;
let priorCache: Map<string, NodeJS.Module | undefined>;
let priorPrisma: PropertyDescriptor | undefined;
beforeEach(() => {
  priorCache = new Map(Object.entries(require.cache)); priorPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  history = []; due = 10; balance = 100; writes.length = 0;
  debtorRows=null;cashBalance=100;rateReads=0;afterFirst=null;previews.length=0;payoutWrites.length=0;savedPayouts.clear();
  scope = makeScope(); actions = scope.load("../src/server/payroll/actions");
});
afterEach(() => scope?.restore());



test("unknown turnover history stops new accrual without writes", async () => {
  history = [{ userId: "u", amount: "10", currency: "USD", bynAmount: null }]; writes.length = 0;
  const result = await actions.accrueTurnover("2026-09");
  assert.equal(result.ok, false); assert.match(result.error!, /BYN/); assert.equal(writes.length, 0);
});

test("turnover top-up uses fixed BYN equivalent, writes a BYN snapshot and Decimal rounding", async () => {
  history = [{ userId: "u", amount: "10", currency: "USD", bynAmount: "30" }]; writes.length = 0;
  assert.equal((await actions.accrueTurnover("2026-09")).ok, true);
  assert.equal(writes.length, 1); assert.equal(new Prisma.Decimal(writes[0].amount).toNumber(), 20);
  assert.equal(new Prisma.Decimal(writes[0].bynAmount).toNumber(), 20); assert.equal(writes[0].currency, "BYN");
});

test("unknown debt or organization balance stops settleAll before rates or money writes", async () => {
  writes.length = 0; due = null; balance = 100;
  assert.equal((await actions.settleAll("2026-09", "cash")).ok, false);
  due = 10; balance = null;
  assert.equal((await actions.settleAll("2026-09", "cash")).ok, false);
  assert.equal(writes.length, 0);
  assert.equal(rateReads,0);assert.equal(payoutWrites.length,0);
});

test('settleAll discards each preview and sees changed next-employee debt, org funds and cash',async()=>{
  debtorRows=[{userId:'u',name:'U',due:10},{userId:'v',name:'V',due:10}];afterFirst='lower-next';
  assert.deepEqual(await actions.settleAll('2026-09','cash'),{ok:true,paidCount:2,totalPaid:14,shortPaid:[]});
  assert.deepEqual(previews.map(row=>row.userScope),[null,'u','v']);
  assert.deepEqual(payoutWrites,[{userId:'u',cashAmount:'10.00'},{userId:'v',cashAmount:'4.00'}]);
  assert.equal(previews[0].dues.find(row=>row.userId==='v')!.due,10);
  assert.equal(previews[2].dues[0].due,4);assert.equal(previews[2].orgBalance,4);
  assert.notEqual(previews[1],previews[2]);assert.equal(writes.length,0);
});

test('unknown next preview preserves partial result and prevents another financial writer',async()=>{
  debtorRows=[{userId:'u',name:'U',due:10},{userId:'v',name:'V',due:10}];afterFirst='unknown-next';
  const result=await actions.settleAll('2026-09','cash');
  assert.equal(result.ok,false);assert.match(result.error!,/BYN/);
  assert.equal(result.paidCount,1);assert.equal(result.totalPaid,10);assert.deepEqual(result.shortPaid,[]);
  assert.deepEqual(previews.map(row=>row.userScope),[null,'u','v']);
  assert.equal(payoutWrites.length,1);assert.equal(previews[2].dues[0].due,null);
});

// Общая guard-матрица только здесь; остальные suites сохраняют доменные сценарии.
test("fixture refuses unknown target, nested scopes and late mock effects", () => {
  assert.throws(() => scope.load("../src/server/products/actions"), /FIXTURE_TARGET_NOT_ALLOWED/);
  assert.throws(() => makeScope(), /FIXTURE_SCOPE_ALREADY_ACTIVE/);
  const finance = require("../src/server/require-role").requireFinance;
  scope.restore();
  assert.throws(() => finance(), /FIXTURE_SCOPE_CLOSED/);
  assert.throws(() => scope.load("../src/server/payroll/actions"), /FIXTURE_SCOPE_CLOSED/);
  scope.restore();
  assert.throws(() => guardedModuleCache(import.meta.url, { targets: ["../src/server/payroll/actions"], allowedOverrides: ["next/cache"], overrides: { "../src/auth": {} }, prisma: {} }), /FIXTURE_OVERRIDE_NOT_ALLOWED/);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "prisma"), priorPrisma);
});

test("fixture preserves real Decimal and refuses unexpected Prisma construction or methods", () => {
  const client: typeof import("@prisma/client") = require("@prisma/client");
  assert.equal(client.Prisma.Decimal, Prisma.Decimal);
  assert.equal(new client.Prisma.Decimal("0.1").plus("0.2").toString(), "0.3");
  assert.throws(() => new client.PrismaClient(), /UNEXPECTED_PRISMA_CONSTRUCTION/);
  const prisma = (globalThis as unknown as { prisma: { payment: { deleteMany(): void }; missingModel: { create(): void } } }).prisma;
  assert.throws(() => prisma.payment.deleteMany(), /UNEXPECTED_PRISMA_CALL/);
  assert.throws(() => prisma.missingModel.create(), /UNEXPECTED_PRISMA_CALL/);
});

test("fixture blocks network before the original request effect and restores globals", () => {
  scope.restore();
  const http: typeof import("node:http") = require("node:http");
  const original = Object.getOwnPropertyDescriptor(http, "request")!; let effects = 0;
  Object.defineProperty(http, "request", { ...original, value: () => { effects++; throw new Error("ORIGINAL_NETWORK_EFFECT"); } });
  try {
    scope = makeScope();
    assert.throws(() => http.request("https://example.invalid"), /UNEXPECTED_NETWORK_CALL/);
    assert.throws(() => fetch("https://example.invalid"), /UNEXPECTED_NETWORK_CALL/);
    assert.throws(() => require("node:net").connect(1, "127.0.0.1"), /UNEXPECTED_NETWORK_CALL/);
    assert.throws(() => new (require("node:net").Socket)().connect(1, "127.0.0.1"), /UNEXPECTED_NETWORK_CALL/);
    assert.equal(effects, 0); scope.restore();
    assert.equal(Object.getOwnPropertyDescriptor(http, "request")?.value === original.value, false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "prisma"), priorPrisma);
  } finally { scope.restore(); Object.defineProperty(http, "request", original); }
});

test("fixture preserves falsy failures and releases guards after async failure", async () => {
  scope.restore();
  for (const failure of [null, undefined, false, 0, ""]) {
    scope = makeScope(); let caught = false;
    try { await scope.run(async () => { throw failure; }); } catch (error) { caught = true; assert.equal(error, failure); }
    assert.equal(caught, true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "prisma"), priorPrisma);
  }
  const file = require.resolve("next/cache"), foreign = new Module(file); foreign.filename = file; foreign.exports = {};
  scope = makeScope(); require.cache[file] = foreign;
  try {
    let captured: unknown; try { await scope.run(async () => { throw false; }); } catch (error) { captured = error; }
    assert.ok(captured instanceof AggregateError); assert.equal(captured.errors[0], false);
    assert.ok(captured.errors[1] instanceof AggregateError); assert.equal(require.cache[file], foreign);
  } finally { const prior = priorCache.get(file); if (prior) require.cache[file] = prior; else delete require.cache[file]; }
  scope = makeScope(); await scope.run(async () => assert.equal(1 + 1, 2));
});

test("fixture restores partial setup on failure without replacing foreign cache entries", () => {
  scope.restore();
  let enumeration = 0, caught = false;
  const overrides = new Proxy({ "next/cache": {} }, { ownKeys(target) { if (++enumeration > 2) throw null; return Reflect.ownKeys(target); } });
  try { guardedModuleCache(import.meta.url, { targets: ["../src/server/payroll/actions"], allowedOverrides: ["next/cache"], overrides, prisma: {} }); } catch (error) { caught = true; assert.equal(error, null); }
  assert.equal(caught, true); assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "prisma"), priorPrisma);
  const changed = require.resolve("next/cache"), before = require.cache[changed], injected = new Module(changed);
  let calls = 0; const raced = new Proxy({ "next/cache": {} }, { ownKeys(target) { if (++calls === 3) require.cache[changed] = injected; return Reflect.ownKeys(target); } });
  try {
    assert.throws(() => guardedModuleCache(import.meta.url, { targets: ["../src/server/payroll/actions"], allowedOverrides: ["next/cache"], overrides: raced, prisma: {} }), /FIXTURE_CACHE_CONFLICT/);
    assert.equal(require.cache[changed], injected); assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "prisma"), priorPrisma);
  } finally { if (before) require.cache[changed] = before; else delete require.cache[changed]; }
  const fetchBefore = Object.getOwnPropertyDescriptor(globalThis, "fetch")!, foreignFetch = () => { throw new Error("FOREIGN_FETCH_EFFECT"); };
  calls = 0; const racedGlobal = new Proxy({ "next/cache": {} }, { ownKeys(target) { if (++calls === 3) Object.defineProperty(globalThis, "fetch", { ...fetchBefore, value: foreignFetch }); return Reflect.ownKeys(target); } });
  try {
    assert.throws(() => guardedModuleCache(import.meta.url, { targets: ["../src/server/payroll/actions"], allowedOverrides: ["next/cache"], overrides: racedGlobal, prisma: {} }), /FIXTURE_GLOBAL_CONFLICT/);
    assert.equal(globalThis.fetch, foreignFetch); assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "prisma"), priorPrisma);
  } finally { Object.defineProperty(globalThis, "fetch", fetchBefore); }
  scope = makeScope(); const file = require.resolve("next/cache"), foreign = new Module(file); foreign.filename = file; foreign.exports = { foreign: true };
  require.cache[file] = foreign;
  try {
    assert.throws(() => scope.restore(), /FIXTURE_RESTORE_CONFLICT/);
    assert.equal(require.cache[file], foreign);
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "prisma"), priorPrisma);
  } finally { const prior = priorCache.get(file); if (prior) require.cache[file] = prior; else delete require.cache[file]; }
  scope = makeScope(); scope.restore();
});

test("fixture removes only its loaded target closure and retains unrelated new cache entry", () => {
  const file = require.resolve("./helpers/visibility-fixture"), original = require.cache[file], foreign = new Module(file);
  foreign.filename = file; foreign.exports = { foreign: true }; require.cache[file] = foreign;
  const target = require.resolve("../src/server/payroll/actions");
  try {
    scope.restore(); assert.equal(require.cache[file], foreign);
    assert.equal(require.cache[target], priorCache.get(target));
  } finally { if (original) require.cache[file] = original; else delete require.cache[file]; }
});
