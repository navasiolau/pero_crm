import assert from "node:assert/strict";
import test from "node:test";

import { canSetProductCover, validateProductCoverFile } from "../src/lib/product-cover";
import { authorizeProductCoverUpload, persistUploadedProductCover, setProductCoverCore } from "../src/server/products/cover-core";

const product = { id: "product-1", projectId: "project-1", status: "DESIGN" as const,
  engineerId: "engineer-1", sketchFileId: "old-cover" };
const image = { id: "image-1", projectId: "project-1", productId: "product-1",
  mimeType: "image/jpeg", category: "PHOTO" as const };

test("cover permission follows management precedence and own or participating DESIGN engineering", () => {
  for (const role of ["ADMIN", "DIRECTOR", "MANAGER"] as const)
    assert.equal(canSetProductCover({ id: "other", roles: [role] }, product), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER"] }, product), true);
  assert.equal(canSetProductCover({ id: "participant", roles: ["ENGINEER"],
    engineeringParticipantProductIds: [product.id] }, product), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER"] },
    { ...product, status: "PRODUCTION" }), false);
  assert.equal(canSetProductCover({ id: "other", roles: ["MANAGER", "ENGINEER"] },
    { ...product, status: "DONE" }), true);
  assert.equal(canSetProductCover({ id: "engineer-1", roles: ["ENGINEER", "ACCOUNTANT"] }, product), true,
    "Role union preserves an engineering grant");
  for (const role of ["ACCOUNTANT", "WORKER", "MOUNTER"] as const)
    assert.equal(canSetProductCover({ id: "engineer-1", roles: [role] }, product), false);
});

test("cover source must be a supported image bound to this exact product and project", () => {
  assert.equal(validateProductCoverFile(product, image), null);
  assert.match(validateProductCoverFile(product, { ...image, productId: "other-product" }) ?? "", /издел/);
  assert.match(validateProductCoverFile(product, { ...image, projectId: "other-project" }) ?? "", /проект/);
  assert.match(validateProductCoverFile(product, { ...image, mimeType: "application/octet-stream" }) ?? "", /изображ/);
  assert.match(validateProductCoverFile(product, { ...image, mimeType: "image/svg+xml" }) ?? "", /изображ/);
});

function fakeTx(initial = product, file = image) {
  const updates: unknown[] = [];
  const logs: unknown[] = [];
  const tx = {
    task: { findMany: async () => [] },
    productPercentageParticipant: { findMany: async () => [] },
    product: {
      findFirst: async () => initial,
      update: async (args: unknown) => { updates.push(args); return { ...initial, sketchFileId: file.id }; },
    },
    file: { findFirst: async () => file },
    changeLog: { create: async (args: unknown) => { logs.push(args); return { id: "log-1" }; } },
  };
  return { tx, updates, logs };
}

test("cover mutation changes only pointer and writes one audit entry; replay is idempotent", async () => {
  const { tx, updates, logs } = fakeTx();
  const actor = { id: "manager-1", name: "Менеджер", roles: ["MANAGER"] as const };
  assert.deepEqual(await setProductCoverCore(tx as never, actor as never, product.id, image.id), { ok: true });
  assert.deepEqual(updates, [{ where: { id: product.id }, data: { sketchFileId: image.id } }]);
  assert.equal(logs.length, 1);
  assert.match(JSON.stringify(logs[0]), /old-cover/);
  assert.match(JSON.stringify(logs[0]), /image-1/);
  const replay = fakeTx({ ...product, sketchFileId: image.id });
  assert.deepEqual(await setProductCoverCore(replay.tx as never, actor as never, product.id, image.id), { ok: true });
  assert.equal(replay.updates.length, 0);
  assert.equal(replay.logs.length, 0);
});

