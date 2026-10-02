import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import { engineerFixture, fixtureModel } from "./helpers/visibility-fixture";

// Exercise the real action/route exports with auth, storage and audit boundaries
// injected. This file never constructs a database client or starts an HTTP server.
const require = createRequire(import.meta.url);
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier);
  const stubModule = new Module(filename);
  stubModule.filename = filename;
  stubModule.loaded = true;
  stubModule.exports = exports;
  require.cache[filename] = stubModule;
}

const fixture = engineerFixture();
let roles: Role[] = ["ENGINEER"];
const writes: string[] = [];
const storage: string[] = [];
let productActions: typeof import("../src/server/products/actions");
let taskActions: typeof import("../src/server/tasks/actions");
let timeActions: typeof import("../src/server/time/actions");
let fileActions: typeof import("../src/server/files/actions");
let fileRoute: typeof import("../src/app/api/files/[id]/route");
let uploadRoute: typeof import("../src/app/api/files/upload/route");

before(() => {
  const db = {
    ...fixture.db,
    changeLog: { create: async () => ({}) },
    product: { ...fixture.db.product, update: async ({ where }: { where: { id: string } }) => { writes.push(`product.update:${where.id}`); } },
    file: { ...fixture.db.file, delete: async () => { writes.push("file.delete"); } },
    task: { ...fixture.db.task, update: async () => { writes.push("task.update"); } },
    timeEntry: {
      ...fixtureModel([{ id: "former-timer", userId: "engineer", stoppedAt: null, taskId: "task-production", task: fixture.tasks[2], minutes: 15 }]),
      create: async () => { writes.push("time.create"); },
      update: async () => { writes.push("time.update"); },
    },
  };
  Object.assign(db, { $transaction: async (operation: (tx: typeof db) => Promise<unknown>) => operation(db), $queryRaw: async () => [{ locked: 1 }] });
  (globalThis as { prisma?: PrismaClient }).prisma = db as unknown as PrismaClient;
  inject("../src/auth", { auth: async () => ({ user: { id: "engineer", name: "Engineer", roles } }) });
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {}, notifyPerson: async () => {} });
  inject("../src/server/files/stage-config", { getFileStageConfig: async () => ({ enabled: false }) });
  inject("../src/lib/s3", {
    UPLOADS_ROOT: "never-used",
    s3Enabled: () => true,
    fileKey: (project: string, name: string) => `${project}/${name}`,
    thumbKey: (project: string, name: string) => `${project}/thumb/${name}`,
    s3Get: async (key: string) => { storage.push(`get:${key}`); return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("allowed file")); controller.close(); } }); },
    s3Put: async () => { storage.push("put"); },
    s3Delete: async () => { storage.push("delete"); },
  });
  productActions = require("../src/server/products/actions");
  taskActions = require("../src/server/tasks/actions");
  timeActions = require("../src/server/time/actions");
  fileActions = require("../src/server/files/actions");
  fileRoute = require("../src/app/api/files/[id]/route");
  uploadRoute = require("../src/app/api/files/upload/route");
});

test("real technical-block action denies foreign and former products before any mutation", async () => {
  for (const combination of [["ENGINEER"], ["ENGINEER", "ACCOUNTANT"], ["ENGINEER", "WORKER"]] as Role[][]) {
    roles = combination;
    for (const product of ["foreign", "production", "hidden-product"]) {
      assert.equal((await productActions.updateProduct(product, { description: "forbidden" }, { description: null })).ok, false);
    }
  }
  assert.deepEqual(writes, []);
  roles = ["ENGINEER"];
  assert.deepEqual(await productActions.updateProduct("own", { description: "allowed" }, { description: null }), { ok: true });
  assert.deepEqual(writes.splice(0), ["product.update:own"]);
});

test("real task and time actions reject stale hidden IDs without mutations", async () => {
  for (const combination of [["ENGINEER"], ["ENGINEER", "ACCOUNTANT"]] as Role[][]) {
    roles = combination;
    for (const taskId of ["task-foreign", "task-production"]) {
      assert.equal((await taskActions.changeTaskStatus(taskId, "IN_PROGRESS")).ok, false);
      assert.equal((await taskActions.changeTaskStatus(taskId, "DONE", 60)).ok, false);
      assert.equal((await timeActions.startTimer(taskId)).ok, false);
      assert.equal((await timeActions.addManualTime({ taskId, minutes: 60 })).ok, false);
      if (roles.length === 1) assert.equal(await timeActions.spentMinutes(taskId), 0);
    }
    assert.equal((await timeActions.stopTimer()).ok, false);
  }
  assert.deepEqual(writes, []);
});

test("hidden dependency blocks real status action without disclosing its title", async () => {
  roles = ["ENGINEER"];
  const result = await taskActions.changeTaskStatus("task-own", "IN_PROGRESS");
  assert.equal(result.ok, false);
  assert.equal(result.error, "Задача заблокирована — сначала должны быть выполнены предыдущие задачи");
  assert.deepEqual(writes, []);
});

test("real file download, thumbnail and delete deny hidden IDs before storage access", async () => {
  roles = ["ENGINEER"];
  for (const name of ["foreign", "production", "cross-task"]) {
    const id = `file-${name}`;
    for (const suffix of ["", "?thumb=1"]) {
      const response = await fileRoute.GET(new Request(`http://example.invalid/api/files/${id}${suffix}`), { params: Promise.resolve({ id }) });
      assert.equal(response.status, 404);
    }
    assert.equal((await fileActions.deleteFile(id)).ok, false);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(storage, []);
});

test("real upload route rejects task/product mismatch before storage or metadata writes", async () => {
  roles = ["ENGINEER", "ACCOUNTANT"];
  const form = new FormData();
  form.set("file", new File(["must not be stored"], "fixture.txt"));
  form.set("projectId", "mixed");
  form.set("productId", "own");
  form.set("taskId", "task-foreign");
  const response = await uploadRoute.POST(new Request("http://example.invalid/api/files/upload", { method: "POST", body: form }));
  assert.equal(response.status, 404);
  assert.deepEqual(writes, []);
  assert.deepEqual(storage, []);
});

test("accounting read grant cannot delete own historical files outside engineering stage", async () => {
  roles = ["ENGINEER", "ACCOUNTANT"];
  const target = fixture.files[2];
  target.uploadedById = "engineer";
  try {
    assert.equal((await fileActions.deleteFile(String(target.id))).ok, false);
    assert.deepEqual(writes, []);
    assert.deepEqual(storage, []);
  } finally {
    delete target.uploadedById;
  }
});

test("real upload route denies a foreign common task for engineer plus accountant", async () => {
  roles = ["ENGINEER", "ACCOUNTANT"];
  const task = { id: "common-foreign", projectId: "mixed", project: fixture.projects[0], productId: null, product: null, assigneeId: "other" };
  fixture.tasks.push(task);
  try {
    const form = new FormData();
    form.set("file", new File(["must not be stored"], "fixture.txt"));
    form.set("projectId", "mixed");
    form.set("taskId", task.id);
    const response = await uploadRoute.POST(new Request("http://example.invalid/api/files/upload", { method: "POST", body: form }));
    assert.equal(response.status, 404);
    assert.deepEqual(writes, []);
    assert.deepEqual(storage, []);
  } finally {
    fixture.tasks.splice(fixture.tasks.indexOf(task), 1);
  }
});
