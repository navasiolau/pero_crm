import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { createClientInTransaction, updateClientInTransaction, type ClientBaseline } from "../src/server/clients/core";
import { submitClientEditor } from "../src/lib/client-editor-submit";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

type RecordWithPassport = ClientBaseline & { id: string; passportNumber: string | null; passportIssuedBy: string | null };
const baseline = (): RecordWithPassport => ({ id: "client", name: "Иван", lastName: "Тестовый", middleName: null,
  phone: "100", email: "qa@example.invalid", address: "Адрес", comment: null, passportNumber: "QA 000001", passportIssuedBy: "Тестовый орган" });
const actor = (roles: Role[] = ["MANAGER"]) => ({ id: "manager", name: "Менеджер", roles, source: "web" as const });
function inputFor(value: ClientBaseline) {
  return { name: value.name, phone: value.phone, lastName: value.lastName ?? undefined, middleName: value.middleName ?? undefined,
    email: value.email ?? undefined, address: value.address ?? undefined, comment: value.comment ?? undefined,
    passportNumber: value.passportNumber ?? undefined, passportIssuedBy: value.passportIssuedBy ?? undefined };
}
function fixture() {
  let current = baseline();
  const writes: { where: FixtureRow; data: FixtureRow }[] = [], logs: FixtureRow[] = [], events: FixtureRow[] = [];
  const tx = {
    $queryRaw: async () => [{ id: current.id }],
    client: {
      findUnique: async () => ({ ...current }),
      create: async ({ data }: { data: FixtureRow }) => (current = { id: "client", ...data } as RecordWithPassport),
      updateMany: async ({ where, data }: { where: FixtureRow; data: FixtureRow }) => {
        writes.push({ where, data });
        if (!matches(current, where)) return { count: 0 };
        current = { ...current, ...data } as RecordWithPassport;
        return { count: 1 };
      },
    },
    changeLog: { create: async ({ data }: { data: FixtureRow }) => { logs.push(data); return data; } },
    domainEvent: { create: async ({ data }: { data: FixtureRow }) => { events.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, writes, logs, events, current: () => current, change: (data: Partial<RecordWithPassport>) => { current = { ...current, ...data }; } };
}

test("client create normalizes optional passport fields and audits without putting passport in domain events", async () => {
  const f = fixture();
  const result = await createClientInTransaction(f.tx, actor(), { name: "  Иван  ", phone: "100", passportNumber: "  QA 000002  ", passportIssuedBy: "  Тестовая выдача  " });
  assert.equal(result.ok, true);
  assert.equal(f.current().passportNumber, "QA 000002");
  assert.equal(f.current().passportIssuedBy, "Тестовая выдача");
  assert.equal(f.current().name, "Иван");
  assert.deepEqual(f.logs[0].newValue, { name: "Иван", phone: "100", passportNumber: "QA 000002", passportIssuedBy: "Тестовая выдача" });
  assert.deepEqual(f.events[0].payload, { clientId: "client" });
  assert.equal((await createClientInTransaction(f.tx, actor(), { name: "Без паспорта", phone: "200" })).ok, true);
  assert.equal(f.current().passportNumber, null);
  assert.equal(f.current().passportIssuedBy, null);
});

test("passport writes require management role before any data access and combined roles retain their grant", async () => {
  const untouched = new Proxy({}, { get() { throw Error("Unexpected data access"); } }) as Prisma.TransactionClient;
  for (const roles of [["ENGINEER"], ["PROCUREMENT"], ["ACCOUNTANT"], ["WORKER"], ["MOUNTER"], ["ENGINEER", "PROCUREMENT"]] as Role[][]) {
    assert.equal((await createClientInTransaction(untouched, actor(roles), inputFor(baseline()))).ok, false);
    assert.equal((await updateClientInTransaction(untouched, actor(roles), "client", inputFor(baseline()), baseline())).ok, false);
  }
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["PROCUREMENT", "MANAGER"]] as Role[][]) {
    const f = fixture(), initial = baseline();
    const unfiltered = { ...inputFor(initial), id: initial.id, passportNumber: "QA 000003" };
    assert.equal((await updateClientInTransaction(f.tx, actor(roles), initial.id, unfiltered, initial)).ok, false, "unfiltered DTO is rejected by strict input");
    const { id, ...expected } = initial;
    assert.equal((await updateClientInTransaction(f.tx, actor(roles), id, { ...inputFor(initial), passportNumber: "QA 000003" }, expected)).ok, true);
  }
});

test("full client editor keeps an independently changed passport and rejects two updates of the same passport", async () => {
  const f = fixture(), { id, ...initial } = baseline();
  f.change({ passportNumber: "QA 000004" });
  assert.equal((await updateClientInTransaction(f.tx, actor(), id, { ...inputFor(initial), phone: "300" }, initial)).ok, true);
  assert.equal(f.current().phone, "300");
  assert.equal(f.current().passportNumber, "QA 000004");
  assert.deepEqual(f.writes[0], { where: { id, phone: "100" }, data: { phone: "300" } });
  const conflict = await updateClientInTransaction(f.tx, actor(), id, { ...inputFor(initial), passportNumber: "QA 000005" }, initial);
  assert.equal(conflict.ok, false);
  assert.match(conflict.error ?? "", /другим пользователем/);
  assert.equal(f.current().passportNumber, "QA 000004");
  assert.equal(f.writes.length, 1);
});

test("clearing a passport is a nullable audited field CAS and a stale seven-field baseline cannot erase it", async () => {
  const f = fixture(), { id, ...initial } = baseline();
  const { passportNumber, passportIssuedBy, ...oldBaseline } = initial;
  const oldResult = await updateClientInTransaction(f.tx, actor(), id, { ...inputFor(initial), phone: "400" }, oldBaseline as ClientBaseline);
  assert.equal(oldResult.ok, false);
  assert.match(oldResult.error ?? "", /устарела/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.current().passportNumber, passportNumber); assert.equal(f.current().passportIssuedBy, passportIssuedBy);
  assert.equal((await updateClientInTransaction(f.tx, actor(), id, { ...inputFor(initial), passportNumber: " ", passportIssuedBy: "" }, initial)).ok, true);
  assert.equal(f.current().passportNumber, null);
  assert.equal(f.current().passportIssuedBy, null);
  assert.equal(f.current().email, initial.email);
  assert.deepEqual(f.logs[0].oldValue, { passportNumber: "QA 000001", passportIssuedBy: "Тестовый орган" });
  assert.deepEqual(f.logs[0].newValue, { passportNumber: null, passportIssuedBy: null });
});

test("client editor adapter sends nine rendered baseline fields and omits nested records", async () => {
  const initial = { ...baseline(), projects: ["never send"] }, { id, ...input } = baseline();
  let captured: unknown;
  await submitClientEditor({ ...inputFor(input), passportNumber: "QA 000006" }, initial, { create: async () => ({ ok: false }), update: async (clientId, _input, expected) => { assert.equal(clientId, id); captured = expected; return { ok: true }; } });
  assert.deepEqual(captured, input);
});
