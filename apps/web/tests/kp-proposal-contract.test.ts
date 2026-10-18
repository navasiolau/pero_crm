import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Client, Prisma } from "@prisma/client";
import { bindProposalClient, proposalClientSnapshot, resolveProposalClientInTransaction } from "../src/server/kp/proposal-client";
import { canonicalProposalJson, normalizeProposalState, proposalItemDescription, proposalOperationIdentity,
  createProposalSchema, saveProposalSchema } from "../src/server/kp/proposal-contract";

const actor = { id: "manager", name: "Менеджер", roles: ["MANAGER" as const], source: "web" as const };
const client = (extra: Partial<Client> = {}): Client => ({
  id: "customer", name: "Имя", lastName: "Фамилия", middleName: "Отчество", phone: "+375000000001",
  email: "customer@example.invalid", address: "Адрес", comment: "Сохранить", passportNumber: "TEST0001",
  passportIssuedBy: "Тестовый орган", legacyId: null, legacyTable: null, createdAt: new Date(0), updatedAt: new Date(0), ...extra,
});
const environment = { PERO_KP_TEMP_CLIENT_ID: "temporary" };
function clientFixture() {
  const current = client();
  const temporary = client({ id: "temporary", name: "Временный", lastName: null, middleName: null });
  const writes: unknown[] = [];
  const audits: unknown[] = [];
  const tx = {
    $queryRaw: async () => [],
    client: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === temporary.id ? { ...temporary } : where.id === current.id ? { ...current } : null,
      updateMany: async ({ where, data }: { where: Partial<Client>; data: Partial<Client> }) => {
        if (Object.entries(where).some(([key, value]) => current[key as keyof Client] !== value)) return { count: 0 };
        writes.push(data); Object.assign(current, data); return { count: 1 };
      },
    },
    changeLog: { create: async ({ data }: { data: unknown }) => { audits.push(data); return data; } },
    domainEvent: { create: async () => ({ id: "event" }) },
  } as unknown as Prisma.TransactionClient;
  return { tx, current, temporary, writes, audits };
}

test("state preserves source JSON and one item remains one stable row with subcomponents", () => {
  const source = { arbitrary: { theme: "unchanged", nested: [1, null, true] }, order: { project: "Заказ", number: "999" },
    items: [{ name: "Шкаф", description: "Текст\nв две строки", size: "2000/600/2400", image: "one", image2: "two", price: "100.50",
      products: [{ title: "Секция", outer: "ЛДСП", inner: "МДФ", hinges: "Петли", drawers: "Ящики", lighting: "Свет", custom: "untouched" }], note: "Комментарий" }] };
  const normalized = normalizeProposalState(source, () => "stable-id");
  assert.equal(normalized.items.length, 1); assert.equal(normalized.items[0].id, "stable-id"); assert.equal(normalized.items[0].qty, 1);
  assert.deepEqual(normalized.arbitrary, source.arbitrary); assert.deepEqual(normalized.items[0].products, source.items[0].products);
  assert.equal(normalized.items[0].price, "100.50"); assert.equal(normalized.items[0].image2, "two");
  assert.equal("id" in source.items[0], false);
  const description = proposalItemDescription(normalized.items[0]);
  for (const text of ["Текст\nв две строки", "Размеры: 2000/600/2400", "Каркас: ЛДСП", "Фасад: МДФ", "Примечание: Комментарий"]) assert.ok(description?.includes(text));
  assert.deepEqual(normalizeProposalState(normalized), normalized);
});

test("closed envelopes reject duplicates, noninteger quantities and malformed state before writes", () => {
  for (const state of [null, [], {}, { items: [null] }, { items: [{ qty: 1.5 }] }, { items: [{ qty: 0 }] },
    { items: [{ id: "same" }, { id: "same" }] }, { items: [{ custom: Number.NaN }] }]) assert.throws(() => normalizeProposalState(state));
  assert.throws(() => normalizeProposalState({ items: [{}, {}] }, () => "same"));
  const input = { operationId: randomUUID(), state: { items: [] } };
  assert.equal(createProposalSchema.safeParse(input).success, true);
  assert.equal(createProposalSchema.safeParse({ ...input, arbitrary: "ignored" }).success, false);
  assert.equal(saveProposalSchema.safeParse({ ...input, proposalId: "kp", expectedRevision: 0 }).success, true);
  assert.equal(saveProposalSchema.safeParse({ ...input, proposalId: "kp" }).success, false);
});

test("rendered full name and opaque contact never become structured name or guessed phone", () => {
  const source = normalizeProposalState({ client: { name: "Старое отображение", contact: "@telegram · написать вечером", extra: 7 }, items: [] });
  const state = bindProposalClient(source, client(), false);
  const details = state.client as Prisma.JsonObject;
  assert.equal(details.name, "Фамилия Имя Отчество"); assert.equal(details.contact, "@telegram · написать вечером");
  assert.equal((details.crmSnapshot as Prisma.JsonObject).name, "Имя"); assert.equal((details.crmSnapshot as Prisma.JsonObject).lastName, "Фамилия");
  assert.equal(details.extra, 7); assert.equal(details.contact, (source.client as Prisma.JsonObject).contact);
});

