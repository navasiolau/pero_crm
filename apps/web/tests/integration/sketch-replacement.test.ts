import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { authorizeProductCoverUpload, persistUploadedProductCover, deleteProductSketchCore, bindProductSketchCore, setProductCoverCore } from "../../src/server/products/cover-core";
import { nativeSnapshot } from "../helpers/native-acceptance-snapshot";
import test from "node:test";
import sharp from "sharp";
import { acceptedSketch, createHttpS3Fixture } from "./http-s3.fixture";

// Текущий accepted spec engineer-sketch-replacement-regression: вытесненный sketch удаляется,
// отдельные вложения, соседние ключи и редактируемые поля сохраняются.
test("media.sketch: настоящие upload, receipts, CAS, аудит и exact-version cleanup", { timeout: 180_000 }, async t => {
  const f = await createHttpS3Fixture("sketch-replacement"); t.after(() => f.dispose());
  const manager = await f.user("manager", ["MANAGER"]), engineer = await f.user("engineer", ["ENGINEER"]);
  const participant = await f.user("participant", ["ENGINEER"]), foreign = await f.user("foreign", ["ENGINEER"]);
  const disabled = await f.user("disabled", ["MANAGER"], { active: false }), optedOut = await f.user("opted-out", ["ADMIN"]);
  await f.user("office", ["DIRECTOR"]); await f.user("worker", ["WORKER"]);
  for (const actor of [manager, engineer, participant, foreign]) await f.session(actor);
  await f.db.notificationPreference.create({ data: { userId: optedOut.id, type: "file.added", enabled: false } });
  const preference = await f.db.userPreference.create({ data: { userId: engineer.id, key: "product.tab", value: "files" } });
  const project = await f.project("sketch", { managerId: manager.id, stage: "CONTRACT", currency: "BYN", initialPrice: "543.21",
    delivery: "5.67", unloading: "1.23", installation: "9.87", address: "Контрольный адрес" });
  const product = await f.product("sketch", project.id, { engineerId: engineer.id, status: "DESIGN", expectedPrice: "10.01",
    initialPrice: "123.45", quantity: 3, description: "Контрольное техническое описание" });
  const config = await f.db.productPercentageConfig.create({ data: { id: f.id("engineering-config"), productId: product.id, kind: "ENGINEERING", ratePercent: null } });
  await f.db.productPercentageParticipant.create({ data: { id: f.id("engineering-participant"), configId: config.id, userId: participant.id, shareUnits: 1 } });
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#224466" } }).png().toBuffer();
  const otherPng = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#882244" } }).png().toBuffer();
  const names = new Set<string>(), history = new Set<string>();
  const input = (label: string, expectedSketchFileId?: string | null, clientMutationId = randomUUID()) => ({ projectId: project.id,
    productId: product.id, fileName: `${f.target.runId}-${f.target.attempt}-${label}.png`, bytes: png, expectedSketchFileId, clientMutationId });
  const accept = (reply: Awaited<ReturnType<typeof f.upload>>, upload: ReturnType<typeof input>) => {
    const id = acceptedSketch(reply, upload.clientMutationId); history.add(id); names.add(upload.fileName); return id;
  };
  const snapshot = async () => ({
    product: await f.db.product.findUniqueOrThrow({ where: { id: product.id } }),
    files: await f.db.file.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
    logs: await f.db.changeLog.findMany({ where: { entityId: { in: [product.id, ...history] } }, orderBy: { id: "asc" } }),
    events: await f.db.domainEvent.findMany({ where: { type: "file.sketch-obsolete", payload: { path: ["productId"], equals: product.id } }, orderBy: { id: "asc" } }),
    notifications: await f.db.notification.findMany({ where: { type: "file.added", link: `/products/${product.id}` }, orderBy: { id: "asc" } }),
    versions: await f.versions(project.id),
  });
  const expectedRecipients = async (actorId: string) => {
    const office = await f.db.user.findMany({ where: { active: true, roles: { hasSome: ["ADMIN", "DIRECTOR", "MANAGER", "PROCUREMENT"] } }, select: { id: true } });
    const off = await f.db.notificationPreference.findMany({ where: { type: "file.added", enabled: false }, select: { userId: true } });
    return office.map(row => row.id).filter(id => id !== actorId && !off.some(row => row.userId === id)).sort();
  };
  const assertNotifications = async (fileName: string, actorId: string) => {
    const rows = await f.db.notification.findMany({ where: { type: "file.added", body: fileName, link: `/products/${product.id}` } });
    assert.ok(rows.length <= 200); assert.deepEqual(rows.map(row => row.userId).sort(), await expectedRecipients(actorId));
    assert.ok(rows.every(row => ![disabled.id, optedOut.id, foreign.id, participant.id].includes(row.userId)));
  };
  const unchangedFields = ({ sketchFileId: _sketch, updatedAt: _updated, ...fields }: typeof product) => { void _sketch; void _updated; return fields; };

  const attachmentUpload = input("attachment");
  const ordinary = await f.upload(manager, attachmentUpload); assert.equal(ordinary.response.status, 200); assert.equal(ordinary.body.ok, true);
  assert.equal(typeof ordinary.body.id, "string"); assert.equal(ordinary.body.clientMutationId, attachmentUpload.clientMutationId);
  const attachmentId = ordinary.body.id!; history.add(attachmentId); names.add(attachmentUpload.fileName);
  const attachment = await f.db.file.findUniqueOrThrow({ where: { id: attachmentId } });
  const attachmentKeys = [`${project.id}/${attachment.storedName}`, `${project.id}/thumbs/${attachment.storedName}.jpg`];
  const attachmentVersions = (await f.versions(project.id)).filter(row => attachmentKeys.includes(row.key));
  await assertNotifications(attachmentUpload.fileName, manager.id);
  await t.test("media.upload-nonce: ordinary replay без effects; changed bytes409", async () => {
    const before = await snapshot(); const replay = await f.upload(manager, attachmentUpload);
    assert.equal(replay.response.status, 200); assert.equal(replay.body.id, attachmentId); assert.equal(replay.body.repeated, true);
    assert.deepEqual(await snapshot(), before);
    const changed = await f.upload(manager, { ...attachmentUpload, bytes: otherPng }); assert.equal(changed.response.status, 409);
    assert.deepEqual(await snapshot(), before);
    const receipt = await f.db.changeLog.findUniqueOrThrow({ where: { id: `file-upload:${attachmentUpload.clientMutationId}` } });
    assert.equal(receipt.entityId, attachmentId); assert.equal(receipt.actorId, manager.id); assert.equal(receipt.action, "create");
  });
  const initialUpload = input("initial", null), initial = await f.upload(manager, initialUpload);
  let pointer = accept(initial, initialUpload);
  await assertNotifications(initialUpload.fileName, manager.id);
  const old = await f.db.file.findUniqueOrThrow({ where: { id: pointer } });
  const oldKeys = [`${project.id}/${old.storedName}`, `${project.id}/thumbs/${old.storedName}.jpg`], neighbors = oldKeys.map(key => `${key}.neighbor`);
  for (const key of oldKeys) {
    const bytes = await f.get(key); await f.put(key, bytes, key === oldKeys[0] ? "image/png" : "image/jpeg");
    await f.deleteMarker(key); await f.put(key, bytes, key === oldKeys[0] ? "image/png" : "image/jpeg");
  }
  for (const key of neighbors) await f.put(key, Buffer.from("own prefix neighbor"), "application/octet-stream");
  const oldVersions = await f.versions(project.id), neighborVersions = oldVersions.filter(row => neighbors.includes(row.key));
  assert.ok(oldKeys.every(key => oldVersions.filter(row => row.key === key && !row.marker).length === 3));
  assert.ok(oldKeys.every(key => oldVersions.some(row => row.key === key && row.marker)));
  let successfulCovers = 1;
  const replace = async (actor: typeof engineer, label: string) => {
    const upload = input(label, pointer), reply = await f.upload(actor, upload); pointer = accept(reply, upload); successfulCovers++;
    await assertNotifications(upload.fileName, actor.id); return { upload, id: pointer };
  };
  let assigned!: Awaited<ReturnType<typeof replace>>;
  await t.test("media.replacement: ENGINEER удаляет только старый sketch со всеми versions/markers; audit сохранён", async () => {
    const page = await f.request(`/products/${product.number}`, engineer); assert.equal(page.status, 200); assert.match(await page.text(), /Заменить изображение/);
    assigned = await replace(engineer, "assigned");
    assert.equal(await f.db.file.findUnique({ where: { id: old.id } }), null);
    const versions = await f.versions(project.id); assert.ok(!versions.some(row => oldKeys.includes(row.key)));
    assert.deepEqual(versions.filter(row => neighbors.includes(row.key)), neighborVersions);
    const event = await f.db.domainEvent.findUniqueOrThrow({ where: { id: `sketch-cleanup:${assigned.upload.clientMutationId}` } });
    assert.equal(event.type, "file.sketch-obsolete"); assert.ok(event.processedAt); assert.equal(event.queueAttempts, 1);
    assert.deepEqual(event.payload, { projectId: project.id, productId: product.id, fileId: old.id, storedName: old.storedName,
      newFileId: assigned.id, clientMutationId: assigned.upload.clientMutationId });
    const logs = (await snapshot()).logs;
    assert.equal(logs.filter(row => row.entityId === old.id && row.action === "delete").length, 1);
    assert.equal(logs.filter(row => row.entityId === attachmentId && row.action === "delete").length, 0);
  });
  await t.test("media.replay-CAS: nonce noop, stale и foreign контексты не меняют winning file", async () => {
    const before = await snapshot(); const replay = await f.upload(engineer, assigned.upload);
    assert.equal(accept(replay, assigned.upload), assigned.id); assert.equal(replay.body.repeated, true); assert.deepEqual(await snapshot(), before);
    const stale = await f.upload(engineer, input("stale", old.id)); assert.equal(stale.response.status, 409); assert.equal(stale.body.kind, "conflict");
    const denied = await f.upload(foreign, input("foreign", pointer)); assert.equal(denied.response.status, 404);
    const anonymous = await f.upload(undefined, input("anonymous", pointer)); assert.equal(anonymous.response.status, 401);
    assert.deepEqual(await snapshot(), before);
    const foreignProject = await f.project("wrong-context");
    const mismatch = await f.upload(engineer, { ...input("wrong-context", pointer), projectId: foreignProject.id }); assert.equal(mismatch.response.status, 404);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test("media.current-grants: ENGINEERING participant, legacy author и PRODUCTION read/write границы", async () => {
    await f.db.product.update({ where: { id: product.id }, data: { engineerId: null } });
    const before = await snapshot(); assert.equal((await f.upload(engineer, input("unassigned", pointer))).response.status, 404); assert.deepEqual(await snapshot(), before);
    await replace(participant, "participant"); await f.db.product.update({ where: { id: product.id }, data: { engineerId: engineer.id } });
    const legacy = pointer; await f.db.file.update({ where: { id: legacy }, data: { uploadedById: null } });
    await replace(engineer, "legacy"); assert.equal(await f.db.file.findUnique({ where: { id: legacy } }), null);
    await f.db.product.update({ where: { id: product.id }, data: { status: "PRODUCTION" } });
    const production = await snapshot(), read = await f.request(`/api/files/${pointer}`, engineer); assert.equal(read.status, 200); assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
    assert.equal((await f.upload(engineer, input("production", pointer))).response.status, 404); assert.deepEqual(await snapshot(), production);
    await f.db.product.update({ where: { id: product.id }, data: { status: "DESIGN" } });
  });
  await t.test("media.concurrent: два разных CAS дают одного winner; один nonce даёт один receipt", async () => {
    const left = input("race-left", pointer), right = input("race-right", pointer);
    const competing = await Promise.all([f.upload(engineer, left), f.upload(participant, right)]);
    assert.deepEqual(competing.map(reply => reply.response.status).sort(), [200, 409]);
    const winner = competing.findIndex(reply => reply.response.status === 200); pointer = accept(competing[winner], winner === 0 ? left : right); successfulCovers++;
    await assertNotifications(winner === 0 ? left.fileName : right.fileName, winner === 0 ? engineer.id : participant.id);
    const duplicate = input("duplicate", pointer), replies = await Promise.all([f.upload(engineer, duplicate), f.upload(engineer, duplicate)]);
    const ids = replies.map(reply => accept(reply, duplicate)); assert.equal(ids[0], ids[1]); assert.equal(replies.filter(reply => reply.body.repeated).length, 1);
    pointer = ids[0]; successfulCovers++; await assertNotifications(duplicate.fileName, engineer.id);
    const before = await snapshot(); const superseded = await f.upload(engineer, assigned.upload);
    assert.equal(superseded.response.status, 409); assert.equal(superseded.body.kind, "conflict"); assert.deepEqual(await snapshot(), before);
    await f.rollback(async tx => {
      const current = await tx.file.findUniqueOrThrow({ where: { id: pointer } }), actor = { ...manager, source: "web" as const };
      const target = { productId: product.id, projectId: project.id, expectedSketchFileId: pointer, clientMutationId: randomUUID() };
      const image = { fileName: "separate.png", storedName: randomUUID() + ".png", mimeType: "image/png", size: png.length,
        hasThumb: true, uploadedById: manager.id, contentHash: createHash("sha256").update(png).digest("hex") };
      const alias = await tx.file.create({ data: { projectId: project.id, productId: product.id, fileName: "alias.png", storedName: current.storedName,
        mimeType: "image/png", size: png.length, hasThumb: true, uploadedById: manager.id } });
      let stable = await nativeSnapshot(tx);
      assert.equal((await authorizeProductCoverUpload(tx, actor, target)).ok, false);
      assert.equal((await persistUploadedProductCover(tx, actor, target, image)).ok, false);
      assert.deepEqual(await nativeSnapshot(tx), stable); await tx.file.delete({ where: { id: alias.id } });
      await tx.project.update({ where: { id: project.id }, data: { coverFileId: pointer } }); stable = await nativeSnapshot(tx);
      assert.equal((await persistUploadedProductCover(tx, actor, target, image)).ok, false); assert.deepEqual(await nativeSnapshot(tx), stable);
      await tx.project.update({ where: { id: project.id }, data: { coverFileId: null } }); stable = await nativeSnapshot(tx);
      assert.equal((await persistUploadedProductCover(tx, actor, target, { ...image, storedName: current.storedName })).ok, false);
      assert.equal((await setProductCoverCore(tx, actor, product.id, pointer)).ok, false); assert.deepEqual(await nativeSnapshot(tx), stable);
      for (const operation of ["bind", "delete"] as const) {
        await tx.$executeRawUnsafe("SAVEPOINT ci169_sketch_receipt");
        try {
        await tx.product.update({ where: { id: product.id }, data: { sketchFileId: operation === "bind" ? null : pointer } });
        const nonce = randomUUID(), bind = { productId: product.id, fileId: pointer, expectedSketchFileId: null, clientMutationId: nonce };
        const remove = { productId: product.id, expectedSketchFileId: pointer, clientMutationId: nonce };
        const first = operation === "bind" ? await bindProductSketchCore(tx, actor, bind) : await deleteProductSketchCore(tx, actor, remove);
        assert.equal(first.ok, true);
        const upload = await persistUploadedProductCover(tx, actor, { ...target, expectedSketchFileId: operation === "bind" ? pointer : null, clientMutationId: randomUUID() },
          { ...image, storedName: randomUUID() + ".png" }); assert.equal(upload.ok, true); stable = await nativeSnapshot(tx);
        const replay = operation === "bind" ? await bindProductSketchCore(tx, actor, bind) : await deleteProductSketchCore(tx, actor, remove);
        assert.equal(replay.ok, false); if (!replay.ok) { assert.equal(replay.kind, "conflict"); assert.equal(replay.currentSketchFileId, upload.ok && upload.id); }
        assert.deepEqual(await nativeSnapshot(tx), stable);
        } finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ci169_sketch_receipt"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT ci169_sketch_receipt"); }
      }
      await tx.product.update({ where: { id: product.id }, data: { sketchFileId: null } });
      const input = { productId: product.id, expectedSketchFileId: pointer, clientMutationId: randomUUID() };
      const result = { ok: true, sketchFileId: null, clientMutationId: input.clientMutationId,
        storageIntent: { projectId: project.id, storedName: current.storedName, hasThumb: current.hasThumb } };
      await tx.changeLog.create({ data: { id: "product-sketch:" + input.clientMutationId, actorType: "user", actorId: manager.id, entity: "product", entityId: product.id,
        action: "cover.delete.receipt", newValue: { fingerprint: createHash("sha256").update(JSON.stringify({ operation: "delete", ...input })).digest("hex"), result } } });
      stable = await nativeSnapshot(tx); assert.deepEqual(await deleteProductSketchCore(tx, actor, input), { ...result, repeated: true });
      assert.deepEqual(await nativeSnapshot(tx), stable);
    });
  });
  const after = await snapshot(); assert.equal(after.product.sketchFileId, pointer);
  assert.deepEqual(unchangedFields(after.product), unchangedFields(product)); assert.deepEqual(await f.db.project.findUnique({ where: { id: project.id } }), project);
  assert.deepEqual(await f.db.file.findUnique({ where: { id: attachmentId } }), attachment);
  assert.deepEqual(after.versions.filter(row => attachmentKeys.includes(row.key)), attachmentVersions);
  assert.deepEqual(after.versions.filter(row => neighbors.includes(row.key)), neighborVersions);
  assert.deepEqual(await f.db.userPreference.findUnique({ where: { userId_key: { userId: engineer.id, key: "product.tab" } } }), preference);
  assert.equal(after.logs.filter(row => row.action === "cover.upload").length, successfulCovers);
  assert.equal(after.logs.filter(row => row.action === "cover.change").length, successfulCovers);
  assert.equal(after.events.length, successfulCovers - 1); assert.ok(after.events.every(row => row.processedAt && row.queueAttempts === 1));
  assert.ok(after.notifications.every(row => names.has(row.body!)));
  const expectedKeys = [...neighbors, ...after.files.flatMap(row => [`${project.id}/${row.storedName}`, ...(row.hasThumb ? [`${project.id}/thumbs/${row.storedName}.jpg`] : [])])].sort();
  assert.deepEqual(after.versions.filter(row => row.latest && !row.marker).map(row => row.key).sort(), expectedKeys, "Нет активных S3 orphan после конкуренции и replay");
  for (const row of after.files) assert.deepEqual(await f.get(`${project.id}/${row.storedName}`), png);
  await f.verifyProtected();
});
