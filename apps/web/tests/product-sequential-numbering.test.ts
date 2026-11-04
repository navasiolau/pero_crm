import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createProductCore, deleteProductCore } from "../src/server/products/core";
import { proposalFixture } from "./helpers/kp-proposal-fixture";

const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
function fixture(number = "1", count = 0) {
  const f = proposalFixture();
  f.state.projects.push({ id: "project", number, numberInt: Number(number), stage: "CONTRACT", currency: "BYN", deletedAt: null });
  for (let suffix = 1; suffix <= count; suffix++) f.state.products.push({
    id: `p${suffix}`, projectId: "project", number: `${number}.${suffix}`, suffixInt: suffix,
    title: `Изделие ${suffix}`, quantity: 5, status: "PREPARATION", deletedAt: null,
    createdAt: new Date(suffix), updatedAt: new Date(0),
  });
  return f;
}
const liveNumbers = (f: ReturnType<typeof fixture>) => f.state.products.filter(row => row.projectId === "project" && !row.deletedAt)
  .sort((a, b) => Number(a.suffixInt) - Number(b.suffixInt)).map(row => row.number);

test("новое после 14 действующих и удалённого .63 получает .15", async () => {
  const f = fixture("1", 14);
  f.state.products.push({ id: "deleted", projectId: "project", number: "1.63", suffixInt: 63, deletedAt: new Date(0) });
  const removed = structuredClone(f.state.products[14]);
  const result = await createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction);
  assert.ok(result.ok); assert.equal(result.product.number, "1.15"); assert.equal(result.product.suffixInt, 15);
  assert.deepEqual(f.state.products.find(row => row.id === "deleted"), removed);
});

test("пустой действующий состав начинает с .1 в каждом проекте", async () => {
  for (const number of ["1", "205"]) {
    const f = fixture(number);
    f.state.products.push({ id: "deleted", projectId: "project", number: `${number}.99`, suffixInt: 99, deletedAt: new Date(0) });
    const result = await createProductCore(actor, { projectId: "project", title: "Первое", quantity: 100 }, f.transaction);
    assert.ok(result.ok); assert.equal(result.product.number, `${number}.1`);
  }
});

test("создание устраняет прежние пропуски и сохраняет числовой порядок", async () => {
  const f = fixture("1", 3); f.state.products[1].number = "1.9"; f.state.products[1].suffixInt = 9;
  const result = await createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction);
  assert.ok(result.ok); assert.equal(result.product.number, "1.4");
  assert.deepEqual(liveNumbers(f), ["1.1", "1.2", "1.3", "1.4"]);
  assert.equal(f.state.products.find(row => row.id === "p3")?.number, "1.2");
  assert.equal(f.state.products.find(row => row.id === "p2")?.number, "1.3");
});

test("удаление седьмого из пятнадцати сдвигает только последующие, повтор не сдвигает снова", async () => {
  const f = fixture("1", 15), before = structuredClone(f.state.products);
  const baseline = { expectedUpdatedAt: new Date(0).toISOString(), clientMutationId: randomUUID() };
  const result = await deleteProductCore(actor, "p7", f.transaction, baseline); assert.ok(result.ok);
  assert.deepEqual(liveNumbers(f), Array.from({ length: 14 }, (_, i) => `1.${i + 1}`));
  for (let suffix = 1; suffix <= 15; suffix++) {
    const row = f.state.products.find(row => row.id === `p${suffix}`)!;
    assert.equal(row.number, `1.${suffix > 7 ? suffix - 1 : suffix}`);
    assert.equal(row.quantity, 5); assert.equal(row.status, "PREPARATION");
    if (suffix < 7) assert.deepEqual(row, before[suffix - 1]);
  }
  const after = f.cloneState(); const repeat = await deleteProductCore(actor, "p7", f.transaction, baseline);
  assert.ok(repeat.ok && repeat.repeated); assert.deepEqual({ ...f.state, sql: [] }, { ...after, sql: [] });
  const created = await createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction);
  assert.ok(created.ok); assert.equal(created.product.number, "1.15");
});

test("удаление первого, последнего и единственного не оставляет пропусков", async () => {
  for (const [count, removed] of [[3, 1], [3, 3], [1, 1]]) {
    const f = fixture("205", count);
    const result = await deleteProductCore(actor, `p${removed}`, f.transaction, { expectedUpdatedAt: new Date(0).toISOString(), clientMutationId: randomUUID() });
    assert.ok(result.ok); assert.deepEqual(liveNumbers(f), Array.from({ length: count - 1 }, (_, i) => `205.${i + 1}`));
    const created = await createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction);
    assert.ok(created.ok); assert.equal(created.product.number, `205.${count}`);
  }
});

test("ошибка аудита откатывает скрытие и все сдвиги; отказ создания не нормализует состав", async () => {
  const f = fixture("1", 3), before = f.cloneState();
  const audit = f.tx.changeLog.create;
  f.tx.changeLog.create = () => { throw Error("NUMBER_AUDIT_FAILED"); };
  const deletion = await deleteProductCore(actor, "p1", f.transaction, { expectedUpdatedAt: new Date(0).toISOString(), clientMutationId: randomUUID() });
  assert.ok(!deletion.ok && deletion.kind === "failure"); assert.deepEqual(f.state, before);
  f.tx.changeLog.create = audit;
  f.state.products[1].number = "1.9"; f.state.products[1].suffixInt = 9;
  const snapshot = f.cloneState();
  assert.equal((await createProductCore(actor, { projectId: "project", title: "" }, f.transaction)).ok, false);
  assert.deepEqual(f.state, snapshot);
  f.tx.changeLog.create = () => { throw Error("NUMBER_AUDIT_FAILED"); };
  await assert.rejects(createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction), /NUMBER_AUDIT_FAILED/);
  assert.deepEqual(f.state, snapshot);
});

test("равные и пустые суффиксы разрешаются по дате и ID, другие проекты не меняются", async () => {
  const f = fixture("1", 3);
  f.state.products[0].suffixInt = null;
  f.state.products[1].suffixInt = 2; f.state.products[1].createdAt = new Date(0);
  f.state.products[2].suffixInt = 2; f.state.products[2].createdAt = new Date(0);
  const foreign = { id: "other", projectId: "foreign", number: "2.99", suffixInt: 99, deletedAt: null };
  f.state.products.push(foreign);
  const result = await createProductCore(actor, { projectId: "project", title: "Новое" }, f.transaction);
  assert.ok(result.ok); assert.equal(result.product.number, "1.4");
  assert.equal(f.state.products.find(row => row.id === "p2")?.number, "1.1");
  assert.equal(f.state.products.find(row => row.id === "p3")?.number, "1.2");
  assert.equal(f.state.products.find(row => row.id === "p1")?.number, "1.3");
  assert.deepEqual(f.state.products.find(row => row.id === "other"), foreign);
});
