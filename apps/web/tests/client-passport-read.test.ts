import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createRequire, Module } from "node:module";
import React from "react";
import type { PrismaClient, Role } from "@prisma/client";
import { engineerFixture } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url), fixture = engineerFixture();
const client = fixture.projects[0].client as Record<string, unknown>;
Object.assign(client, { name: "Тестовый клиент", phone: "100", email: null, address: "Адрес", comment: null,
  passportNumber: "QA 000171", passportIssuedBy: "QA паспортная выдача", createdAt: new Date(0), updatedAt: new Date(0), legacyId: null, legacyTable: null });
const db = fixture.db as unknown as PrismaClient;
let roles: Role[] = ["MANAGER"];
let directory: typeof import("../src/server/clients/queries"), projects: typeof import("../src/server/projects/queries"),
  products: typeof import("../src/server/products/queries"), search: typeof import("../src/app/api/search/route"), page: typeof import("../src/app/(app)/clients/page");
function inject(path: string, exports: Record<string, unknown>) {
  const file = require.resolve(path), stub = new Module(file);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
before(() => {
  (globalThis as { prisma?: PrismaClient }).prisma = db;
  Object.assign(globalThis, { React });
  inject("../src/auth", { auth: async () => ({ user: { id: "engineer", name: "Сотрудник", roles } }) });
  inject("../src/app/(app)/clients/clients-view", { ClientsView: () => null });
  directory = require("../src/server/clients/queries");
  projects = require("../src/server/projects/queries");
  products = require("../src/server/products/queries");
  search = require("../src/app/api/search/route");
  page = require("../src/app/(app)/clients/page");
});

function assertNoPassport(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /passportNumber|passportIssuedBy|QA 000171|QA паспортная выдача/);
}

test("real client directory and page DTO omit passport for limited office roles and grant combined manager roles", async () => {
  for (const profile of [["ENGINEER"], ["PROCUREMENT"], ["ENGINEER", "ACCOUNTANT"]] as Role[][]) {
    roles = profile;
    const rows = await directory.listClientDirectory({ id: "engineer", roles }, db);
    assert.equal(rows.length, 1); assert.equal(rows[0].phone, "100"); assertNoPassport(rows);
    const rendered = await page.default({ searchParams: Promise.resolve({ focus: "client" }) });
    assert.equal(rendered.props.canManage, false); assertNoPassport(rendered.props.clients);
  }
  for (const profile of [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["PROCUREMENT", "MANAGER"]] as Role[][]) {
    roles = profile;
    const rendered = await page.default({ searchParams: Promise.resolve({}) });
    assert.equal(rendered.props.canManage, true);
    assert.equal(rendered.props.clients[0].passportNumber, "QA 000171");
    assert.equal(rendered.props.clients[0].passportIssuedBy, "QA паспортная выдача");
  }
});

test("real project/product reads, options and search cannot expose new client scalars", async () => {
  for (const profile of [["ENGINEER"], ["PROCUREMENT"], ["MANAGER"]] as Role[][]) {
    roles = profile;
    const actor = { id: "engineer", roles };
    const project = await projects.getProjectFor(actor.id, actor.roles, "mixed"), product = await products.getProductFor(actor.id, actor.roles, "own");
    assert.ok(project); assert.ok(product); assert.equal(project.client.phone, "100");
    assertNoPassport(project); assertNoPassport(product);
    assertNoPassport(await projects.listClients(actor)); assertNoPassport(await projects.listClientOptions(actor));
    const response = await search.GET(new Request("http://localhost/api/search?q=Тестовый"));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.clients.length, 1); assert.equal(result.clients[0].phone, "100"); assertNoPassport(result);
  }
});
