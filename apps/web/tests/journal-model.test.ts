import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import type { JournalEntryInput } from "../src/server/changelog/contract";
import { buildJournalPresentation, buildJournalSearchText, classifyJournalEntry, parseJournalPresentation, sanitizeJournalValue } from "../src/server/changelog/presentation";
import { writeChangeLogInTransaction } from "../src/server/changelog/writer";

const event = (patch: Partial<JournalEntryInput> = {}): JournalEntryInput => ({
  id: "event-1", actorType: "user", actorId: "person-1", actorName: "Иван", entity: "project", entityId: "project-1",
  action: "update", source: "web", createdAt: new Date("2026-11-16T07:08:09Z"), ...patch,
});

test("long text and nested arrays survive the full diff and search document", () => {
  const tail = "последнее значение за пределами старого лимита";
  const input = event({ oldValue: { description: "старое", items: [{ name: "Шкаф", text: "a".repeat(300) }] },
    newValue: { description: "длинное описание ".repeat(80) + tail, items: [{ name: "Кухня", text: "b".repeat(300) }] } });
  const view = buildJournalPresentation(input);
  assert.equal(view.changes.length, 2);
  assert.equal(view.changes[0]?.after, (input.newValue as { description: string }).description);
  assert.deepEqual(view.changes[1]?.after, [{ name: "Кухня", text: "b".repeat(300) }]);
  const search = buildJournalSearchText(input, view);
  assert.ok(search.includes(tail)); assert.ok(search.includes("b".repeat(300)));
});

test("diff distinguishes null, empty, false and zero and ignores key ordering", () => {
  const view = buildJournalPresentation(event({ oldValue: { details: { b: 0, a: false }, comment: null, quantity: 0 },
    newValue: { quantity: false, details: { a: false, b: 0 }, comment: "" } }));
  assert.deepEqual(view.changes.map(change => [change.path, change.before, change.after]), [["comment", null, ""], ["quantity", 0, false]]);
  assert.ok(view.changes.every(change => change.beforeKnown && change.afterKnown));
});

test("known fields, enums, references, actions and entity numbers use Russian labels", () => {
  const view = buildJournalPresentation(event({ entity: "product", entityId: "stable-product", action: "status", field: "status", oldValue: "DESIGN", newValue: "PRODUCTION" }), {
    entity: { label: "Изделие 203.1" }, contexts: [{ kind: "product", id: "stable-product", label: "Изделие 203.1" }],
  });
  assert.equal(view.action.label, "Изменение"); assert.equal(view.source.label, "CRM");
  assert.equal(view.entity.label, "Изделие 203.1"); assert.equal(view.entity.href, "/products/stable-product");
  assert.deepEqual(view.changes[0], { path: "status", label: "Статус", before: "Проектирование", after: "В производстве", beforeKnown: true, afterKnown: true });
  const linked = buildJournalPresentation(event({ oldValue: { managerId: "u1" }, newValue: { managerId: "u2" } }), {
    links: [{ type: "user", id: "u1", label: "Анна" }, { type: "user", id: "u2", label: "Иван" }],
  });
  assert.equal(linked.changes[0]?.before, "Анна"); assert.equal(linked.changes[0]?.after, "Иван");
});

test("system executor is separate from initiator and raw actor", () => {
  const input = event({ source: "api", action: "kp.synchronize", oldValue: { title: "А" }, newValue: { title: "Б" } });
  const before = structuredClone(input);
  const human = buildJournalPresentation(input);
  assert.equal(human.actor.type, "user");
  const system = buildJournalPresentation(input, { actor: { type: "system", id: "system", name: "Система" }, initiator: { id: "person-1", name: "Иван" }, reason: "Обновление из КП" });
  assert.equal(system.actor.name, "Система"); assert.equal(system.initiator?.name, "Иван"); assert.deepEqual(input, before);
  assert.equal(buildJournalPresentation(event({ actorType: "plugin" })).actor.name, "Система");
});

test("legacy unknown before is explicit and no context is invented", () => {
  const view = buildJournalPresentation(event({ entity: "task", oldValue: null, newValue: { title: "Новая задача" } }));
  assert.equal(view.changes[0]?.beforeKnown, false); assert.equal(view.changes[0]?.before, null);
  assert.deepEqual(view.contexts, []);
  const created = buildJournalPresentation(event({ action: "create", newValue: { title: "Новая запись", number: "203" } }));
  assert.ok(created.changes.every(change => change.beforeKnown)); assert.equal(created.entity.label, "Проект 203");
});

test("direct entity self-context uses stable ID and never adds the product parent project", () => {
  const product = buildJournalPresentation(event({ entity: "product", entityId: "p-id", newValue: { number: "203.1", projectId: "203" } }));
  assert.deepEqual(product.contexts, [{ kind: "product", id: "p-id", label: "Изделие 203.1", href: "/products/p-id" }]);
  assert.equal(buildJournalPresentation(event()).contexts[0]?.id, "project-1");
  assert.deepEqual(buildJournalPresentation(event(), { contexts: [] }).contexts, []);
});

