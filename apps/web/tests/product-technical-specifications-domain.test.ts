import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, ProductStatus } from "@prisma/client";
import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";
import { patchProductCore, updateProductCore, createSchema } from "../src/server/products/core";
import { productPatchSchema, type ProductPatch } from "../src/server/products/patch-contract";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { maskProductionRead } from "../src/server/access/production-read-projection";

const manager = { id: "m", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
const engineer = { ...manager, id: "e", roles: ["ENGINEER" as const] };
const body: FurnitureSection = { id: randomUUID(), type: "body", group: "construction", label: "Корпус", value: "" };
const custom: FurnitureSection = { id: randomUUID(), type: "custom", group: "filling", label: "  Ручная строка  ", value: "" };
const identity = () => ({ productId: "p", clientMutationId: randomUUID(), expectedSourceGeneration: 0 });
const entry = (type: Exclude<FurnitureSection["type"], "custom">, expectedSectionId: string | null,
  expectedValue: string, value: string): ProductPatch => ({
    ...identity(), field: "technicalSpecificationEntry", type, expectedSectionId, expectedValue, value,
  });

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

test("virtual fields create one standard row on actual input and merge fresh unrelated values", async () => {
  const f = fixture();
  const empty = entry("body", null, "", "");
  assert.equal((await f.mutate(empty)).kind, "saved");
  assert.equal(f.row.technicalSpecifications === null, true);
  const first = entry("body", null, "", "Дуб\r\n<b>вставка</b>");
  const saved = await f.mutate(first);
  assert.equal(saved.kind, "saved");
  assert.equal(saved.kind === "saved" && saved.derived?.technicalSpecificationSectionId, first.clientMutationId);
  assert.equal(f.row.description, f.description);
  assert.deepEqual(await f.mutate(first), { ...saved, repeated: true });
  const next = entry("facade", null, "", "МДФ");
  assert.equal((await f.mutate(next)).kind, "saved");
  const bodyEdit = entry("body", first.clientMutationId, "Дуб\r\n<b>вставка</b>", "Ясень");
  f.beforeLock(() => { f.row.technicalSpecifications!.sections[1].value = "Берёза"; });
  assert.equal((await f.mutate(bodyEdit)).kind, "saved");
  assert.deepEqual(f.row.technicalSpecifications?.sections.map(row => row.value), ["Ясень", "Берёза"]);
  assert.equal((await f.mutate(entry("body", null, "", "Поздно"))).kind, "conflict");
  assert.equal((await f.mutate(entry("body", first.clientMutationId, "Ясень", ""))).kind, "saved");
  assert.equal(f.row.technicalSpecifications?.sections[0].id, first.clientMutationId);
  assert.equal(f.row.technicalSpecifications?.sections[0].value, "");
});

test("manual writes filter old custom/source data, retain raw description and roll back with audit", async () => {
  const f = fixture();
  f.row.technicalSpecifications = {
    sections: [body, custom], description: "Запрет", size: "100×120", note: "Запрет", sourceGeneration: 0,
  };
  assert.equal((await f.mutate(entry("body", body.id, "", "Дуб"))).kind, "saved");
  assert.deepEqual(f.row.technicalSpecifications, {
    sections: [{ ...body, value: "Дуб" }], description: null, size: null, note: null, sourceGeneration: 0,
  });
  assert.equal((await f.mutate({ productId: f.row.id, clientMutationId: randomUUID(), field: "description", expectedValue: f.description, value: "Поздно" })).kind, "conflict");
  assert.equal((await updateProductCore(manager, f.row.id, { description: "Поздно" }, { description: f.description }, f.transaction)).ok, false);
  const unchanged = entry("body", body.id, "Дуб", "Дуб");
  const noop = await f.mutate(unchanged);
  assert.equal(noop.kind === "saved" && noop.noOp, true);
  assert.deepEqual(await f.mutate(unchanged), { ...noop, repeated: true });
  assert.equal(f.logs.at(-1)?.action, "inline.receipt");
  f.failAudit();
  const baseline = structuredClone(f.row);
  assert.equal((await f.mutate(entry("body", body.id, "Дуб", "Ясень"))).kind, "failure");
  assert.deepEqual(f.row, baseline);
});

test("engineer rights are checked again under lock before replay; field redaction masks both formats", async () => {
  const f = fixture();
  const request = entry("body", null, "", "Дуб");
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

test("identity and source generation prevent ABA without silently rebasing old drafts", async () => {
  const f = fixture();
  const first = entry("body", null, "", "Дуб");
  assert.equal((await f.mutate(first)).kind, "saved");
  const stale = entry("body", first.clientMutationId, "Дуб", "Поздно");
  f.row.technicalSpecifications!.sections[0].id = randomUUID();
  const changedIdentity = await f.mutate(stale);
  assert.equal(changedIdentity.kind, "conflict");
  assert.equal("currentValue" in changedIdentity && changedIdentity.currentValue !== undefined, false);
  f.row.technicalSpecifications!.sections[0].id = first.clientMutationId;
  f.row.technicalSpecifications!.sourceGeneration = 1;
  assert.equal((await f.mutate(stale)).kind, "conflict");
  const replay = await f.mutate(first);
  assert.equal(replay.kind === "saved" && replay.repeated, true);
  assert.equal(f.row.technicalSpecifications!.sections[0].value, "Дуб");
});

test("obsolete arbitrary/source writers and new-product source payloads are rejected before the transaction", async () => {
  for (const field of ["technicalSpecificationAdd", "technicalSpecificationRemove", "technicalSpecificationValue", "technicalSpecificationSource"]) {
    assert.equal(productPatchSchema.safeParse({ ...identity(), field, value: "Лишнее", expectedValue: null }).success, false);
  }
  const base = { projectId: "project", title: "Изделие" };
  const empty = { sections: [], description: null, size: null, note: null, sourceGeneration: 0 };
  assert.equal(createSchema.safeParse({ ...base, technicalSpecifications: empty }).success, true);
  assert.equal(createSchema.safeParse({ ...base, technicalSpecifications: { ...empty, note: "Лишнее" } }).success, false);
  assert.equal(createSchema.safeParse({ ...base, technicalSpecifications: { ...empty, sections: [custom] } }).success, false);
});
