import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, ProductStatus } from "@prisma/client";
import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";
import { patchProductCore, updateProductCore } from "../src/server/products/core";
import type { ProductPatch } from "../src/server/products/patch-contract";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { maskProductionRead } from "../src/server/access/production-read-projection";

const manager = { id: "m", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
const engineer = { ...manager, id: "e", roles: ["ENGINEER" as const] };
const body: FurnitureSection = { id: randomUUID(), type: "body", group: "construction", label: "Корпус", value: "" };
const custom: FurnitureSection = { id: randomUUID(), type: "custom", group: "filling", label: "  Ручная строка  ", value: "" };
const identity = () => ({ productId: "p", clientMutationId: randomUUID(), expectedSourceGeneration: 0 });
const add = (section: FurnitureSection): ProductPatch => ({ ...identity(), clientMutationId: section.id, field: "technicalSpecificationAdd", section });
const setValue = (sectionId: string, expectedValue: string, value: string): ProductPatch => (
  { ...identity(), field: "technicalSpecificationValue", sectionId, expectedValue, value }
);

function fixture() {
  const description = "  Старый <b>текст</b>\r\n  ";
  const row = { id: "p", description, technicalSpecifications: null as TechnicalSpecifications | null, engineerId: "e", status: "DESIGN" as ProductStatus };
  type Audit = { id: string; action: string; oldValue: unknown; newValue: unknown };
  const logs: Audit[] = [];
  let locked = false;
  let beforeLock: (() => void) | undefined;
  let failAudit = false;
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => {
      assert.match(query.join("?"), /FROM "Product".*FOR UPDATE/);
      locked = true;
      beforeLock?.();
      beforeLock = undefined;
      return [{ id: row.id }];
    },
    product: {
      findFirst: async () => structuredClone(row),
      update: async ({ data }: { data: Partial<typeof row> }) => {
        assert.equal(locked, true); Object.assign(row, data); return structuredClone(row);
      },
    },
    task: { findMany: async () => [] },
    changeLog: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        assert.equal(locked, true, "receipt check needs the Product lock");
        return logs.find(log => log.id === where.id) ?? null;
      },
      create: async ({ data }: { data: Audit }) => {
        assert.equal(locked, true);
        if (failAudit) throw new Error("AUDIT_FAILURE");
        assert.ok(!logs.some(log => log.id === data.id));
        logs.push(structuredClone(data));
      },
    },
  };
  const transaction: TaskTransaction = async operation => {
    locked = false;
    const prior = structuredClone(row);
    const length = logs.length;
    try { return await operation(tx as unknown as Prisma.TransactionClient); }
    catch (error) { Object.assign(row, prior); logs.length = length; throw error; }
  };
  return { row, logs, transaction, description,
    mutate: (patch: ProductPatch, actor = manager) => patchProductCore(actor, patch, transaction),
    beforeLock: (callback: () => void) => { beforeLock = callback; },
    failAudit: () => { failAudit = true; },
  };
}

test("structured scalar CAS merges fresh unrelated rows and compares the entire deleted section", async () => {
  const f = fixture();
  for (const section of [body, custom]) assert.equal((await f.mutate(add(section))).kind, "saved");
  assert.equal(f.row.description, f.description);
  const request = setValue(body.id, "", "Дуб\r\n<b>вставка</b>");
  f.beforeLock(() => { f.row.technicalSpecifications!.sections[1].value = "Вкладка"; });
  const saved = await f.mutate(request);
  assert.equal(saved.kind, "saved");
  assert.deepEqual(f.row.technicalSpecifications?.sections.map(section => section.value), ["Дуб\r\n<b>вставка</b>", "Вкладка"]);
  assert.deepEqual(await f.mutate(request), { ...saved, repeated: true });
  assert.equal(f.logs.length, 3);
  assert.deepEqual((f.logs[2].newValue as Record<string, unknown>).technicalSpecifications, f.row.technicalSpecifications);
  const stale = await f.mutate({ ...identity(), field: "technicalSpecificationRemove", section: custom });
  assert.equal(stale.kind, "conflict");
  const remove: ProductPatch = { ...identity(), field: "technicalSpecificationRemove", section: { ...custom, value: "Вкладка" } };
  const removed = await f.mutate(remove);
  assert.equal(removed.kind, "saved");
  assert.deepEqual(await f.mutate(remove), { ...removed, repeated: true });
  assert.equal((await f.mutate(setValue(custom.id, "Вкладка", "Позднее"))).kind, "conflict");
  assert.deepEqual(f.row.technicalSpecifications?.sections.map(section => section.id), [body.id]);
});

