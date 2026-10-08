import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, ProductStatus, ProjectStage } from "@prisma/client";
import { createProductCore } from "../src/server/products/core";
import { changeProductStatusTransaction } from "../src/server/products/status-core";
import { patchProjectStageTransaction } from "../src/server/projects/stage-core";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { PRODUCT_STATUSES, productStatusLabels } from "../src/lib/product-statuses";
import { normalizeListQuery } from "../src/lib/list-state";
import { productStatusTargets } from "../src/lib/product-percentage-ui";
import { productVisibilityWhere, taskExecutionWhere, fileVisibilityWhere } from "../src/server/access/visibility";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
const draft = "DRAFT" as ProductStatus;
const input = { projectId: "project", expectedStage: "ESTIMATE", toStage: "CONTRACT", clientMutationId: "b5428289-23f7-4e42-a967-212da990d141" };

function fixture(stage: ProjectStage = "ESTIMATE") {
  const state = {
    project: { id: "project", number: "111", title: "Заказ", stage, currency: "BYN", deletedAt: null },
    products: [
      { id: "draft", number: "111.1", projectId: "project", status: draft, deletedAt: null, engineerId: null, quantity: 3, expectedPrice: "123.45" },
      { id: "design", number: "111.2", projectId: "project", status: "DESIGN" as ProductStatus, deletedAt: null, engineerId: null, quantity: 5, expectedPrice: "250.00" },
    ],
    history: [] as Record<string, unknown>[],
    productHistory: [] as Record<string, unknown>[],
    audit: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    locks: [] as string[],
    failEvent: false,
    number: 2,
  };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => { state.locks.push(strings.join("?")); return []; },
    project: {
      findUnique: async () => ({ ...state.project }),
      updateMany: async ({ where, data }: { where: { stage: string }; data: Record<string, unknown> }) => {
        if (state.project.stage !== where.stage) return { count: 0 };
        Object.assign(state.project, data);
        return { count: 1 };
      },
    },
    projectStageHistory: {
      findFirst: async ({ where }: { where: { OR?: { toStage?: { notIn: string[] }; fromStage?: { notIn: string[] } }[] } }) =>
        [...state.history].reverse().find(row => where.OR?.some(condition =>
          condition.toStage ? row.toStage && !condition.toStage.notIn.includes(String(row.toStage))
            : row.fromStage && !condition.fromStage!.notIn.includes(String(row.fromStage)))) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { state.history.push(data); return data; },
    },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => state.products.find(p => p.id === where.id) ?? null,
      findMany: async ({ where }: { where: { status?: ProductStatus } }) => state.products.filter(p => !where.status || p.status === where.status).map(p => ({ ...p, suffixInt: Number(p.number.split(".")[1]) })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = state.products.find(p => p.id === where.id)!; Object.assign(p, data); return p;
      },
      updateMany: async ({ where, data }: { where: { id: string; status?: ProductStatus }; data: Record<string, unknown> }) => {
        const p = state.products.find(p => p.id === where.id && (!where.status || p.status === where.status));
        if (!p) return { count: 0 }; Object.assign(p, data); return { count: 1 };
      },
      create: async ({ data }: { data: Prisma.ProductCreateInput }) => ({ id: "new-" + ++state.number, initialPrice: null, ...data }),
    },
    productStatusHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { state.productHistory.push(data); return data; } },
    orgSetting: { findUnique: async () => null },
    changeLog: {
      findUnique: async ({ where }: { where: { id: string } }) => state.audit.find(row => row.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { state.audit.push(data); return data; },
    },
    domainEvent: { create: async ({ data }: { data: Record<string, unknown> }) => {
      if (state.failEvent) throw Error("OUTBOX_FAILURE");
      const event = { id: "event-" + state.events.length, ...data }; state.events.push(event); return event;
    } },
    payrollEntry: { create: async () => { throw Error("NO_PAYROLL_IN_DRAFT_TRANSITIONS"); } },
    productPercentageCompletion: { create: async () => { throw Error("NO_COMPLETION_IN_DRAFT_TRANSITIONS"); } },
  } as unknown as Prisma.TransactionClient;
  const transaction: TaskTransaction = operation => operation(tx);
  const run = async (patch: unknown = input) => {
    const before = structuredClone(state);
    try { return await patchProjectStageTransaction(actor, patch, tx); }
    catch (error) { Object.assign(state, before); throw error; }
  };
  return { state, tx, transaction, run };
}