test("cover mutation rejects foreign, nonimage and unauthorized inputs before any write", async () => {
  for (const [actor, file] of [
    [{ id: "worker", roles: ["WORKER"] }, image],
    [{ id: "manager", roles: ["MANAGER"] }, { ...image, productId: "foreign" }],
    [{ id: "manager", roles: ["MANAGER"] }, { ...image, projectId: "foreign" }],
    [{ id: "manager", roles: ["MANAGER"] }, { ...image, mimeType: "application/octet-stream" }],
  ] as const) {
    const { tx, updates, logs } = fakeTx(product, file);
    const result = await setProductCoverCore(tx as never, actor as never, product.id, file.id);
    assert.equal(result.ok, false);
    assert.equal(updates.length, 0);
    assert.equal(logs.length, 0);
  }
});

test("cover upload preauthorization rejects field users and foreign project before storage work", async () => {
  const worker = fakeTx();
  const denied = await authorizeProductCoverUpload(worker.tx as never,
    { id: "worker", roles: ["WORKER"] } as never,
    { projectId: "project-1", productId: product.id });
  assert.equal(denied.ok, false);
  assert.equal(worker.updates.length, 0);
  const foreign = fakeTx();
  const wrongProject = await authorizeProductCoverUpload(foreign.tx as never,
    { id: "manager", roles: ["MANAGER"] } as never,
    { projectId: "project-2", productId: product.id });
  assert.equal(wrongProject.ok, false);
  const engineer = fakeTx();
  assert.equal((await authorizeProductCoverUpload(engineer.tx as never,
    { id: "engineer-1", roles: ["ENGINEER"] } as never,
    { projectId: "project-1", productId: product.id })).ok, true);
});

test("new PHOTO row and cover pointer share a transaction; failure leaves prior pointer", async () => {
  const calls: string[] = [];
  const auditRows: unknown[] = [];
  const tx = {
    task: { findMany: async () => [] }, productPercentageParticipant: { findMany: async () => [] },
    product: {
      findFirst: async () => product,
      update: async ({ data }: { data: { sketchFileId: string } }) => {
        calls.push(`pointer:${data.sketchFileId}`);
        return { ...product, sketchFileId: data.sketchFileId };
      },
    },
    file: { create: async ({ data }: { data: { category: string; productId: string } }) => {
      calls.push(`file:${data.category}:${data.productId}`);
      return { id: "new-image" };
    } },
    changeLog: { create: async (row: unknown) => { calls.push("audit"); auditRows.push(row); return { id: "log" }; } },
  };
  const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER"] };
  const result = await persistUploadedProductCover(tx as never, actor as never,
    { projectId: "project-1", productId: product.id }, {
      fileName: "new.jpg", storedName: "stored-new.jpg", mimeType: "image/jpeg",
      size: 1000, hasThumb: true, uploadedById: actor.id,
    });
  assert.deepEqual(result, { ok: true, id: "new-image" });
  assert.deepEqual(calls, ["file:PHOTO:product-1", "pointer:new-image", "audit", "audit"]);
  assert.match(JSON.stringify(auditRows), /old-cover/);
  assert.match(JSON.stringify(auditRows), /new-image/);
  const priorCallCount = calls.length;
  const denied = await persistUploadedProductCover(tx as never,
    { id: "worker", roles: ["WORKER"] } as never,
    { projectId: "project-1", productId: product.id }, {
      fileName: "new.jpg", storedName: "stored-new.jpg", mimeType: "image/jpeg",
      size: 1000, hasThumb: true, uploadedById: "worker",
    });
  assert.equal(denied.ok, false);
  assert.equal(calls.length, priorCallCount, "A status or permission race must reject before File.create");
  const failed = { ...tx, product: { ...tx.product, update: async () => { throw new Error("db failure"); } } };
  await assert.rejects(persistUploadedProductCover(failed as never, actor as never,
    { projectId: "project-1", productId: product.id }, {
      fileName: "new.jpg", storedName: "stored-new.jpg", mimeType: "image/jpeg",
      size: 1000, hasThumb: true, uploadedById: actor.id,
    }), /db failure/);
  assert.equal(product.sketchFileId, "old-cover", "The old File pointer is never changed in memory");
});