test("partial legacy fields remain unknown while explicit null and complete snapshots stay known", () => {
  const partial = buildJournalPresentation(event({ oldValue: { revision: 1, title: null }, newValue: { revision: 2, projectId: "5", title: "Проект" } }));
  assert.equal(partial.changes.find(change => change.path === "projectId")?.beforeKnown, false);
  assert.equal(partial.changes.find(change => change.path === "title")?.beforeKnown, true);
  const missingAfter = buildJournalPresentation(event({ oldValue: { title: "Проект", comment: "История" }, newValue: { title: "Проект 2" } }));
  assert.equal(missingAfter.changes.find(change => change.path === "comment")?.afterKnown, false);
  const complete = buildJournalPresentation(event(), { before: {}, after: { comment: null } });
  assert.deepEqual(complete.changes.map(change => [change.path, change.beforeKnown, change.afterKnown]), [["comment", true, true]]);
  const created = buildJournalPresentation(event({ action: "create", newValue: { title: "Проект", comment: null } }));
  assert.equal(created.changes.find(change => change.path === "comment")?.beforeKnown, true);
  assert.equal(created.changes.find(change => change.path === "comment")?.afterKnown, true);
});

test("legacy inline and stage receipts extract business values without fingerprint diff", () => {
  const inline = buildJournalPresentation(event({ action: "inline.update", field: "title", oldValue: { value: "А" },
    newValue: { fingerprint: "hash", result: { kind: "saved", value: "Б", clientMutationId: "request" } } }));
  assert.deepEqual(inline.changes.map(change => [change.path, change.before, change.after]), [["title", "А", "Б"]]);
  const stage = buildJournalPresentation(event({ action: "stage", field: "stage", oldValue: "LEAD", newValue: { fingerprint: "hash", stage: "CONTRACT" } }));
  assert.deepEqual(stage.changes.map(change => [change.before, change.after]), [["Лид", "Договор"]]);
});

test("independent hints snapshots preserve receipts and translate known reference values", () => {
  const input = event({ id: "project-inline:x", action: "inline.update", field: "title", newValue: { fingerprint: "abc", result: { ok: true } } });
  const view = buildJournalPresentation(input, { before: { title: "Полный старый снимок", amount: new Prisma.Decimal("100.10") }, after: { title: "Полный новый снимок", amount: new Prisma.Decimal("101.10") } });
  assert.equal(view.changes[0]?.path, "title"); assert.equal(view.changes[1]?.before, "100.1"); assert.equal(view.changes[1]?.after, "101.1");
  assert.deepEqual(input.newValue, { fingerprint: "abc", result: { ok: true } });
  const scalar = buildJournalPresentation(event({ field: "managerId" }), { before: "u1", after: "u2", links: [
    { type: "user", id: "u1", label: "Анна" }, { type: "user", id: "u2", label: "Иван" },
  ] });
  assert.deepEqual(scalar.changes.map(change => [change.path, change.label, change.before, change.after]), [["managerId", "Менеджер", "Анна", "Иван"]]);
});

test("secrets are removed recursively and from scalar secret fields without hiding safe IDs", () => {
  const input = event({ oldValue: { password: "old-secret", nested: { accessToken: "bearer-secret", linkCode: "code-secret", tokenId: "token-record", postalCode: "220000" } },
    newValue: { password: "new-secret", nested: { clientSecret: "client-secret", passwordChanged: true, tokenId: "token-record", articleCode: "08" } } });
  const view = buildJournalPresentation(input); const serialized = JSON.stringify(view); const search = buildJournalSearchText(input, view);
  for (const secret of ["old-secret", "new-secret", "bearer-secret", "code-secret", "client-secret"]) { assert.ok(!serialized.includes(secret)); assert.ok(!search.includes(secret)); }
  assert.ok(search.includes("token-record")); assert.ok(search.includes("220000")); assert.ok(search.includes("08"));
  const scalar = event({ field: "password", oldValue: "scalar-old", newValue: "scalar-new" });
  assert.ok(!JSON.stringify(buildJournalPresentation(scalar)).includes("scalar-"));
  assert.deepEqual(sanitizeJournalValue({ body: "Authorization: Bearer abc.def.secret", url: "https://user:secret@example.test/path?token=hidden" }),
    { body: "Authorization: Bearer [скрыто]", url: "https://[скрыто]@example.test/path?token=[скрыто]" });
});

test("signed URLs, secret key variations, arrays and binary blobs are never exposed", () => {
  const url = "https://s3.test/file?X-Amz-Signature=signed-secret&X-Amz-Credential=key-secret&X-Amz-Security-Token=session-secret&X-Amz-Expires=60";
  const entry = event({ entity: "telegramLink", newValue: { code: "otp-secret", metadata: [{ media_token: "media-secret", "PASSWORD-HASH": "hash-secret", api_key: "api-secret", url }],
    preview: "data:image/png;base64,private-image", buffer: new Uint8Array([1, 2, 3]), fileName: "file.png" } });
  const view = buildJournalPresentation(entry), search = buildJournalSearchText(entry, view), serialized = JSON.stringify(view);
  for (const secret of ["signed-secret", "key-secret", "session-secret", "otp-secret", "media-secret", "hash-secret", "api-secret", "private-image"])
    { assert.ok(!search.includes(secret), secret); assert.ok(!serialized.includes(secret), secret); }
  assert.ok(search.includes("file.png")); assert.ok(search.includes("X-Amz-Expires=60"));
  assert.ok(!serialized.includes('"0":1'));
});

