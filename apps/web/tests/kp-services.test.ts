import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectServiceControllers } from "../src/lib/project-service-controllers";
import { projectServicePatch, ProjectServicesConflict, type ProjectServiceSnapshot } from "../src/lib/project-services";
import { projectTotal, projectTotalText } from "../src/lib/product-quantity";
import { confirmedProjectTotal, projectSubtotalFromProjection } from "../src/lib/project-inline-values";
import type { ProjectPatch, ProjectPatchResult } from "../src/server/projects/patch-contract";

const empty: ProjectServiceSnapshot = { servicesTotal: null, delivery: null, unloading: null, installation: null };
const general: ProjectServiceSnapshot = { ...empty, servicesTotal: "100.00" };
const split: ProjectServiceSnapshot = { ...empty, delivery: "10.00", unloading: "20.00", installation: "30.00" };

test("старые суммы сохранены, общие услуги и подписанная поправка учитываются ровно один раз", () => {
  const products = [{ expectedPrice: "0.10", quantity: 3 }];
  assert.equal(projectTotal(products, { delivery: "1.00", unloading: "2.00", installation: "3.00" }), 6.3);
  assert.equal(projectTotalText(products, { ...general, proposalRoundingAdjustment: "-0.01" }), "100.29");
  assert.equal(projectTotalText(products, { ...empty, servicesTotal: "0.00", proposalRoundingAdjustment: "0.01" }), "0.31");
  assert.equal(confirmedProjectTotal("0.30", ["100.00", null, null, null], "-0.01"), "100.29");
  assert.equal(projectSubtotalFromProjection("100.29", ["100.00", null, null, null], "-0.01"), "0.30");
  assert.throws(() => projectTotalText(products, { ...general, delivery: "1.00" }), /несовместима/);
});

test("переключение общей суммы и разбивки атомарно очищает альтернативы с полным CAS", () => {
  assert.deepEqual(projectServicePatch(split, "servicesTotal", "80.00", split), { ...empty, servicesTotal: "80.00" });
  assert.deepEqual(projectServicePatch(general, "delivery", "15.00", general), { servicesTotal: null, delivery: "15.00" });
  assert.throws(() => projectServicePatch(general, "delivery", "15.00"), ProjectServicesConflict);
  assert.throws(() => projectServicePatch({ ...split, installation: "31.00" }, "servicesTotal", "80.00", split), ProjectServicesConflict);
  assert.deepEqual(projectServicePatch(split, "delivery", "0.00"), { servicesTotal: null, delivery: "0.00" });
});

function saved(patch: ProjectPatch, version: string, snapshot: ProjectServiceSnapshot): ProjectPatchResult {
  return { kind: "saved", field: patch.field, value: patch.value, clientMutationId: patch.clientMutationId,
    derived: { ...snapshot, productsSubtotalBYN: "1.00", expectedTotalBYN: "1.00", pricingVersion: version, proposalRoundingAdjustment: "0.00" } };
}

test("параллельные изменения услуг отправляются последовательно с обновлённым CAS-снимком", async () => {
  const calls: ProjectPatch[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const group = createProjectServiceControllers("p", empty, async patch => {
    calls.push(patch);
    if (calls.length === 1) { await gate; return saved(patch, "1", { ...empty, delivery: "10.00" }); }
    return saved(patch, "2", { ...empty, delivery: "10.00", unloading: "20.00" });
  });
  group.controller("delivery").setDraft("10");
  group.controller("unloading").setDraft("20");
  const first = group.controller("delivery").commit(), second = group.controller("unloading").commit();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual("expectedServices" in calls[1] && calls[1].expectedServices, { ...empty, delivery: "10.00" });
  assert.deepEqual(group.getSnapshot(), { ...empty, delivery: "10.00", unloading: "20.00" });
});

test("потерянный ACK повторяет идентичный CAS-запрос и не откатывает новый снимок", async () => {
  const calls: ProjectPatch[] = [];
  let failed = true;
  const group = createProjectServiceControllers("p", split, async patch => {
    calls.push(patch);
    if (failed) throw Error("lost ACK");
    return saved(patch, "2", general);
  }, "1");
  group.controller("servicesTotal").setDraft("100");
  assert.equal(await group.controller("servicesTotal").commit(), false);
  group.receive({ ...empty, servicesTotal: "120.00" }, "3");
  failed = false;
  assert.equal(await group.controller("servicesTotal").retry(), true);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(group.getSnapshot().servicesTotal, "120.00");
  assert.deepEqual(group.getServerSnapshot(), split);
});

test("при смене режима соседний несохранённый ввод сохраняется", async () => {
  const group = createProjectServiceControllers("p", split, async patch => saved(patch, "2", general), "1");
  group.controller("unloading").setDraft("мой ввод");
  group.controller("servicesTotal").setDraft("100");
  assert.equal(await group.controller("servicesTotal").commit(), true);
  assert.equal(group.controller("delivery").getSnapshot().baseline, null);
  assert.equal(group.controller("unloading").getSnapshot().draft, "мой ввод");
  assert.equal(group.getSnapshot().unloading, null);
  assert.equal(await group.flush(), false);
});
