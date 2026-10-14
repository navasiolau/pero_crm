import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, Module } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import sharp from "sharp";

import { readFinanceDocumentResponse } from "../src/server/finance-documents/http";
import { readLogisticsDocumentResponse } from "../src/server/logistics/http";
import type { FinanceDocumentView } from "../src/server/finance-documents/contracts";
import type { LogisticsDocumentView } from "../src/server/logistics/contracts";
import { engineerFixture } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url);
const previousModules = new Map<string, NodeModule | undefined>();
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier);
  previousModules.set(filename, require.cache[filename]);
  const stub = new Module(filename);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

// Настоящие handler/adapter работают только с relational fixture и in-memory storage.
const fixture = engineerFixture();
const visible = fixture.files.find(file => file.id === "file-own")!;
const ownProduct = fixture.products.find(product => product.id === "own")!;
let loggedIn = true;
let storagePresent = true;
let sourceBytes: Uint8Array = new TextEncoder().encode("fixture");
let fixtureRevision = 0;
const storageKeys: string[] = [];
let route: typeof import("../src/app/api/files/[id]/route");

before(() => {
  inject("../src/auth", { auth: async () => loggedIn ? { user: { id: "engineer", roles: ["ENGINEER"] } } : null });
  inject("../src/lib/prisma", { prisma: fixture.db });
  inject("../src/lib/s3", {
    UPLOADS_ROOT: "never-used",
    s3Enabled: () => true,
    fileKey: (project: string, name: string) => `${project}/${name}`,
    thumbKey: (project: string, name: string) => `${project}/thumb/${name}`,
    s3Get: async (key: string) => {
      storageKeys.push(key);
      return storagePresent ? new ReadableStream({ start(controller) { controller.enqueue(sourceBytes); controller.close(); } }) : null;
    },
  });
  const routeFile = require.resolve("../src/app/api/files/[id]/route");
  previousModules.set(routeFile, require.cache[routeFile]);
  route = require(routeFile);
});

after(() => {
  for (const [filename, previous] of previousModules) {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  }
});

beforeEach(() => {
  loggedIn = true;
  storagePresent = true;
  storageKeys.length = 0;
  ownProduct.engineerId = "engineer";
  selectSource("application/octet-stream", new TextEncoder().encode("fixture"));
});

function selectSource(mimeType: string, bytes: Uint8Array, hasThumb = false) {
  sourceBytes = bytes;
  Object.assign(visible, { mimeType, fileName: "Файл original.bin", storedName: "original.bin", hasThumb,
    size: bytes.length, createdAt: new Date(++fixtureRevision) });
}
const get = (suffix = "", id = "file-own", headers?: HeadersInit) => route.GET(
  new Request(`https://example.invalid/api/files/${id}${suffix}`, { headers }),
  { params: Promise.resolve({ id }) },
);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function assertPrivateFileHeaders(response: Response, disposition: "inline" | "attachment") {
  assert.match(response.headers.get("content-disposition") ?? "", new RegExp(`^${disposition}`));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  assert.ok(response.headers.get("cache-control")?.startsWith("private"));
  assert.ok(response.headers.get("vary")?.includes("Cookie"));
}

const activeDocuments = [
  { mimeType: "text/html", bytes: new TextEncoder().encode("<!doctype html><title>inert fixture</title><p>fixture</p>") },
  { mimeType: "image/svg+xml", bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>') },
];

test("legacy HTML/SVG thumb fails closed for both hasThumb values and simultaneous view", async () => {
  for (const document of activeDocuments) for (const hasThumb of [false, true]) {
    selectSource(document.mimeType, document.bytes, hasThumb);
    for (const suffix of ["?thumb=1", "?thumb=1&view=1", "?preview=thumbnail&thumb=1&view=1"]) {
      storageKeys.length = 0;
      const response = await get(suffix);
      assert.equal(response.status, 415, `${document.mimeType}, ${suffix}, hasThumb=${hasThumb}`);
      assert.equal(response.headers.get("content-disposition"), null);
      assert.deepEqual(storageKeys, [], "unsupported source must be rejected before storage");
    }
  }
});

test("legacy raster thumb reencodes safely while both original modes remain byte-exact", async () => {
  const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#4488aa" } }).png().toBuffer();
  for (const hasThumb of [false, true]) {
    selectSource("image/png", bytes, hasThumb);
    for (const suffix of ["?thumb=1", "?thumb=1&view=1"]) {
      const response = await get(suffix);
      assert.equal(response.status, 200);
      assertPrivateFileHeaders(response, "inline");
      assert.equal(response.headers.get("content-type"), "image/webp");
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.equal(metadata.format, "webp");
      assert.ok(metadata.width! <= 160 && metadata.height! <= 160);
      assert.ok(Math.abs(metadata.height! - metadata.width! * 400 / 600) <= 1, "resize preserves aspect ratio within pixel rounding");
    }
    assert.ok(storageKeys.every(key => !key.includes("/thumb/")), "legacy metadata is not trusted as a verified preview");
    for (const suffix of ["", "?view=1"]) {
      const response = await get(suffix);
      assertPrivateFileHeaders(response, "attachment");
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(bytes));
    }
  }
});