test("new products in LEAD/ESTIMATE are drafts; confirmed ordinary stages start preparation under project lock", async () => {
  for (const stage of ["LEAD", "ESTIMATE", "CONTRACT", "IN_WORK", "DONE", "RECLAMATION"] as ProjectStage[]) {
    const f = fixture(stage);
    const result = await createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction);
    assert.equal(result.ok, true);
    const expected = ["LEAD", "ESTIMATE"].includes(stage) ? draft : "PREPARATION";
    assert.equal(result.product.status, expected, stage);
    assert.equal((result.product as unknown as { statusHistory: { create: { toStatus: ProductStatus } } }).statusHistory.create.toStatus, expected);
    assert.match(f.state.locks[0], /Project.*FOR UPDATE/, "creation must serialize stage and numbering with contract");
    assert.equal(result.product.number, "111.3");
  }
});

test("PAUSED/REFUSED use the last confirmed ordinary history, including imported fromStage-only history", async () => {
  for (const stage of ["PAUSED", "REFUSED"] as ProjectStage[]) {
    for (const prior of ["ESTIMATE", "CONTRACT", null] as const) {
      const f = fixture(stage);
      if (prior) f.state.history.push({ toStage: prior, fromStage: "LEAD" }, { toStage: stage, fromStage: prior });
      const r = await createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction);
      assert.equal(r.ok, true); if (r.ok) assert.equal(r.product.status, prior === "CONTRACT" ? "PREPARATION" : draft);
    }
    const f = fixture(stage); f.state.history.push({ toStage: stage, fromStage: "CONTRACT" });
    const r = await createProductCore(actor, { projectId: "project", title: "Импорт" }, f.transaction);
    assert.equal(r.ok && r.product.status, "PREPARATION");
  }
});

test("latest imported confirmed fromStage wins over an older ordinary toStage", async () => {
  for (const stage of ["PAUSED", "REFUSED"] as ProjectStage[]) {
    const f = fixture(stage);
    f.state.history.push({ toStage: "ESTIMATE", fromStage: "LEAD" }, { toStage: stage, fromStage: "CONTRACT" });
    const result = await createProductCore(actor, { projectId: "project", title: "Последний подтверждённый этап" }, f.transaction);
    assert.equal(result.ok && result.product.status, "PREPARATION");
  }
});
test("contract promotes every draft only, recording product history/audit/outbox without financial calls", async () => {
  const f = fixture(); f.state.products.push({ ...f.state.products[0], id: "deleted", number: "111.3", deletedAt: new Date() as unknown as null });
  const before = f.state.products.map(p => ({ quantity: p.quantity, expectedPrice: p.expectedPrice, engineerId: p.engineerId }));
  const result = await f.run();
  assert.equal(result.result.ok, true); assert.equal(f.state.project.stage, "CONTRACT");
  assert.deepEqual(f.state.products.map(p => p.status), ["PREPARATION", "DESIGN", "PREPARATION"]);
  assert.deepEqual(f.state.products.map(p => ({ quantity: p.quantity, expectedPrice: p.expectedPrice, engineerId: p.engineerId })), before);
  assert.equal(f.state.productHistory.length, 2); assert.equal(f.state.audit.filter(row => row.entity === "product").length, 2);
  assert.equal(f.state.events.filter(row => row.type === "product.statusChanged").length, 2);
  assert.equal(result.eventIds.length, 3);
});

test("contract receipt replay and no-op never promote a subsequently imported draft or duplicate history", async () => {
  const f = fixture(); await f.run();
  const history = f.state.productHistory.length, events = f.state.events.length;
  f.state.products[0].status = draft;
  assert.equal((await f.run()).result.replayed, true);
  assert.equal(f.state.products[0].status, draft); assert.equal(f.state.productHistory.length, history); assert.equal(f.state.events.length, events);
  const noop = await f.run({ ...input, expectedStage: "CONTRACT", clientMutationId: "d5428289-23f7-4e42-a967-212da990d141" });
  assert.equal(noop.result.noOp, true); assert.equal(f.state.products[0].status, draft);
});

