import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, ProductStatus } from "@prisma/client";
import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";
import { patchProductCore, updateProductCore, createSchema } from "../src/server/products/core";
import { productPatchSchema, type ProductPatch } from "../src/server/products/patch-contract";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { maskProductionRead } from "../src/server/access/production-read-projection";
import { parseLegacyProductDescription } from "../src/lib/product-legacy-specifications";

const manager = { id: "m", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
const engineer = { ...manager, id: "e", roles: ["ENGINEER" as const] };
const body: FurnitureSection = { id: randomUUID(), type: "body", group: "construction", label: "Корпус", value: "" };
const custom: FurnitureSection = { id: randomUUID(), type: "custom", group: "filling", label: "  Ручная строка  ", value: "" };
const identity = () => ({ productId: "p", clientMutationId: randomUUID(), expectedSourceGeneration: 0 });
type Pair = { label: string; value: string };
const rowPatch = (sectionId: string, expectedRow: Pair | null, row: Pair | null, expectedLegacyDescription: string | null = null): ProductPatch => ({
  ...identity(), clientMutationId: expectedRow === null && row !== null ? sectionId : randomUUID(),
  field: "technicalSpecificationRow", sectionId,
  expectedRow: expectedRow && { label: expectedRow.label, value: expectedRow.value },
  row: row && { label: row.label, value: row.value }, expectedLegacyDescription,
});

function fixture(description: string | null = null) {
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

test("custom rows append, renamed labels and order persist, independent CAS merges and replay preserves the result", async () => {
  const f = fixture();
  const empty = rowPatch(randomUUID(), null, null);
  assert.equal((await f.mutate(empty)).kind, "saved");
  assert.equal(f.row.technicalSpecifications === null, true);
  const firstId = randomUUID();
  const firstPair = { label: "Мой корпус", value: "Дуб\r\n<b>вставка</b>" };
  const first = rowPatch(firstId, null, firstPair);
  const saved = await f.mutate(first);
  assert.equal(saved.kind, "saved");
  assert.deepEqual(saved.kind === "saved" && saved.value, firstPair);
  assert.equal(saved.kind === "saved" && saved.derived?.technicalSpecificationsEditRevision, 1);
  assert.deepEqual(await f.mutate(first), { ...saved, repeated: true });
  const secondId = randomUUID();
  const secondPair = { label: "", value: "МДФ" };
  assert.equal((await f.mutate(rowPatch(secondId, null, secondPair))).kind, "saved");
  f.beforeLock(() => { f.row.technicalSpecifications!.sections[1].value = "Берёза"; });
  const renamed = { label: "Переименовано", value: "Ясень" };
  assert.equal((await f.mutate(rowPatch(firstId, firstPair, renamed))).kind, "saved");
  assert.deepEqual(f.row.technicalSpecifications?.sections.map(row => [row.id, row.label, row.value]), [
    [firstId, renamed.label, renamed.value], [secondId, "", "Берёза"],
  ]);
  assert.equal(f.row.description, f.description);
  assert.equal(f.row.technicalSpecifications?.editRevision, 3);
  const noop = await f.mutate(rowPatch(firstId, renamed, renamed));
  assert.equal(noop.kind === "saved" && noop.derived?.technicalSpecificationsEditRevision, 3);
  assert.equal(f.row.technicalSpecifications?.editRevision, 3);
  const db = { product: { findMany: async () => [] } } as unknown as Parameters<typeof maskProductionRead>[0];
  const [reloaded] = await maskProductionRead(db, manager, [f.row]);
  assert.deepEqual(reloaded.technicalSpecifications, f.row.technicalSpecifications);
  assert.deepEqual((f.logs.findLast(log => log.action === "inline.update")?.newValue as Record<string, unknown>).technicalSpecifications, f.row.technicalSpecifications);
});

test("pair CAS rejects stale labels, deletion cannot resurrect by stale update or new creation and audit failure rolls back", async () => {
  const f = fixture();
  f.row.technicalSpecifications = {
    sections: [body, custom], description: "Старое", size: "100×120", note: "Старое", sourceGeneration: 0,
  };
  const renamed = { label: "Переименованный корпус", value: "Дуб" };
  assert.equal((await f.mutate(rowPatch(body.id, { label: body.label, value: body.value }, renamed))).kind, "saved");
  assert.equal((await f.mutate(rowPatch(body.id, { label: body.label, value: body.value }, renamed))).kind, "conflict");
  assert.deepEqual(f.row.technicalSpecifications?.sections[0], { ...body, ...renamed });
  assert.deepEqual(f.row.technicalSpecifications?.sections[1], custom);
  assert.equal(f.row.technicalSpecifications?.note, null);
  const remove = rowPatch(body.id, renamed, null);
  const removed = await f.mutate(remove);
  assert.equal(removed.kind, "saved");
  assert.deepEqual(await f.mutate(remove), { ...removed, repeated: true });
  assert.equal((await f.mutate(rowPatch(body.id, renamed, { label: "Поздно", value: "Поздно" }))).kind, "conflict");
  const introducedId = randomUUID();
  const introduced = rowPatch(introducedId, null, renamed);
  const introducedSaved = await f.mutate(introduced);
  assert.equal(introducedSaved.kind, "saved");
  assert.equal((await f.mutate(rowPatch(introducedId, renamed, null))).kind, "saved");
  assert.equal((await f.mutate({ ...introduced, clientMutationId: randomUUID() })).kind, "validation");
  assert.deepEqual(await f.mutate(introduced), { ...introducedSaved, repeated: true });
  assert.equal(f.row.technicalSpecifications?.sections.some(row => row.id === introducedId), false);
  const baseline = structuredClone(f.row);
  f.failAudit();
  assert.equal((await f.mutate(rowPatch(randomUUID(), null, renamed))).kind, "failure");
  assert.deepEqual(f.row, baseline);
});

test("engineer rights are checked under lock before replay and field redaction masks both formats", async () => {
  const f = fixture();
  const request = rowPatch(randomUUID(), null, { label: "Личная строка", value: "Дуб" });
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
});

test("source generation blocks stale pair edits while successful receipt replay returns original ACK", async () => {
  const f = fixture();
  const id = randomUUID(), pair = { label: "Первое", value: "Дуб" };
  const create = rowPatch(id, null, pair);
  const saved = await f.mutate(create);
  assert.equal(saved.kind, "saved");
  f.row.technicalSpecifications!.sourceGeneration = 1;
  assert.equal((await f.mutate(rowPatch(id, pair, { ...pair, value: "Поздно" }))).kind, "conflict");
  assert.deepEqual(await f.mutate(create), { ...saved, repeated: true });
  assert.equal(f.row.technicalSpecifications!.sections[0].value, "Дуб");
  assert.equal((await f.mutate({ productId: f.row.id, clientMutationId: randomUUID(), field: "description",
    expectedValue: f.description, value: "Поздно" })).kind, "conflict");
  assert.equal((await updateProductCore(manager, f.row.id, { description: "Поздно" }, { description: f.description }, f.transaction)).ok, false);
});

test("obsolete Entry clients get explicit refresh validation and creation accepts custom labels without source fields", () => {
  assert.equal(productPatchSchema.safeParse({ ...identity(), field: "technicalSpecificationEntry", type: "body",
    expectedSectionId: null, expectedValue: "", value: "Лишнее" }).success, false);
  const base = { projectId: "project", title: "Изделие" };
  const empty = { sections: [], description: null, size: null, note: null, sourceGeneration: 0 };
  assert.equal(createSchema.safeParse({ ...base, technicalSpecifications: empty }).success, true);
  assert.equal(createSchema.safeParse({ ...base, technicalSpecifications: { ...empty, note: "Лишнее" } }).success, false);
  assert.equal(createSchema.safeParse({ ...base, technicalSpecifications: { ...empty, sections: [custom, { ...body, label: "Своё имя" }] } }).success, true);
});

test("first legacy edit materializes the entire snapshot, neighboring editors merge and lost ACK replays", async () => {
  const raw = "  Старый <b>текст</b>\r\n\r\n1.Корпус ЛДСП H1180 ST37\r\nФасад: МДФ\r\n";
  const f = fixture(raw), snapshot = parseLegacyProductDescription(raw);
  const first = snapshot.sections[1], second = snapshot.sections[2];
  const noop = rowPatch(first.id, first, first, raw);
  const noChange = await f.mutate(noop);
  assert.equal(noChange.kind === "saved" && noChange.noOp, true);
  assert.equal(f.row.technicalSpecifications === null, true);
  const edited = { label: first.label, value: "Шпон" };
  const request = rowPatch(first.id, first, edited, raw);
  const saved = await f.mutate(request);
  assert.equal(saved.kind, "saved");
  assert.equal(saved.kind === "saved" && saved.derived?.technicalSpecificationsEditRevision, 1);
  assert.deepEqual(saved.kind === "saved" && saved.derived?.technicalSpecifications, f.row.technicalSpecifications);
  assert.deepEqual(f.row.technicalSpecifications?.sections, snapshot.sections.map(row => row.id === first.id ? { ...row, ...edited } : row));
  assert.equal(f.row.description, raw);
  const neighbor = rowPatch(second.id, second, { label: second.label, value: "Эмаль" }, raw);
  assert.equal((await f.mutate(neighbor)).kind, "saved");
  assert.equal(f.row.technicalSpecifications?.sections[1].value, "Шпон");
  assert.equal(f.row.technicalSpecifications?.sections[2].value, "Эмаль");
  assert.equal(f.row.technicalSpecifications?.editRevision, 2);
  assert.deepEqual(await f.mutate(request), { ...saved, repeated: true });
  assert.equal(f.row.technicalSpecifications?.editRevision, 2);
  assert.equal(f.row.description, raw);
});

test("legacy baseline is mandatory including null and compared under lock before materialization", async () => {
  const raw = "Корпус: Дуб", f = fixture(raw), row = parseLegacyProductDescription(raw).sections[0];
  const missing = rowPatch(row.id, row, { label: row.label, value: "Шпон" }, raw);
  assert.ok(missing.field === "technicalSpecificationRow");
  delete missing.expectedLegacyDescription;
  assert.equal((await f.mutate(missing)).kind, "conflict");
  const baseline = rowPatch(row.id, row, { label: row.label, value: "Шпон" }, raw);
  f.beforeLock(() => { f.row.description = "Корпус: Берёза"; });
  assert.equal((await f.mutate(baseline)).kind, "conflict");
  assert.equal(f.row.technicalSpecifications, null);
  assert.equal(f.logs.length, 0);
  assert.equal(f.row.description, "Корпус: Берёза");
  const empty = fixture();
  const openedEmpty = rowPatch(randomUUID(), null, { label: "Новая", value: "Строка" });
  empty.beforeLock(() => { empty.row.description = raw; });
  assert.equal((await empty.mutate(openedEmpty)).kind, "conflict");
  assert.equal(empty.row.technicalSpecifications, null);
});

test("legacy deletion stays empty, stale update cannot restore it and audit failure rolls back all rows", async () => {
  const raw = "Корпус: Дуб", f = fixture(raw), first = parseLegacyProductDescription(raw).sections[0];
  const remove = rowPatch(first.id, first, null, raw);
  assert.equal((await f.mutate(remove)).kind, "saved");
  assert.deepEqual(f.row.technicalSpecifications?.sections, []);
  assert.equal((await f.mutate(rowPatch(first.id, first, { label: first.label, value: "Поздно" }, raw))).kind, "conflict");
  assert.deepEqual(f.row.technicalSpecifications?.sections, []);
  assert.equal(f.row.description, raw);
  const rollback = fixture("Корпус: Дуб\r\nФасад: МДФ"), snapshot = structuredClone(rollback.row);
  const before = parseLegacyProductDescription(rollback.description).sections[0];
  rollback.failAudit();
  assert.equal((await rollback.mutate(rowPatch(before.id, before, { label: "Корпус", value: "Ясень" }, rollback.description))).kind, "failure");
  assert.deepEqual(rollback.row, snapshot);
  assert.equal(rollback.logs.length, 0);
});

test("a saved legacy scalar receipt replays after materialization but rejects a reused fingerprint", async () => {
  const f = fixture("Каркас: Дуб");
  const legacy: ProductPatch = { productId: f.row.id, field: "description", clientMutationId: randomUUID(),
    expectedValue: f.description, value: "Каркас: Ясень" };
  const saved = await f.mutate(legacy);
  assert.equal(saved.kind, "saved");
  const before = parseLegacyProductDescription(f.row.description).sections[0];
  assert.equal((await f.mutate(rowPatch(before.id, before, { label: "Каркас", value: "Берёза" }, f.row.description))).kind, "saved");
  const materialized = structuredClone(f.row), count = f.logs.length;
  assert.deepEqual(await f.mutate(legacy), { ...saved, repeated: true });
  assert.equal((await f.mutate({ ...legacy, value: "Подменённое значение" })).kind, "validation");
  assert.equal((await f.mutate({ ...legacy, clientMutationId: randomUUID(), expectedValue: f.row.description, value: "Новая правка" })).kind, "conflict");
  assert.deepEqual(f.row, materialized);
  assert.equal(f.logs.length, count);
});
