import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { officeCommand, officeCreated, officeDirectoryReversal, officePatch } from "../src/server/changelog/office-directory-reversal";
import { DEFAULT_CASH_ACCOUNT_KEY } from "../src/server/finance/default-cash-contracts";

const admin = { id: "admin", name: "Администратор", roles: ["ADMIN" as const], source: "web" as const };
const context = (tx: object, entityId: string) => ({ tx: tx as Prisma.TransactionClient, actor: admin, entryId: "original", entityId });

test("последовательный откат возвращает предшествующий токен поля и сохраняет соседний телефон", async () => {
  const base = { company: "A", officeFieldHeads: {} };
  const middle = { company: "B", officeFieldHeads: { company: "1" } };
  let row = { company: "C", phone: "+375 1", officeFieldHeads: { company: "2", phone: "3" } };
  const tx = { $queryRaw: async () => [], counterparty: {
    findUnique: async () => row,
    update: async ({ data }: { data: typeof row }) => row = { ...row, ...data },
  } };
  const first = officeCommand("cp", [officePatch("counterparty", "cp", base, middle, ["company", "phone"])])!;
  const second = officeCommand("cp", [officePatch("counterparty", "cp", middle, row, ["company"])])!;
  await assert.rejects(officeDirectoryReversal.read(first.data)!.preview(context(tx, "cp")), /уже изменено/);
  await officeDirectoryReversal.read(second.data)!.apply(context(tx, "cp"));
  assert.deepEqual(row.officeFieldHeads, { company: "1", phone: "3" });
  row = { ...row, officeFieldHeads: { company: "9", phone: "3" } };
  await assert.rejects(officeDirectoryReversal.read(first.data)!.preview(context(tx, "cp")), /уже изменено/);
  row = { ...row, officeFieldHeads: { company: "1", phone: "3" } };
  await officeDirectoryReversal.read(first.data)!.apply(context(tx, "cp"));
  assert.equal(row.company, "A");
  assert.equal(row.phone, "+375 1");
});

test("создание расценки сохраняет идентификатор при отмене и защищает позднюю работу", async () => {
  let row = { id: "price", name: "Работа", unit: "шт.", price: "33", category: null, active: true, officeFieldHeads: {} };
  let works = 1;
  const tx = { $queryRaw: async () => [], work: { count: async () => works }, priceItem: {
    findUnique: async () => row, update: async ({ data }: { data: typeof row }) => row = { ...row, ...data },
  } };
  const command = officeCreated("priceItem", row.id, row)!;
  const handler = officeDirectoryReversal.read(command.data)!;
  await assert.rejects(handler.apply(context(tx, row.id)), /связанные операции/);
  assert.equal(row.active, true);
  works = 0;
  const result = await handler.apply(context(tx, row.id));
  assert.deepEqual([row.id, row.active, row.price], ["price", false, "33"]);
  await officeDirectoryReversal.read(result.reversal.data)!.apply(context(tx, row.id));
  assert.deepEqual([row.id, row.active, row.price], ["price", true, "33"]);
});

test("отключённая касса возвращается с прежним назначением, конфликт настройки блокирует обе записи", async () => {
  const before = { active: true, officeFieldHeads: {} };
  let cash = { active: false, currency: "USD", officeFieldHeads: { active: "1" } };
  let setting = { value: JSON.stringify({ revision: 2, accountId: null }), officeFieldHeads: { value: "2" } };
  const tx = { $queryRaw: async () => [], cashAccount: {
    findUnique: async () => cash, update: async ({ data }: { data: typeof cash }) => cash = { ...cash, ...data },
  }, orgSetting: {
    findUnique: async () => setting, upsert: async ({ update }: { update: typeof setting }) => setting = { ...setting, ...update },
  } };
  const command = officeCommand("account", [
    officePatch("cashAccount", "account", before, cash, ["active"]),
    officePatch("defaultCash", DEFAULT_CASH_ACCOUNT_KEY, { value: "account", officeFieldHeads: { value: "0" } },
      { value: null, officeFieldHeads: { value: "2" } }, ["value"]),
  ])!;
  const handler = officeDirectoryReversal.read(command.data)!;
  setting.officeFieldHeads.value = "3";
  await assert.rejects(handler.apply(context(tx, "account")), /уже изменено/);
  assert.equal(cash.active, false);
  setting.officeFieldHeads.value = "2";
  await handler.apply(context(tx, "account"));
  assert.deepEqual([cash.active, cash.currency], [true, "USD"]);
  assert.deepEqual(JSON.parse(setting.value), { revision: 3, accountId: "account" });
});

test("изменённая привязка проекта блокирует групповой откат даже при том же имени контакта", async () => {
  const client = { isContactPerson: true, officeFieldHeads: { isContactPerson: "2" } };
  const expected = { clientId: "c", contactPerson: "Контакт", officeFieldHeads: { contactPerson: "3" } };
  const tx = { $queryRaw: async () => [], client: { findUnique: async () => client },
    project: { findUnique: async () => ({ ...expected, clientId: "another", officeFieldHeads: { ...expected.officeFieldHeads, clientId: "4" } }) } };
  const command = officeCommand("c", [
    officePatch("client", "c", { isContactPerson: false, officeFieldHeads: {} }, client, ["isContactPerson"]),
    officePatch("projectContact", "p", { ...expected, contactPerson: null, officeFieldHeads: {} },
      expected, ["contactPerson", "clientId"], ["clientId"]),
  ])!;
  await assert.rejects(officeDirectoryReversal.read(command.data)!.apply(context(tx, "c")), /уже изменено/);
  assert.equal(client.isContactPerson, true);
});