test("contract failure rolls back project, drafts and histories; stale baseline preserves products", async () => {
  const f = fixture(); const before = structuredClone(f.state);
  assert.equal((await f.run({ ...input, expectedStage: "LEAD" })).result.kind, "conflict");
  assert.deepEqual(f.state.products, before.products);
  f.state.failEvent = true; await assert.rejects(f.run(), /OUTBOX_FAILURE/);
  assert.equal(f.state.project.stage, "ESTIMATE"); assert.deepEqual(f.state.products, before.products);
  assert.equal(f.state.history.length + f.state.productHistory.length + f.state.audit.length, 0);
});

test("returning to early stages and skipping contract leaves all existing statuses unchanged", async () => {
  for (const [from, to] of [["CONTRACT", "LEAD"], ["CONTRACT", "ESTIMATE"], ["ESTIMATE", "IN_WORK"]]) {
    const f = fixture(from as ProjectStage); const before = f.state.products.map(p => p.status);
    assert.equal((await f.run({ ...input, expectedStage: from, toStage: to })).result.ok, true);
    assert.deepEqual(f.state.products.map(p => p.status), before); assert.equal(f.state.productHistory.length, 0);
  }
});

test("manual escape from a draft early project is denied before any write, including management", async () => {
  for (const stage of ["LEAD", "ESTIMATE"] as ProjectStage[]) {
    const f = fixture(stage);
    const denied = await changeProductStatusTransaction(f.tx, actor, "draft", "PREPARATION");
    assert.equal(denied.ok, false); assert.match(denied.error!, /Договор/);
    assert.equal(f.state.products[0].status, draft);
    assert.equal(f.state.productHistory.length + f.state.audit.length + f.state.events.length, 0);
    assert.equal((await changeProductStatusTransaction(f.tx, actor, "draft", draft)).ok, true);
  }
  const f = fixture("CONTRACT");
  assert.equal((await changeProductStatusTransaction(f.tx, actor, "draft", "PREPARATION")).ok, true);
});

test("DRAFT is the first shared status, accepted in persistent filters, and early draft has no UI targets", () => {
  assert.equal(PRODUCT_STATUSES[0].id, draft); assert.equal(PRODUCT_STATUSES[1].id, "PREPARATION");
  assert.equal(productStatusLabels[draft], "Черновик");
  assert.deepEqual(JSON.parse(new URLSearchParams(normalizeListQuery("products", "view=kanban&status=DRAFT")).get("status")!), ["DRAFT"]);
  for (const projectStage of ["LEAD", "ESTIMATE"] as ProjectStage[])
    assert.deepEqual(productStatusTargets(actor.roles, { from: draft, projectStage, assignedEngineer: false, participant: false, hasB3d: false, noModel: false }), []);
  assert.ok(productStatusTargets(actor.roles, { from: draft, projectStage: "CONTRACT", assignedEngineer: false, participant: false, hasB3d: false, noModel: false }).includes("PREPARATION"));
});

test("DRAFT assignment never opens product, execution or file visibility for engineering/field roles", () => {
  for (const roles of [["ENGINEER"], ["WORKER"], ["MOUNTER"], ["ENGINEER", "WORKER"]] as const) {
    const user = { id: "u", roles: [...roles], engineeringParticipantProductIds: ["p"], engineeringParticipantTaskIds: ["t"], fieldParticipantProductIds: ["p"] };
    const product = { id: "p", deletedAt: null, status: draft, engineerId: "u", assemblerId: "u", mounterId: "u", tasks: [{ assigneeId: "u" }], project: { tasks: [] } };
    const project = { deletedAt: null, products: [product], tasks: [] };
    const task = { id: "t", deletedAt: null, productId: "p", product, project, assigneeId: "u" };
    const file = { deletedAt: null, productId: "p", taskId: "t", product, project, task };
    for (const [row, where] of [[product, productVisibilityWhere(user)], [task, taskExecutionWhere(user)], [file, fileVisibilityWhere(user)]])
      assert.equal(matches(row as FixtureRow, where as FixtureRow), false);
  }
});