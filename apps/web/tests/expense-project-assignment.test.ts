import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { DomainActor } from "../src/server/actor";
import { assignOrdinaryExpenseProjectInTransaction, ordinaryExpenseProjectReversal } from "../src/server/payments/project-assignment-core";

const actor: DomainActor = { id: "accountant", name: "Бухгалтер", roles: ["WORKER", "ACCOUNTANT"], source: "web" };
const decimal = (value: string) => new Prisma.Decimal(value);
type Assignment = { projectId: string | null; projectAmount: string | null; lastActionId: string | null };
type Audit = { id: string; reversal: { data: unknown }; oldValue: unknown; newValue: unknown; presentation: { contexts: { id: string }[] } };

function fixture() {
  const state = {
    projectId: null as string | null, projectAmount: null as Prisma.Decimal | null, lastActionId: "initial" as string | null,
    deletedAt: null as Date | null, deletionId: null as string | null, logisticsAllocationId: null as string | null,
    stockPurchase: null as { id: string } | null, direction: "EXPENSE", receiptActive: false,
    bynAmount: decimal("1234567890.09"), amount: decimal("39.30"), currency: "EUR",
  };
  const projects = new Map<string, { id: string; number: string; currency: string; deletedAt: Date | null }>([
    ["a", { id: "a", number: "11", currency: "BYN", deletedAt: null }],
    ["b", { id: "b", number: "12", currency: "BYN", deletedAt: null }],
    ["foreign", { id: "foreign", number: "13", currency: "RUB", deletedAt: null }],
  ]);
  let roles = actor.roles;
  let readCount = 0;
  let canUpdate = true;
  const edits: Assignment[] = [];
  const audits: Audit[] = [];
  const tx = {
    async $queryRaw() { return []; },
    user: { async findUnique() { return { active: true, roles, name: actor.name }; } },
    project: { async findUnique(input: { where: { id: string } }) {
      const project = projects.get(input.where.id);
      return project && !project.deletedAt ? project : null;
    } },
    payment: {
      async findUnique() {
        readCount++;
        return { ...state, id: "expense", project: state.projectId ? projects.get(state.projectId) : null,
          expenseReceipts: state.receiptActive ? [{ id: "receipt" }] : [] };
      },
      async updateMany(input: { data: Assignment }) {
        if (!canUpdate) return { count: 0 };
        edits.push(input.data);
        state.projectId = input.data.projectId;
        state.projectAmount = input.data.projectAmount === null ? null : decimal(input.data.projectAmount);
        state.lastActionId = input.data.lastActionId;
        return { count: 1 };
      },
    },
    changeLog: { async create(input: { data: Audit }) { audits.push(input.data); return input.data; } },
  } as unknown as Prisma.TransactionClient;
  const assign = (projectId: string | null, expectedProjectId = state.projectId, expectedHead = state.lastActionId, by = actor) =>
    assignOrdinaryExpenseProjectInTransaction(by, { paymentId: "expense", projectId, expectedProjectId, expectedHead }, tx);
  const reversal = (audit: Audit) => {
    const handler = ordinaryExpenseProjectReversal.read(audit.reversal.data);
    assert.ok(handler);
    const context = { tx, actor: { ...actor, roles: ["ADMIN"] as ["ADMIN"] }, entryId: audit.id, entityId: "expense" };
    return { preview: () => handler.preview(context), apply: () => handler.apply(context) };
  };
  return { state, edits, audits, projects, assign, reversal, readCount: () => readCount,
    setRoles: (next: DomainActor["roles"]) => { roles = next; },
    disableUpdate: () => { canUpdate = false; } };
}

test("назначение, перенос и снятие меняют только контекст и сохраняют денежный снимок", async () => {
  const { state, edits, audits, assign } = fixture();
  const first = await assign("a");
  assert.equal(first.changed, true);
  assert.deepEqual(edits[0], { projectId: "a", projectAmount: "1234567890.09", lastActionId: audits[0].id });
  assert.deepEqual(audits[0].oldValue, { projectId: null, project: null, projectAmount: null });
  if (first.changed) assert.ok(first.cachePaths.includes("/finance/projects/a"));
  const move = await assign("b");
  assert.deepEqual(audits[1].presentation.contexts.map(context => context.id).sort(), ["a", "b"]);
  if (move.changed) assert.ok(move.cachePaths.includes("/finance/accounts/report"));
  assert.deepEqual(await assign("b"), { changed: false });
  await assign(null);
  assert.deepEqual(edits[2], { projectId: null, projectAmount: null, lastActionId: audits[2].id });
  assert.equal(state.amount.toFixed(2), "39.30");
  assert.equal(state.bynAmount.toFixed(2), "1234567890.09");
  assert.equal(state.currency, "EUR");
});

test("откат отказывает при более новом действии и восстанавливает прежний Decimal и head", async () => {
  const { state, audits, assign, reversal } = fixture();
  state.projectId = "a";
  state.projectAmount = decimal("7.05");
  await assign("b");
  const move = reversal(audits[0]);
  await assign(null);
  const detach = reversal(audits[1]);
  assert.match(await move.preview() ?? "", /более позднее/);
  const undo = await detach.apply();
  assert.equal(state.lastActionId, audits[0].id);
  assert.equal(state.projectId, "b");
  assert.equal(await move.preview(), null);
  await move.apply();
  assert.equal(state.projectId, "a");
  assert.equal(state.projectAmount?.toFixed(2), "7.05");
  assert.equal(state.lastActionId, "initial");
  assert.ok(ordinaryExpenseProjectReversal.read(undo.reversal.data));
});

test("отказы по роли, источнику, текущему контексту и проекту не пишут аудит", async () => {
  const { state, edits, audits, projects, assign, readCount, setRoles, disableUpdate } = fixture();
  await assert.rejects(assign("a", null, "initial", { ...actor, roles: ["PROCUREMENT"] }), /Недостаточно прав/);
  setRoles(["PROCUREMENT"]);
  await assert.rejects(assign("a"), /Недостаточно прав/);
  assert.equal(readCount(), 0);
  setRoles(actor.roles);
  await assert.rejects(assign("a", null, "stale"), /Расход изменился/);
  await assert.rejects(assign("missing"), /Выбранный проект недоступен/);
  await assert.rejects(assign("foreign"), /валюту проекта в BYN/);
  const archive = projects.get("b")!;
  archive.deletedAt = new Date();
  await assert.rejects(assign("b"), /Выбранный проект недоступен/);
  state.projectId = "b";
  state.projectAmount = decimal("7.05");
  await assert.rejects(assign("a"), /Проект в архиве/);
  state.projectId = null;
  state.projectAmount = null;
  state.stockPurchase = { id: "stock" };
  await assert.rejects(assign("a"), /Складской расход/);
  state.stockPurchase = null;
  state.receiptActive = true;
  await assert.rejects(assign("a"), /Складской расход/);
  state.receiptActive = false;
  state.logisticsAllocationId = "logistics";
  await assert.rejects(assign("a"), /расхода по рейсу/);
  state.logisticsAllocationId = null;
  state.deletedAt = new Date();
  await assert.rejects(assign("a"), /Действующий расход не найден/);
  state.deletedAt = null;
  disableUpdate();
  await assert.rejects(assign("a"), /Расход изменился/);
  assert.equal(edits.length, 0);
  assert.equal(audits.length, 0);
});
