// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при несовпадении guard.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import type { ProductPatchResult, ProductPatch } from "../../src/server/products/patch-contract";
import type { ProjectPatchResult, ProjectPatch } from "../../src/server/projects/patch-contract";
import type { ProjectStageResult } from "../../src/server/projects/stage-contract";
import type { FileDeleteResult } from "../../src/server/files/delete-contract";
import { nativeSnapshot } from "../helpers/native-acceptance-snapshot";
import { rejectedSql } from "./postgres.fixture";
import { assertPrivateFileHeaders, createHttpS3Fixture, type HttpActor } from "./http-s3.fixture";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function saved<T extends { kind: string }>(reply: T): Extract<T, { kind: "saved" }> {
  assert.equal(reply.kind, "saved"); return reply as Extract<T, { kind: "saved" }>;
}
type BasicReply = { ok: boolean; id?: string; error?: string; result?: null; financeState?: string };

test("files.crud: file113, документы, attachment ACL и inline-действия", { timeout: 300_000 }, async t => {
  const f = await createHttpS3Fixture("files-crud"); t.after(() => f.dispose());
  // NextURL канонизирует loopback 127.0.0.1 в localhost; протокол и порт берём из guarded CI target.
  const financeLocation = new URL("/finance", f.target.baseUrl); financeLocation.hostname = "localhost";
  const manager = await f.user("manager", ["MANAGER"]), second = await f.user("second", ["MANAGER"]);
  const engineer = await f.user("engineer", ["ENGINEER"]), foreign = await f.user("foreign", ["ENGINEER"]);
  const combined = await f.user("combined", ["MANAGER", "ENGINEER"]);
  let accountant = await f.user("accountant", ["ACCOUNTANT"]);
  const procurement = await f.user("procurement", ["PROCUREMENT"]), worker = await f.user("worker", ["WORKER"]), mounter = await f.user("mounter", ["MOUNTER"]);
  for (const actor of [manager, engineer, accountant]) await f.session(actor);
  const project = await f.project("project", { stage: "CONTRACT", currency: "BYN", managerId: manager.id, initialPrice: "123.45" });
  const product = await f.product("product", project.id, { status: "DESIGN", engineerId: engineer.id, description: "Tech", expectedPrice: "10.01", initialPrice: "123.45" });
  const sibling = await f.product("sibling", project.id, { status: "PRODUCTION", engineerId: foreign.id, expectedPrice: "10.01" });
  const productPage = `/products/${product.number}`, projectPage = `/projects/${project.id}`;
  const png = await sharp({ create: { width: 360, height: 480, channels: 3, background: "#336699" } }).png().toBuffer();
  const pdf = Buffer.from("%PDF-1.4\nowned113 document\n%%EOF"), cad = Buffer.from("owned113 synthetic B3D"), cadMime = "application/octet-stream";
  const patchProduct = (actor: HttpActor, field: ProductPatch["field"], value: unknown, expectedValue: unknown, extra: object = {}) =>
    f.action<ProductPatchResult>("patchProduct", productPage, actor, [{ productId: product.id, field, value, expectedValue, clientMutationId: randomUUID(), ...extra }]);
  const upload = async (label: string, actor = engineer, extra: { productId?: string | null; taskId?: string; section?: "GENERAL" | "MEASUREMENT" | "PRODUCTION" | "INSTALLATION"; bytes?: Uint8Array; mimeType?: string; clientMutationId?: string } = {}) => {
    const reply = await f.upload(actor, { projectId: project.id, productId: product.id, fileName: `${label}.bin`, bytes: cad,
      mimeType: cadMime, clientMutationId: randomUUID(), ...extra });
    assert.equal(reply.response.status, 200); assert.equal(reply.body.ok, true); assert.equal(typeof reply.body.id, "string");
    return f.db.file.findUniqueOrThrow({ where: { id: reply.body.id! } });
  };

  await t.test("file/ordinary-delete-cancel-audit: точный UUID, версии, сосед, replay и текущие роли", async () => {
    const uploadNonce = randomUUID(), file = await upload("ordinary", engineer, { bytes: png, mimeType: "image/png", clientMutationId: uploadNonce });
    const keys = [`${project.id}/${file.storedName}`, `${project.id}/thumbs/${file.storedName}.jpg`], neighbor = `${keys[0]}.neighbor`;
    await f.put(neighbor, cad, cadMime);
    for (const key of keys) { const bytes = await f.get(key); await f.deleteMarker(key); await f.put(key, bytes, key === keys[0] ? "image/png" : "image/jpeg"); }
    const before = await nativeSnapshot(f.db), versions = await f.versions(project.id), nonce = randomUUID();
    const retryInput = { projectId: project.id, productId: product.id, fileName: "ordinary.bin", bytes: png, mimeType: "image/png", clientMutationId: uploadNonce };
    const uploadReplay = await f.upload(engineer, retryInput); assert.equal(uploadReplay.response.status, 200); assert.equal(uploadReplay.body.id, file.id); assert.equal(uploadReplay.body.repeated, true);
    assert.equal((await f.upload(engineer, { ...retryInput, section: "GENERAL" })).response.status, 409);
    assert.deepEqual(await nativeSnapshot(f.db), before); assert.deepEqual(await f.versions(project.id), versions);
    // Отмена не отправляет deleteFile; реальный dialog/cancel остаётся в Chromium consumer.
    const kept = await f.request(`/api/files/${file.id}`, engineer); assert.equal(kept.status, 200); assert.deepEqual(Buffer.from(await kept.arrayBuffer()), png);
    assert.deepEqual(await nativeSnapshot(f.db), before); assert.deepEqual(await f.versions(project.id), versions);
    assert.equal((await f.action<FileDeleteResult>("deleteFile", productPage, foreign, [file.id, nonce])).ok, false);
    assert.equal((await f.action<FileDeleteResult>("deleteFile", productPage, engineer, [file.id, "bad"])).ok, false);
    assert.deepEqual(await nativeSnapshot(f.db), before); assert.deepEqual(await f.versions(project.id), versions);
    const deleted = await f.action<FileDeleteResult>("deleteFile", productPage, engineer, [file.id, nonce]); assert.equal(deleted.ok, true);
    if (deleted.ok) { assert.equal(deleted.fileId, file.id); assert.equal(deleted.cleanupPending, false); }
    assert.equal(await f.db.file.findUnique({ where: { id: file.id } }), null);
    // Ordinary DeleteObject скрывает текущий ключ и сохраняет историю; purge относится к obsolete sketch.
    const after = await f.versions(project.id);
    for (const key of keys) {
      const previous = versions.filter(row => row.key === key), current = after.filter(row => row.key === key);
      assert.equal(current.length, previous.length + 1);
      assert.deepEqual(current.filter(row => previous.some(old => old.versionId === row.versionId)), previous.map(row => ({ ...row, latest: false })));
      assert.equal(current.filter(row => row.latest && row.marker).length, 1); assert.ok(!current.some(row => row.latest && !row.marker));
      await assert.rejects(() => f.get(key), error => error instanceof Error && error.name === "NoSuchKey");
    }
    assert.deepEqual(after.filter(row => row.key === neighbor), versions.filter(row => row.key === neighbor)); assert.deepEqual(await f.get(neighbor), cad);
    const audit = await f.db.changeLog.findUniqueOrThrow({ where: { id: `file-delete:${nonce}` } });
    assert.equal(audit.actorId, engineer.id); assert.equal(audit.entityId, file.id); assert.equal(audit.action, "delete");
    const event = await f.db.domainEvent.findUniqueOrThrow({ where: { id: `file-delete:${nonce}` } });
    assert.equal(event.type, "file.storage-delete"); assert.ok(event.processedAt);
    assert.deepEqual((event.payload as { keys: string[] }).keys, keys);
    const replayBefore = await nativeSnapshot(f.db), replay = await f.action<FileDeleteResult>("deleteFile", productPage, engineer, [file.id, nonce]);
    assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.repeated, true); assert.deepEqual(await nativeSnapshot(f.db), replayBefore);
    assert.equal((await f.action<FileDeleteResult>("deleteFile", productPage, manager, [file.id, nonce])).ok, false);
    const other = await upload("other"); assert.equal((await f.action<FileDeleteResult>("deleteFile", productPage, engineer, [other.id, nonce])).ok, false);
    await f.db.product.update({ where: { id: product.id }, data: { status: "PRODUCTION" } });
    assert.equal((await f.action<FileDeleteResult>("deleteFile", productPage, engineer, [file.id, nonce])).ok, false);
    const original = await f.request(`/api/files/${other.id}`, engineer); assert.equal(original.status, 200); await original.arrayBuffer();
    assert.equal((await f.action<FileDeleteResult>("deleteFile", productPage, engineer, [other.id, randomUUID()])).ok, false);
    await f.db.product.update({ where: { id: product.id }, data: { status: "DESIGN" } });
  });

  await t.test("finance/linked-upload-mime-byte-ACL: реальные PDF/PNG/CAD, READY/private/linked и уникальный FK", async () => {
    const docs = [] as { id: string; key: string; bytes: Uint8Array; mime: string; name: string; nonce: string }[];
    for (const [name, mime, bytes] of [["113.pdf", "application/pdf", pdf], ["113.png", "image/png", png], ["113.b3d", cadMime, cad],
      ["inert.html", "text/html", Buffer.from("<!doctype html><p>inert</p>")], ["inert.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]] as const) {
      const nonce = randomUUID(), input = { fileName: name, mimeType: mime, bytes, clientMutationId: nonce };
      const reply = await f.financeUpload(accountant, input); assert.equal(reply.response.status, 201); assert.equal(reply.body.ok, true);
      const row = await f.db.financeDocument.findUniqueOrThrow({ where: { id: reply.body.document!.id } });
      assert.equal(row.state, "READY"); assert.ok(row.readyAt); assert.equal(row.storageMode, "s3"); assert.equal(row.contentHash, hash(bytes));
      assert.equal(row.storageKey, `finance-documents/${row.id}/${hash(bytes)}`); assert.deepEqual(await f.get(row.storageKey), bytes);
      assert.deepEqual(Object.keys(reply.body.document!).sort(), ["id", "source", "fileName", "mimeType", "size", "createdAt", "paymentId"].sort());
      const stored = await f.versions(row.storageKey), audit = await f.db.changeLog.findUniqueOrThrow({ where: { id: `finance-document:${row.id}` } });
      assert.equal(audit.actorId, accountant.id); assert.equal(audit.action, "create");
      const replay = await f.financeUpload(accountant, input); assert.equal(replay.response.status, 200); assert.equal(replay.body.document?.id, row.id); assert.equal(replay.body.repeated, true);
      for (const [who, changed] of [[accountant, { ...input, bytes: Buffer.from("changed169") }], [accountant, { ...input, fileName: "changed.bin" }], [procurement, input]] as const) {
        assert.equal((await f.financeUpload(who, changed)).response.status, 409);
      }
      assert.deepEqual(await f.versions(row.storageKey), stored); assert.deepEqual(await f.db.changeLog.findUnique({ where: { id: audit.id } }), audit);
      for (const suffix of ["", "?view=1"]) {
        const response = await f.request(`/api/finance/documents/${row.id}${suffix}`, accountant); assert.equal(response.status, 200);
        assertPrivateFileHeaders(response, mime === "image/png" || (mime === "application/pdf" && suffix) ? "inline" : "attachment");
        assert.equal(response.headers.get("content-type"), mime); assert.equal(response.headers.get("content-length"), String(bytes.length));
        assert.ok(response.headers.get("vary")?.includes("Authorization")); assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(bytes));
      }
      assert.equal((await f.request(`/api/finance/documents/${row.id}`, procurement)).status, 404);
      docs.push({ id: row.id, key: row.storageKey, bytes, mime, name, nonce });
    }
    const cash = await f.db.cashAccount.create({ data: { id: f.id("cash"), name: "CI113", currency: "BYN" } });
    const code = ((await f.db.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0) + 1;
    const article = await f.db.expenseArticle.create({ data: { id: f.id("article"), code, name: "CI113" } });
    const income = await f.db.payment.create({ data: { id: f.id("income"), projectId: project.id, cashAccountId: cash.id, createdById: accountant.id,
      direction: "INCOME", amount: 2, rate: 1, bynAmount: 2, projectAmount: 2, currency: "BYN", reportDocumentId: docs[1].id } });
    const expense = await f.db.payment.create({ data: { id: f.id("expense"), projectId: project.id, cashAccountId: cash.id, expenseArticleId: article.id,
      createdById: accountant.id, direction: "EXPENSE", amount: 1, rate: 1, bynAmount: 1, projectAmount: 1, currency: "BYN", reportDocumentId: docs[0].id } });
    for (const doc of docs.slice(0, 2)) {
      const response = await f.request(`/api/finance/documents/${doc.id}`, procurement); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), doc.bytes);
    }
    await f.rollback(async tx => {
      await rejectedSql(tx, () => tx.financeDocument.delete({ where: { id: docs[1].id } }));
      await rejectedSql(tx, () => tx.user.delete({ where: { id: accountant.id } }));
      await rejectedSql(tx, () => tx.payment.create({ data: { ...income, id: f.id("duplicate-doc"), reportDocumentId: docs[1].id } }));
      assert.equal((await tx.payment.updateMany({ where: { id: income.id, reportDocumentId: docs[1].id }, data: { reportDocumentId: docs[2].id } })).count, 1);
      assert.equal((await tx.payment.updateMany({ where: { id: expense.id, reportDocumentId: docs[0].id }, data: { reportDocumentId: docs[1].id } })).count, 1);
      for (const original of [income, expense]) {
        const now = await tx.payment.findUniqueOrThrow({ where: { id: original.id } });
        const { reportDocumentId: _a, ...before } = original, { reportDocumentId: _b, ...after } = now; void _a; void _b; assert.deepEqual(after, before);
      }
      assert.equal((await tx.payment.updateMany({ where: { id: income.id, reportDocumentId: docs[1].id }, data: { reportDocumentId: docs[0].id } })).count, 0);
    });
    assert.deepEqual(await f.db.payment.findUnique({ where: { id: income.id } }), income); assert.deepEqual(await f.db.payment.findUnique({ where: { id: expense.id } }), expense);
    try {
      // Смена роли отзывает старый JWT; ролевой 403 проверяем с актуальной версией сессии.
      const formerAccountant = await f.db.user.update({ where: { id: accountant.id }, data: { roles: ["MANAGER"] } });
      assert.equal((await f.request(`/api/finance/documents/${docs[0].id}`, formerAccountant)).status, 403);
    } finally {
      accountant = await f.db.user.update({ where: { id: accountant.id }, data: { roles: ["ACCOUNTANT"] } });
    }
    assert.equal((await f.financeUpload(manager, { fileName: "denied.pdf", mimeType: "application/pdf", bytes: pdf, clientMutationId: randomUUID() })).response.status, 403);
    assert.equal((await f.financeUpload(undefined, { fileName: "anonymous.pdf", mimeType: "application/pdf", bytes: pdf, clientMutationId: randomUUID() })).response.status, 401);
    assert.equal((await f.financeUpload(accountant, { fileName: "empty.pdf", mimeType: "application/pdf", bytes: new Uint8Array(), clientMutationId: randomUUID() })).response.status, 422);
    for (const state of ["PENDING", "READY"] as const) {
      const id = randomUUID(); await f.db.financeDocument.create({ data: { id, uploadedById: accountant.id, clientMutationId: randomUUID(),
        fileName: "missing.pdf", mimeType: "application/pdf", size: pdf.length, contentHash: hash(pdf), requestFingerprint: hash(pdf),
        storageMode: "s3", storageKey: `finance-documents/${id}/${hash(pdf)}`, state, readyAt: state === "READY" ? new Date() : null } });
      assert.equal((await f.request(`/api/finance/documents/${id}`, accountant)).status, 404);
    }
  });

  await t.test("attachments/all-groups-parent-child-ACL: project/product/task и четыре секции без скрытых детей", async () => {
    const task = await f.db.task.create({ data: { id: f.id("task"), projectId: project.id, productId: product.id, title: "CI113 task", assigneeId: engineer.id } });
    const foreignTask = await f.db.task.create({ data: { id: f.id("foreign-task"), projectId: project.id, productId: sibling.id, title: "CI113 hidden", assigneeId: foreign.id } });
    const files: Awaited<ReturnType<typeof upload>>[] = [];
    for (const section of ["GENERAL", "MEASUREMENT", "PRODUCTION", "INSTALLATION"] as const)
      files.push(await upload(`group-${section}`, engineer, { section, bytes: section === "MEASUREMENT" ? png : cad, mimeType: section === "MEASUREMENT" ? "image/png" : cadMime }));
    const taskFile = await upload("task-production", engineer, { taskId: task.id, productId: null }); assert.equal(taskFile.productId, product.id); assert.equal(taskFile.taskId, task.id);
    const projectFile = await upload("project-general", manager, { productId: null, section: "GENERAL", bytes: pdf, mimeType: "application/pdf" }); assert.equal(projectFile.productId, null);
    const hidden = await f.file("hidden-child", { projectId: project.id, productId: sibling.id }, cad, cadMime, { uploadedById: foreign.id, fileName: "hidden-child.b3d" });
    const invalid = await f.file("invalid-parent-child", { projectId: project.id, productId: product.id }, cad, cadMime, { taskId: foreignTask.id, uploadedById: engineer.id });
    const rows = await f.db.file.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }), before = await f.versions(project.id);
    for (const file of [...files, taskFile, projectFile]) { const response = await f.request(`/api/files/${file.id}`, engineer); assert.equal(response.status, 200); await response.arrayBuffer(); }
    for (const file of [hidden, invalid]) assert.equal((await f.request(`/api/files/${file.id}`, engineer)).status, 404);
    const page = await f.request(productPage, engineer); assert.equal(page.status, 200); const html = await page.text();
    for (const file of files) assert.ok(html.includes(file.fileName)); assert.ok(!html.includes(hidden.fileName));
    for (const [actor, extra, status] of [[engineer, { productId: sibling.id }, 404], [engineer, { taskId: foreignTask.id }, 404],
      [accountant, { productId: product.id }, 403], [combined, { productId: sibling.id }, 200]] as const) {
      const reply = await f.upload(actor, { projectId: project.id, productId: "productId" in extra ? extra.productId : product.id,
        taskId: "taskId" in extra ? extra.taskId : undefined, fileName: "acl.b3d", mimeType: cadMime, bytes: cad, clientMutationId: randomUUID() });
      assert.equal(reply.response.status, status);
    }
    for (const obsolete of ["category", "stage", "caption"]) {
      const form = new FormData(); form.append("file", new File([cad], "obsolete.b3d", { type: cadMime }));
      for (const [key, value] of Object.entries({ projectId: project.id, productId: product.id, section: "PRODUCTION", clientMutationId: randomUUID(), [obsolete]: "old" })) form.append(key, value);
      const response = await f.request("/api/files/upload", engineer, { method: "POST", body: form }); assert.equal(response.status, 422);
    }
    const after = await f.db.file.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { id: "asc" } }); assert.deepEqual(after, rows);
    const currentVersions = await f.versions(project.id); assert.deepEqual(currentVersions.filter(row => before.some(old => old.key === row.key)), before);
  });

  await t.test("description/raw-whitespace-noop-audit-rollback-role-CAS: create, inline и legacy сохраняют raw bytes", async () => {
    const texts = ["  A\n\tB\n\nC  \n\n", "  A\r\n\tB\r\n\r\nC  \r\n", " <script>alert(1)</script>\n**literal**  \n", " \t\r\n "];
    for (const description of texts) {
      const reply = await f.action<BasicReply>("createProduct", projectPage, manager, [{ projectId: project.id, title: "CI raw description", description,
        engineerId: engineer.id, expectedPrice: 10.01 }]); assert.equal(reply.ok, true);
      assert.equal((await f.db.product.findUniqueOrThrow({ where: { id: reply.id! } })).description, description.trim() ? description : null);
    }
    const exact = { productId: product.id, field: "description", value: texts[1], expectedValue: "Tech", clientMutationId: randomUUID() };
    assert.equal(saved(await f.action<ProductPatchResult>("patchProduct", productPage, engineer, [exact])).value, texts[1]);
    const before = await nativeSnapshot(f.db), replay = saved(await f.action<ProductPatchResult>("patchProduct", productPage, engineer, [exact]));
    assert.equal(replay.repeated, true); assert.deepEqual(await nativeSnapshot(f.db), before);
    const stale = await patchProduct(manager, "description", texts[2], texts[1].trim()); assert.equal(stale.kind, "conflict");
    if (stale.kind === "conflict") assert.equal(stale.currentValue, texts[1]);
    assert.equal((await f.action<BasicReply>("updateProduct", productPage, manager, [product.id, { description: texts[2] }, { description: texts[1] }])).ok, true);
    assert.equal((await f.db.product.findUniqueOrThrow({ where: { id: product.id } })).description, texts[2]);
    assert.equal((await f.action<BasicReply>("updateProduct", productPage, manager, [product.id, { description: texts[3] }, { description: texts[2] }])).ok, true);
    assert.equal((await f.db.product.findUniqueOrThrow({ where: { id: product.id } })).description, null);
    await f.db.product.update({ where: { id: product.id }, data: { description: texts[3] } });
    const noopBefore = await nativeSnapshot(f.db); assert.equal(saved(await patchProduct(manager, "description", texts[3], texts[3])).noOp, true);
    assert.equal((await f.action<BasicReply>("updateProduct", productPage, manager, [product.id, { description: texts[3] }, { description: texts[3] }])).ok, true);
    assert.deepEqual(await nativeSnapshot(f.db), noopBefore);
    assert.equal(saved(await patchProduct(combined, "description", texts[0], texts[3])).value, texts[0]);
    for (const actor of [worker, mounter]) { const reply = await patchProduct(actor, "description", "hidden", texts[0]); assert.equal(reply.kind, "forbidden"); assert.equal("currentValue" in reply, false); }
    const denied = await f.actionResponse("patchProduct", productPage, accountant, [exact]); assert.equal(denied.status, 302);
    assert.equal(denied.headers.get("location"), financeLocation.href);
    await f.db.product.update({ where: { id: product.id }, data: { status: "PRODUCTION" } });
    const revoked = await patchProduct(engineer, "description", "stale", texts[0]); assert.ok(["forbidden", "not-found"].includes(revoked.kind)); assert.equal("currentValue" in revoked, false);
    await f.db.product.update({ where: { id: product.id }, data: { status: "DESIGN" } });
    await f.fault("ChangeLog", manager.id, async () => {
      const snapshot = await nativeSnapshot(f.db), reply = await patchProduct(manager, "description", "  must rollback\r\n", texts[0]);
      assert.equal(reply.kind, "failure"); if (reply.kind === "failure") assert.match(reply.error, /CI169_EXPECTED_FAULT/);
      assert.deepEqual(await nativeSnapshot(f.db), snapshot);
    });
    const row = await f.db.product.findUniqueOrThrow({ where: { id: product.id } }); assert.equal(row.description, texts[0]);
    assert.equal(row.expectedPrice?.toFixed(2), "10.01"); assert.equal(row.initialPrice?.toFixed(2), "123.45"); assert.equal(row.quantity, 1);
  });

  await t.test("inline/product-field-contact-CAS-roles: одна запись, Decimal, нормы работ и issued/allocated guards", async () => {
    await f.db.product.update({ where: { id: product.id }, data: { title: "Original", description: "Tech" } });
    const work = await f.db.work.create({ data: { id: f.id("norm-work"), projectId: project.id, productId: product.id, title: "CI norm",
      quantity: "1.00", quantityPerUnit: "1.00", priceSnapshot: "0.10", total: "0.10" } });
    const title = { productId: product.id, field: "title", value: "First", expectedValue: "Original", clientMutationId: randomUUID() };
    const otherTitle = { ...title, value: "Second", clientMutationId: randomUUID() }, inputs = [title, otherTitle], actors = [manager, second];
    const concurrent = await Promise.all(inputs.map((input, index) => f.action<ProductPatchResult>("patchProduct", productPage, actors[index], [input])));
    assert.deepEqual(concurrent.map(reply => reply.kind).sort(), ["conflict", "saved"]);
    const winner = concurrent.findIndex(reply => reply.kind === "saved"); assert.equal(saved(concurrent[winner]).value, inputs[winner].value);
    const currentTitle = (await f.db.product.findUniqueOrThrow({ where: { id: product.id } })).title;
    assert.equal(currentTitle, inputs[winner].value);
    const before = await nativeSnapshot(f.db); assert.equal(saved(await patchProduct(manager, "title", currentTitle, currentTitle)).noOp, true);
    assert.deepEqual(await nativeSnapshot(f.db), before);
    assert.equal(saved(await f.action<ProductPatchResult>("patchProduct", productPage, actors[winner], [inputs[winner]])).repeated, true);
    assert.equal((await f.action<ProductPatchResult>("patchProduct", productPage, actors[winner], [{ ...inputs[winner], value: "Reuse" }])).kind, "validation");
    assert.deepEqual(await nativeSnapshot(f.db), before);
    const different = await Promise.all([patchProduct(second, "kind", "Cabinet", null), patchProduct(manager, "description", "Different field", "Tech")]);
    assert.ok(different.every(reply => reply.kind === "saved"));
    const target = await f.project("product-client"), oldClient = await f.db.client.findUniqueOrThrow({ where: { id: project.clientId } });
    const moneyBefore = await f.db.payment.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } });
    assert.equal(saved(await patchProduct(manager, "project.clientId", target.clientId, project.clientId)).value, target.clientId);
    assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: project.id } })).clientId, target.clientId);
    assert.deepEqual(await f.db.client.findUnique({ where: { id: oldClient.id } }), oldClient);
    assert.deepEqual(await f.db.payment.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }), moneyBefore);
    for (const [value, expected, confirmed] of [["0", "10.01", "0.00"], [null, "0.00", null], ["0.10", null, "0.10"]] as const)
      assert.equal(saved(await patchProduct(manager, "expectedPrice", value, expected)).value, confirmed);
    const quantity = saved(await patchProduct(manager, "quantity", 3, 1)); assert.equal(quantity.derived?.lineTotalBYN, "0.30");
    assert.equal((await patchProduct(manager, "quantity", 1.5, 3)).kind, "validation");
    const overflowBefore = await nativeSnapshot(f.db); assert.notEqual((await patchProduct(manager, "expectedPrice", "9999999999.99", "0.10")).kind, "saved");
    assert.deepEqual(await nativeSnapshot(f.db), overflowBefore);
    const updatedWork = await f.db.work.findUniqueOrThrow({ where: { id: work.id } }); assert.equal(updatedWork.quantity.toFixed(2), "3.00"); assert.equal(updatedWork.total?.toFixed(2), "0.30");
    const task = await f.db.task.create({ data: { id: f.id("allocated-task"), projectId: project.id, productId: product.id, workId: work.id, title: "CI allocated", quantity: "2.00" } });
    const allocated = await nativeSnapshot(f.db); assert.notEqual((await patchProduct(manager, "quantity", 1, 3)).kind, "saved"); assert.deepEqual(await nativeSnapshot(f.db), allocated);
    await f.db.task.update({ where: { id: task.id }, data: { quantity: "1.00" } });
    const material = await f.db.material.create({ data: { id: f.id("material"), name: "CI issued material" } });
    await f.db.projectMaterial.create({ data: { id: f.id("project-material"), productId: product.id, materialId: material.id, quantity: "3.000", quantityPerUnit: "1.000", issuedQty: "2.000" } });
    const issued = await nativeSnapshot(f.db); assert.notEqual((await patchProduct(manager, "quantity", 1, 3)).kind, "saved"); assert.deepEqual(await nativeSnapshot(f.db), issued);
    assert.equal((await patchProduct(engineer, "title", "Hidden", currentTitle)).kind, "forbidden");
    assert.equal(saved(await patchProduct(combined, "title", "Combined", currentTitle)).value, "Combined");
    assert.equal((await patchProduct(foreign, "description", "Hidden", "wrong")).kind, "not-found");
    assert.equal((await f.action<BasicReply>("updateProduct", productPage, manager, [product.id, { title: "Bypass" }])).ok, false);
    await f.fault("ChangeLog", manager.id, async () => {
      const snapshot = await nativeSnapshot(f.db), reply = await patchProduct(manager, "title", "Must rollback", "Combined");
      assert.equal(reply.kind, "failure"); if (reply.kind === "failure") assert.match(reply.error, /CI169_EXPECTED_FAULT/); assert.deepEqual(await nativeSnapshot(f.db), snapshot);
    });
    const unchanged = await f.db.product.findUniqueOrThrow({ where: { id: product.id } }); assert.equal(unchanged.quantity, 3);
    assert.equal(unchanged.expectedPrice?.toFixed(2), "0.10"); assert.equal(unchanged.initialPrice?.toFixed(2), "123.45");
    assert.equal(await f.db.productStatusHistory.count({ where: { productId: product.id } }), 0); assert.equal(await f.db.payrollEntry.count({ where: { productId: product.id } }), 0);
  });

  await t.test("inline/project-field-atomic-roles-history: поля, shared Client, Decimal total и история статуса", async () => {
    const own = await f.project("inline-project", { stage: "LEAD", currency: "BYN", initialPrice: "123.45", managerId: manager.id });
    await f.db.project.update({ where: { id: own.id }, data: { title: "Original project" } });
    await f.db.client.update({ where: { id: own.clientId }, data: { phone: "100" } });
    const products = [await f.product("inline-a", own.id, { status: "DESIGN", expectedPrice: "10.01", initialPrice: "5.55", engineerId: engineer.id }),
      await f.product("inline-b", own.id, { status: "DESIGN", expectedPrice: "10.01", initialPrice: "5.55", engineerId: engineer.id })];
    const page = `/projects/${own.id}`, call = (actor: HttpActor, field: ProjectPatch["field"], value: unknown, expectedValue: unknown, extra: object = {}) =>
      f.action<ProjectPatchResult>("patchProject", page, actor, [{ projectId: own.id, field, value, expectedValue, clientMutationId: randomUUID(), ...extra }]);
    const title = { projectId: own.id, field: "title", value: "First title", expectedValue: "Original project", clientMutationId: randomUUID() };
    assert.equal(saved(await f.action<ProjectPatchResult>("patchProject", page, manager, [title])).value, "First title");
    assert.equal((await call(second, "title", "Other title", "Original project")).kind, "conflict");
    assert.equal(saved(await call(second, "address", "Shared address", null)).value, "Shared address");
    const noopBefore = await nativeSnapshot(f.db); assert.equal(saved(await call(manager, "title", "First title", "First title")).noOp, true);
    assert.equal(saved(await f.action<ProjectPatchResult>("patchProject", page, manager, [title])).repeated, true);
    assert.equal((await f.action<ProjectPatchResult>("patchProject", page, manager, [{ ...title, value: "Reuse" }])).kind, "validation");
    assert.deepEqual(await nativeSnapshot(f.db), noopBefore);
    const zero = saved(await call(manager, "delivery", "0", null)); assert.equal(zero.value, "0.00"); assert.equal(zero.derived?.expectedTotalBYN, "20.02");
    assert.match(zero.derived?.pricingVersion ?? "", /^\d+$/);
    assert.equal(saved(await call(manager, "delivery", "0.10", "0.00")).derived?.expectedTotalBYN, "20.12");
    assert.equal(saved(await call(manager, "unloading", "0.20", null)).derived?.expectedTotalBYN, "20.32");
    assert.equal((await call(manager, "installation", "1.005", null)).kind, "validation");
    assert.equal(saved(await call(manager, "unloading", null, "0.20")).derived?.expectedTotalBYN, "20.12");
    await f.db.product.update({ where: { id: products[1].id }, data: { expectedPrice: null } });
    assert.equal(saved(await call(manager, "installation", "0.30", null)).derived?.expectedTotalBYN, null);
    await f.db.product.update({ where: { id: products[1].id }, data: { expectedPrice: "10.01" } });
    assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: own.id } })).initialPrice?.toFixed(2), "123.45");
    const phone = { projectId: own.id, field: "client.phone", value: "200", expectedValue: "100", expectedClientId: own.clientId, clientMutationId: randomUUID() };
    assert.equal(saved(await f.action<ProjectPatchResult>("patchProject", page, manager, [phone])).value, "200");
    assert.equal((await call(manager, "client.phone", " ", "200", { expectedClientId: own.clientId })).kind, "validation");
    const other = await f.project("other-client"), oldClient = await f.db.client.findUniqueOrThrow({ where: { id: own.clientId } });
    await f.db.client.update({ where: { id: other.clientId }, data: { phone: "999" } });
    assert.equal(saved(await call(second, "clientId", other.clientId, own.clientId)).value, other.clientId);
    const binding = await call(manager, "client.phone", "300", "200", { expectedClientId: own.clientId }); assert.equal(binding.kind, "conflict");
    if (binding.kind === "conflict") { assert.equal(binding.currentClientId, other.clientId); assert.equal(binding.currentValue, "999"); }
    assert.deepEqual(await f.db.client.findUnique({ where: { id: own.clientId } }), oldClient);
    const address = { projectId: own.id, field: "client.address", value: "Client address95", expectedValue: null, expectedClientId: other.clientId, clientMutationId: randomUUID() };
    assert.equal(saved(await f.action<ProjectPatchResult>("patchProject", page, manager, [address])).value, "Client address95");
    assert.equal(saved(await f.action<ProjectPatchResult>("patchProject", page, manager, [address])).repeated, true);
    assert.equal((await call(second, "client.address", "Stale", null, { expectedClientId: other.clientId })).kind, "conflict");
    assert.equal(saved(await call(manager, "client.address", null, "Client address95", { expectedClientId: other.clientId })).value, null);
    assert.equal((await call(manager, "client.address", "Wrong client", null, { expectedClientId: own.clientId })).kind, "conflict");
    assert.equal(saved(await call(manager, "client.address", "Shared orders", null, { expectedClientId: other.clientId })).value, "Shared orders");
    assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: other.id }, include: { client: true } })).client.address, "Shared orders");
    assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: own.id } })).address, "Shared address");
    for (const actor of [engineer, worker, mounter]) { const reply = await call(actor, "title", "Hidden", "First title"); assert.equal(reply.kind, "forbidden"); assert.equal("currentValue" in reply, false); }
    const denied = await f.actionResponse("patchProject", page, accountant, [title]); assert.equal(denied.status, 302);
    assert.equal(denied.headers.get("location"), financeLocation.href);
    assert.equal(saved(await call(combined, "title", "Combined title", "First title")).value, "Combined title");
    const baseline = { title: "Original project", address: null, clientId: own.clientId };
    const legacy = await f.action<BasicReply>("updateProject", page, manager, [own.id, { title: "Legacy title", address: null, clientId: own.clientId,
      baseline: { ...baseline, title: "Combined title" } }]); assert.equal(legacy.ok, true);
    assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: own.id } })).address, "Shared address");
    assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: own.id } })).clientId, other.clientId);
    const legacyBefore = await nativeSnapshot(f.db);
    assert.equal((await f.action<BasicReply>("updateProject", page, second, [own.id, { title: "Lost", address: "Stale", baseline: { ...baseline, title: "Legacy title" } }])).ok, false);
    assert.equal((await f.action<BasicReply>("updateProject", page, manager, [own.id, { title: "Bypass" }])).ok, false); assert.deepEqual(await nativeSnapshot(f.db), legacyBefore);
    const stageInput = (toStage: "REFUSED" | "RECLAMATION", expectedStage: "LEAD" | "REFUSED" | "RECLAMATION", extras?: object) =>
      ({ projectId: own.id, toStage, expectedStage, clientMutationId: randomUUID(), ...(extras ? { extras } : {}) });
    const stage = (actor: HttpActor, input: object) => f.action<ProjectStageResult>("patchProjectStage", page, actor, [input]);
    const stageBefore = await nativeSnapshot(f.db);
    assert.equal((await stage(manager, stageInput("REFUSED", "LEAD"))).kind, "validation");
    assert.equal((await stage(manager, stageInput("RECLAMATION", "LEAD", { reclamationReason: "Reason" }))).kind, "validation");
    for (const actor of [engineer, worker, mounter]) assert.equal((await stage(actor, stageInput("REFUSED", "LEAD", { refusalReason: "Denied" }))).kind, "forbidden");
    assert.deepEqual(await nativeSnapshot(f.db), stageBefore);
    const refusal = stageInput("REFUSED", "LEAD", { refusalReason: "Reason without comment" }); assert.equal((await stage(manager, refusal)).kind, "saved");
    assert.equal((await f.db.project.findUniqueOrThrow({ where: { id: own.id } })).refusalComment, null);
    const count = await f.db.projectStageHistory.count({ where: { projectId: own.id } }); assert.equal((await stage(manager, refusal)).replayed, true);
    assert.equal(await f.db.projectStageHistory.count({ where: { projectId: own.id } }), count);
    const stale = await stage(second, stageInput("RECLAMATION", "LEAD", { reclamationReason: "Other", reclamationDescription: "Desc", reclamationFault: "CI" }));
    assert.equal(stale.kind, "conflict"); assert.equal(stale.stage, "REFUSED");
    assert.equal((await stage(manager, stageInput("RECLAMATION", "REFUSED", { reclamationReason: "Reason", reclamationDescription: "Desc", reclamationFault: "CI" }))).kind, "saved");
    for (const row of products) assert.equal((await f.db.product.findUniqueOrThrow({ where: { id: row.id } })).status, "DESIGN");
    assert.equal(await f.db.productPercentageCompletion.count({ where: { productId: { in: products.map(row => row.id) } } }), 0);
    assert.equal(await f.db.productStageSettlement.count({ where: { productId: { in: products.map(row => row.id) } } }), 0);
    assert.equal(await f.db.payrollEntry.count({ where: { projectId: own.id } }), 0);
    await f.fault("DomainEvent", manager.id, async () => {
      const snapshot = await nativeSnapshot(f.db), reply = await call(manager, "address", "Atomic overwrite", "Shared address");
      assert.equal(reply.kind, "failure"); if (reply.kind === "failure") assert.match(reply.error, /CI169_EXPECTED_FAULT/); assert.deepEqual(await nativeSnapshot(f.db), snapshot);
      assert.equal((await stage(manager, stageInput("REFUSED", "RECLAMATION", { refusalReason: "Atomic stage" }))).kind, "failure");
      assert.deepEqual(await nativeSnapshot(f.db), snapshot);
    });
  });

  await t.test("attachments/current-status-history-money-outbox: текущий ENGINEER transition и audit rollback", async () => {
    const own = await f.product("current-status", project.id, { status: "DESIGN", engineerId: engineer.id, expectedPrice: "10.01", initialPrice: "5.55" });
    await f.db.productPercentageConfig.create({ data: { id: f.id("current-status-config"), productId: own.id, kind: "ENGINEERING", ratePercent: null } });
    const page = `/products/${own.number}`, before = await nativeSnapshot(f.db);
    const denied = await f.action<BasicReply>("changeProductStatus", page, foreign, [own.id, "PRODUCTION"]); assert.equal(denied.ok, false);
    assert.deepEqual(await nativeSnapshot(f.db), before);
    await f.fault("ChangeLog", engineer.id, async () => {
      const snapshot = await nativeSnapshot(f.db), reply = await f.action<BasicReply>("changeProductStatus", page, engineer, [own.id, "PRODUCTION"]);
      assert.equal(reply.ok, false); assert.match(reply.error ?? "", /CI169_EXPECTED_FAULT/); assert.deepEqual(await nativeSnapshot(f.db), snapshot);
    });
    const reply = await f.action<BasicReply>("changeProductStatus", page, engineer, [own.id, "PRODUCTION"]); assert.equal(reply.ok, true);
    const row = await f.db.product.findUniqueOrThrow({ where: { id: own.id } }); assert.equal(row.status, "PRODUCTION");
    assert.equal(row.expectedPrice?.toFixed(2), "10.01"); assert.equal(row.initialPrice?.toFixed(2), "5.55"); assert.equal(row.quantity, 1);
    const completion = await f.db.productPercentageCompletion.findUniqueOrThrow({ where: { productId_kind: { productId: own.id, kind: "ENGINEERING" } } });
    assert.equal(completion.state, "SKIPPED_ONCE"); assert.equal(completion.ratePercentSnapshot, null);
    assert.equal(await f.db.payrollEntry.count({ where: { productId: own.id } }), 0);
    assert.equal(await f.db.productStatusHistory.count({ where: { productId: own.id } }), 1);
    assert.equal(await f.db.changeLog.count({ where: { entity: "product", entityId: own.id, action: "status" } }), 1);
    assert.equal(await f.db.domainEvent.count({ where: { type: "product.statusChanged", payload: { path: ["productId"], equals: own.id } } }), 1);
    const noop = await nativeSnapshot(f.db); assert.equal((await f.action<BasicReply>("changeProductStatus", page, engineer, [own.id, "PRODUCTION"])).ok, true);
    assert.deepEqual(await nativeSnapshot(f.db), noop);
  });

  await f.verifyProtected();
});
