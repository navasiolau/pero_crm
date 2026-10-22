import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
import type { Role } from "@prisma/client";
import { engineerFixture } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url), originals = new Map<string, NodeModule | undefined>();
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name), stub = new Module(file); originals.set(file, require.cache[file]);
  stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
const fixture = engineerFixture(); let loggedIn = true, roles: Role[] = ["ENGINEER"], storageReads = 0;
fixture.files.push({ ...fixture.files[1], id: "file-hidden", projectId: "hidden", project: fixture.projects[1], productId: "hidden-product", product: fixture.products[3] });
Object.assign(fixture.files[1], { storedName: "foreign.png", mimeType: "image/png", size: 10 });
inject("../src/auth", { auth: async () => loggedIn ? { user: { id: "engineer", roles } } : null });
inject("../src/lib/prisma", { prisma: fixture.db });
inject("../src/lib/s3", { UPLOADS_ROOT: "unused", s3Enabled: () => true, fileKey: (id: string, name: string) => id + "/" + name,
  thumbKey: (id: string, name: string) => id + "/thumb/" + name,
  s3Get: async () => { storageReads++; throw Error("CONTROLLED_STORAGE_BOUNDARY"); } });
const routeFile = require.resolve("../src/app/api/files/[id]/route"); originals.set(routeFile, require.cache[routeFile]);
const { GET } = require(routeFile) as typeof import("../src/app/api/files/[id]/route");
const searchRoute = require.resolve("../src/app/api/search/route"); originals.set(searchRoute, require.cache[searchRoute]);
const { GET: search } = require(searchRoute) as typeof import("../src/app/api/search/route");
const get = (id: string, suffix = "") => GET(new Request("https://fixture.invalid/api/files/" + id + suffix), { params: Promise.resolve({ id }) });
after(() => { for (const [file, old] of originals) { if (old) require.cache[file] = old; else delete require.cache[file]; } });

test("current ACL and session refuse original/preview before storage, while an allowed original reaches it", async () => {
  for (const suffix of ["", "?thumb=1", "?preview=card"]) assert.equal((await get("file-hidden", suffix)).status, 404);
  const production = fixture.products.find(row => row.id === "production")!, previous = production.status;
  try {
    roles = ["WORKER"]; production.status = "INSTALLATION";
    assert.equal((await get("file-production")).status, 404);
  } finally { roles = ["ENGINEER"]; production.status = previous; }
  loggedIn = false; assert.equal((await get("file-own")).status, 401); loggedIn = true;
  assert.equal(storageReads, 0);
  await assert.rejects(get("file-foreign"), /CONTROLLED_STORAGE_BOUNDARY/);
  assert.equal(storageReads, 1);
  assert.equal((await get("file-foreign", "?preview=card")).status, 422);
  assert.equal(storageReads, 2, "allowed preview crosses the same current ACL boundary");
});

test("global search reads a foreign product and parent, but does not expose an early parent or money", async () => {
  const foreign = await (await search(new Request("https://fixture.invalid/api/search?q=foreign"))).json();
  assert.deepEqual(foreign.products.map((row: { id: string }) => row.id), ["foreign"]);
  assert.equal("expectedPrice" in foreign.products[0], false);
  const field = await (await search(new Request("https://fixture.invalid/api/search?q=field"))).json();
  assert.deepEqual(field.projects.map((row: { id: string }) => row.id), ["field"]);
  assert.deepEqual(field.products.map((row: { id: string }) => row.id), ["field-product"]);
  const hidden = await (await search(new Request("https://fixture.invalid/api/search?q=hidden"))).json();
  assert.deepEqual(hidden.projects, []);
  assert.deepEqual(hidden.products, []);
});