test("broken raster thumb cannot fall back to an original for either hasThumb value", async () => {
  for (const hasThumb of [false, true]) {
    const bytes = new TextEncoder().encode("not a raster image");
    selectSource("image/png", bytes, hasThumb);
    for (const suffix of ["?thumb=1", "?thumb=1&view=1", "?preview=cover&thumb=1"]) {
      const response = await get(suffix);
      assert.equal(response.status, 422);
      assert.equal(response.headers.get("content-disposition"), null);
    }
    const download = await get();
    assertPrivateFileHeaders(download, "attachment");
    assert.equal(hash(new Uint8Array(await download.arrayBuffer())), hash(bytes));
  }
});


test("missing image object fails closed without falling back to an original", async () => {
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#334455" } }).png().toBuffer();
  selectSource("image/png", bytes, true);
  storagePresent = false;
  const response = await get("?thumb=1");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-disposition"), null);
  assert.deepEqual(storageKeys, ["mixed/original.bin"]);
});
test("preview query keeps precedence, conditional thumb keeps cache/Vary and performs current ACL", async () => {
  const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#778899" } }).png().toBuffer();
  selectSource("image/png", bytes);
  const first = await get("?thumb=1");
  const etag = first.headers.get("etag")!;
  assert.ok(etag);
  const reads = storageKeys.length;
  const unchanged = await get("?thumb=1", "file-own", { "if-none-match": etag });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get("content-length"), null);
  assert.equal(unchanged.body, null);
  assert.equal(unchanged.headers.get("cache-control"), "private, max-age=0, must-revalidate");
  assert.equal(unchanged.headers.get("vary"), "Cookie");
  assert.equal(storageKeys.length, reads);
  const cover = await get("?preview=cover&thumb=1");
  const metadata = await sharp(Buffer.from(await cover.arrayBuffer())).metadata();
  assert.equal(metadata.width, 600);
  assert.equal((await get("?preview=unknown&thumb=1")).status, 400);
  ownProduct.engineerId = "other";
  assert.equal((await get("?thumb=1", "file-own", { "if-none-match": etag })).status, 404);
  assert.equal(storageKeys.length, reads + 1);
});

test("anonymous and foreign original/view/thumb/preview requests do not read storage", async () => {
  for (const suffix of ["", "?view=1", "?thumb=1", "?view=1&thumb=1", "?preview=cover", "?preview=thumbnail&thumb=1"]) {
    assert.equal((await get(suffix, "file-foreign")).status, 404);
    loggedIn = false;
    assert.equal((await get(suffix)).status, 401);
    loggedIn = true;
  }
  assert.deepEqual(storageKeys, []);
});

test("document read adapters share safe file headers and preserve their raster/PDF contract", async () => {
  for (const mimeType of ["text/html", "image/svg+xml", "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "application/pdf", "application/octet-stream"]) {
    const bytes = new TextEncoder().encode("byte-exact-document");
    const finance: FinanceDocumentView = { id: "finance", source: "finance", fileName: "Чек.pdf", mimeType,
      size: bytes.length, createdAt: new Date(0).toISOString(), paymentId: null };
    const logistics: LogisticsDocumentView = { id: "logistics", tripId: "trip", source: "logistics", fileName: "ТТН.pdf",
      mimeType, size: bytes.length, stage: "ISSUED", ttnNumber: null, createdAt: new Date(0).toISOString() };
    const stream = () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    const unavailable = async () => { throw Error("unexpected upload/list"); };
    const reads = [
      (request: Request) => readFinanceDocumentResponse(request, finance.id, { authorize: async () => "actor",
        service: { upload: unavailable, list: unavailable, read: async () => ({ document: finance, body: stream() }) } }),
      (request: Request) => readLogisticsDocumentResponse(request, logistics.id, { authorize: async () => "actor",
        service: { upload: unavailable, list: unavailable, read: async () => ({ document: logistics, body: stream() }) } }),
    ];
    for (const read of reads) for (const suffix of ["", "?view=1"]) {
      const response = await read(new Request(`https://example.invalid/document${suffix}`));
      const inline = /^image\/(jpeg|png|gif|webp|avif)$/.test(mimeType) || (mimeType === "application/pdf" && !!suffix);
      assertPrivateFileHeaders(response, inline ? "inline" : "attachment");
      assert.equal(response.headers.get("content-type"), mimeType);
      assert.equal(response.headers.get("content-length"), String(bytes.length));
      assert.equal(response.headers.get("vary"), "Cookie, Authorization");
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(bytes));
    }
  }
});