test("verified service client is read-only and missing/mismatched configuration fails closed", async () => {
  const f = clientFixture(); const state = normalizeProposalState({ client: { name: "Получатель КП", contact: "Текст" }, items: [] });
  assert.equal((await resolveProposalClientInTransaction(f.tx, actor, {}, state, undefined, environment)).isTemporary, true);
  await assert.rejects(resolveProposalClientInTransaction(f.tx, actor, { clientSnapshot: { name: "Заказчик" } }, state, undefined, environment), /Служебную/);
  await assert.rejects(resolveProposalClientInTransaction(f.tx, actor, {}, state, undefined, {}), /Не настроен/);
  f.temporary.name = "Похожий клиент";
  await assert.rejects(resolveProposalClientInTransaction(f.tx, actor, {}, state, undefined, environment), /проверку/);
  assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
});

test("every save reapplies saved structured client fields over manual CRM edits", async () => {
  const f = clientFixture(); const snapshot = proposalClientSnapshot(f.current);
  const state = normalizeProposalState({ client: { name: "Фамилия Имя Отчество", crmSnapshot: snapshot }, items: [] });
  f.current.phone = "+375000000099"; f.current.passportNumber = "MANUAL";
  const selection = await resolveProposalClientInTransaction(f.tx, actor, { clientId: f.current.id }, state, f.current.id, environment);
  assert.equal(selection.changed, true); assert.equal(f.current.phone, snapshot.phone); assert.equal(f.current.passportNumber, snapshot.passportNumber);
  assert.equal(f.current.name, "Имя"); assert.equal(f.writes.length, 1); assert.equal(f.audits.length, 1);
});

test("partial client edit merges the authoritative saved snapshot instead of inheriting manual CRM changes", async () => {
  const f = clientFixture(); const snapshot = proposalClientSnapshot(f.current);
  const state = normalizeProposalState({ client: { crmSnapshot: snapshot }, items: [] });
  f.current.phone = "+375000000099"; f.current.passportNumber = "MANUAL";
  await resolveProposalClientInTransaction(f.tx, actor, { clientId: f.current.id, clientSnapshot: { name: "Новое имя" } }, state, f.current.id, environment);
  assert.equal(f.current.name, "Новое имя"); assert.equal(f.current.phone, snapshot.phone); assert.equal(f.current.passportNumber, snapshot.passportNumber);
});

test("omitting the sidecar cannot discard the authoritative persisted client snapshot", async () => {
  const f = clientFixture(); const snapshot = proposalClientSnapshot(f.current);
  const previous = normalizeProposalState({ client: { crmSnapshot: snapshot }, items: [] });
  const source = normalizeProposalState({ client: { name: "Фамилия Имя Отчество", contact: "@opaque" }, items: [] });
  f.current.phone = "MANUAL";
  await resolveProposalClientInTransaction(f.tx, actor, { clientId: f.current.id }, source, f.current.id, environment, previous);
  assert.equal(f.current.phone, snapshot.phone); assert.equal(f.current.name, "Имя");
});

test("selecting a different client uses its card without applying the previous customer's snapshot", async () => {
  const f = clientFixture(); const previous = normalizeProposalState({ client: { crmSnapshot: proposalClientSnapshot(f.current) }, items: [] });
  f.current.id = "another-customer"; f.current.name = "Другой"; f.current.phone = "ANOTHER_PHONE";
  const result = await resolveProposalClientInTransaction(f.tx, actor, { clientId: f.current.id }, previous, "customer", environment, previous);
  assert.equal(result.client.id, "another-customer"); assert.equal(result.client.name, "Другой"); assert.equal(result.client.phone, "ANOTHER_PHONE");
  assert.equal(result.changed, false); assert.equal(f.writes.length, 0);
});

test("operation identity ignores key order and distinguishes all payload and pricing changes", () => {
  const id = randomUUID();
  const one = proposalOperationIdentity("actor", id, { state: { items: [], custom: 1 }, clientId: "c" });
  const reordered = proposalOperationIdentity("actor", id, { clientId: "c", state: { custom: 1, items: [] } });
  assert.deepEqual(one, reordered); assert.equal(canonicalProposalJson({ a: undefined }), "{}");
  assert.notEqual(one.fingerprint, proposalOperationIdentity("actor", id, { state: { items: [], custom: 2 }, clientId: "c" }).fingerprint);
  assert.notEqual(one.fingerprint, proposalOperationIdentity("actor", id, { state: { items: [], custom: 1 }, clientId: "c" }, "new-rate").fingerprint);
  assert.notEqual(one.receiptId, proposalOperationIdentity("other-actor", id, {}).receiptId);
});