test("a changed secret remains a visible changed field with both values hidden", () => {
  const view = buildJournalPresentation(event({ oldValue: { password: "old-password", safe: "unchanged" }, newValue: { password: "new-password", safe: "unchanged" } }));
  assert.deepEqual(view.changes.map(change => [change.path, change.label, change.before, change.after]), [["password", "Пароль", "[скрыто]", "[скрыто]"]]);
  const protectedText = sanitizeJournalValue({ value: '{"secretKey":"secret-key-value","password_confirmation":"confirmation-secret","name":"Стол"}' });
  assert.ok(!JSON.stringify(protectedText).includes("secret-key-value")); assert.ok(!JSON.stringify(protectedText).includes("confirmation-secret"));
  assert.ok(JSON.stringify(protectedText).includes("Стол"));
});

test("only exact known duplicate receipts are hidden and personal plan is excluded", () => {
  assert.equal(classifyJournalEntry(event({ entity: "task", action: "task.status.request", id: "task-status:x" })), "receipt");
  assert.equal(classifyJournalEntry(event({ entity: "task", action: "task.status.request", id: "unrelated:x" })), "event");
  assert.equal(classifyJournalEntry(event({ action: "future.receipt", id: "receipt:x" })), "event");
  assert.equal(classifyJournalEntry(event({ entity: "calendarEntry" })), "excluded");
  assert.equal(classifyJournalEntry(event({ entity: "file", action: "create", id: "file-upload:x" })), "event");
});

test("search includes complete visible and safe technical values, Moscow date and raw enum codes", () => {
  const input = event({ action: "stage", field: "stage", oldValue: "LEAD", newValue: "CONTRACT", source: "telegram" });
  const search = buildJournalSearchText(input, buildJournalPresentation(input));
  for (const value of ["16.11.2026", "10:08:09", "2026-11-16", "Иван", "Изменение", "Telegram", "Лид", "Договор", "CONTRACT", "project-1", "event-1"])
    assert.ok(search.includes(value), value);
});

test("search stores literal quotes and multiline values instead of only JSON escapes", () => {
  const description = 'Шкаф "Кухня"\nвторая строка';
  const input = event({ newValue: { description } });
  assert.ok(buildJournalSearchText(input, buildJournalPresentation(input)).includes(description));
});

test("parser rejects malformed persisted presentation, re-cleans secrets and unsafe links", () => {
  assert.equal(parseJournalPresentation({ version: 2 }), null);
  assert.equal(parseJournalPresentation({ ...buildJournalPresentation(event()), actor: { name: "Иван" } }), null);
  const dirty = buildJournalPresentation(event()); dirty.technical = { accessToken: "leaked" }; dirty.entity.href = "javascript:alert(1)";
  const parsed = parseJournalPresentation(dirty); assert.ok(parsed); assert.ok(!JSON.stringify(parsed).includes("leaked")); assert.equal(parsed.entity.href, undefined);
});

test("writer appends representation atomically without changing raw receipt payload or identity", async () => {
  let data: Prisma.ChangeLogCreateInput | undefined; let count = 0;
  const tx = { changeLog: { create: async (input: { data: Prisma.ChangeLogCreateInput }) => { count++; data = input.data; return { id: "saved" }; } } };
  const raw = event({ id: "receipt-stable", field: "stage", newValue: { fingerprint: "fingerprint", result: { actorId: "person-1", amount: "123.45" } } });
  const result = await writeChangeLogInTransaction(tx as unknown as Pick<Prisma.TransactionClient, "changeLog">, raw,
    { before: { stage: "LEAD" }, after: { stage: "CONTRACT" }, actor: { type: "system", id: "system", name: "Система" } });
  assert.equal(result.id, "saved"); assert.equal(count, 1); assert.ok(data);
  assert.equal(data.id, raw.id); assert.equal(data.actorId, raw.actorId); assert.equal(data.actorType, "user"); assert.deepEqual(data.newValue, raw.newValue);
  assert.equal(data.createdAt, raw.createdAt); assert.equal(parseJournalPresentation(data.presentation)?.actor.type, "system"); assert.ok(data.searchText?.includes("Договор"));
});

test("writer propagates failure of mandatory audit", async () => {
  const failure = new Error("audit refused");
  const tx = { changeLog: { create: async () => { throw failure; } } };
  await assert.rejects(() => writeChangeLogInTransaction(tx as unknown as Pick<Prisma.TransactionClient, "changeLog">, event()), error => error === failure);
});