test("sources have independent scalar CAS, old writers conflict, and rollback leaves the previous JSON", async () => {
  const f = fixture();
  const size: ProductPatch = { ...identity(), field: "technicalSpecificationSource", source: "size", expectedValue: null, value: "100×120" };
  const note: ProductPatch = { ...identity(), field: "technicalSpecificationSource", source: "note", expectedValue: null, value: "Доставка" };
  for (const patch of [size, note]) assert.equal((await f.mutate(patch)).kind, "saved");
  const conflict = await f.mutate({ ...size, clientMutationId: randomUUID() });
  assert.equal(conflict.kind, "conflict"); assert.equal("currentValue" in conflict && conflict.currentValue, "100×120");
  assert.equal((await f.mutate({ productId: f.row.id, clientMutationId: randomUUID(), field: "description", expectedValue: f.description, value: "Поздно" })).kind, "conflict");
  assert.equal((await updateProductCore(manager, f.row.id, { description: "Поздно" }, { description: f.description }, f.transaction)).ok, false);
  const unchanged = { ...note, clientMutationId: randomUUID(), expectedValue: note.value };
  const noop = await f.mutate(unchanged);
  assert.equal(noop.kind === "saved" && noop.noOp, true);
  assert.deepEqual(await f.mutate(unchanged), { ...noop, repeated: true });
  assert.equal(f.logs.at(-1)?.action, "inline.receipt");
  f.failAudit();
  const baseline = structuredClone(f.row);
  assert.equal((await f.mutate(add(body))).kind, "failure");
  assert.deepEqual(f.row, baseline);
  assert.equal(f.row.description, f.description);
});

test("engineer rights are checked again under lock before replay; field redaction masks both formats", async () => {
  const f = fixture();
  const request = add(body);
  assert.equal((await patchProductCore(engineer, request, f.transaction)).kind, "saved");
  f.beforeLock(() => { f.row.engineerId = "replacement"; });
  const revoked = await patchProductCore(engineer, request, f.transaction);
  assert.equal(revoked.kind, "forbidden");
  assert.equal("currentValue" in revoked, false);
  const db = { product: { findMany: async () => [] } } as unknown as Parameters<typeof maskProductionRead>[0];
  const [masked] = await maskProductionRead(db, { id: "field", roles: ["WORKER"] }, [f.row]);
  assert.equal(masked.description, null);
  assert.equal(masked.technicalSpecifications, null);
  assert.equal(masked.canReadTechnicalSpecifications, false);
  const [visible] = await maskProductionRead(db, manager, [f.row]);
  assert.deepEqual(visible.technicalSpecifications, f.row.technicalSpecifications);
  assert.equal(visible.canReadTechnicalSpecifications, true);
});

test("a newly added standard row has a fresh identity; stale mutations cannot act on it", async () => {
  const f = fixture();
  const first = add(body);
  const second = { ...body, id: randomUUID() };
  assert.equal((await f.mutate(first)).kind, "saved");
  assert.equal((await f.mutate(add(second))).kind, "conflict");
  const remove = { ...identity(), field: "technicalSpecificationRemove", section: body } as const;
  assert.equal((await f.mutate(remove)).kind, "saved");
  assert.equal((await f.mutate(add(second))).kind, "saved");
  assert.equal((await f.mutate(setValue(body.id, "", "Позднее значение"))).kind, "conflict");
  assert.equal((await f.mutate({ ...remove, clientMutationId: randomUUID() })).kind, "saved");
  assert.equal((await f.mutate({ ...first, clientMutationId: randomUUID() })).kind, "validation");
  assert.deepEqual(f.row.technicalSpecifications?.sections, [second]);
});
