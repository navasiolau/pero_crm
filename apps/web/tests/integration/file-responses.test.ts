import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { assertPrivateFileHeaders, createHttpS3Fixture } from "./http-s3.fixture";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Ожидания перенесены из safe-file-response.test.ts и image-preview.test.ts; не вычисляются кодом route.
const active = [
  { label: "html", mime: "text/html", bytes: Buffer.from("<!doctype html><title>inert fixture</title><p>fixture</p>") },
  { label: "svg", mime: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>') },
] as const;
const deniedUrls = ["", "?view=1", "?thumb=1", "?view=1&thumb=1", "?preview=cover", "?preview=thumbnail&thumb=1"];

test("media.responses: настоящий Next.js, Auth.js и versioned MinIO", { timeout: 180_000 }, async t => {
  const f = await createHttpS3Fixture("media-responses"); t.after(() => f.dispose());
  const engineer = await f.user("engineer", ["ENGINEER"]), foreign = await f.user("foreign", ["ENGINEER"]);
  await f.session(engineer); await f.session(foreign);
  const project = await f.project("media", { stage: "CONTRACT", currency: "BYN" }), product = await f.product("design", project.id, { status: "DESIGN", engineerId: engineer.id });
  const production = await f.product("production", project.id, { status: "PRODUCTION", engineerId: engineer.id });
  const context = { projectId: project.id, productId: product.id };
  const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#4488aa" } }).png().toBuffer();
  const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF");
  const sources = [...active, { label: "png", mime: "image/png", bytes: png }, { label: "pdf", mime: "application/pdf", bytes: pdf },
    { label: "corrupt", mime: "image/png", bytes: Buffer.from("not a raster image") }];
  const files: { source: (typeof sources)[number]; row: Awaited<ReturnType<typeof f.file>> }[] = [];
  for (const hasThumb of [false, true]) {
    for (const source of sources) {
      const row = await f.file(`${source.label}-${hasThumb}`, context, source.bytes, source.mime, { hasThumb });
      if (hasThumb) await f.put(`${project.id}/thumbs/${row.storedName}.jpg`, active[0].bytes, "text/html");
      files.push({ source, row });
    }
  }
  const missing = await f.file("missing", context, png, "image/png", { missing: true, hasThumb: true });
  const productionFile = await f.file("production", { projectId: project.id, productId: production.id }, png, "image/png");
  const originals = await f.versions(project.id), rowsBefore = await f.db.file.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } });
  const read = (id: string, suffix = "", actor = engineer, headers?: HeadersInit) => f.request(`/api/files/${id}${suffix}`, actor, { headers });

  await t.test("media.active: HTML/SVG attachment byte-exact; legacy thumb415 независимо от hasThumb", async () => {
    for (const { source, row } of files.filter(item => item.source.label === "html" || item.source.label === "svg")) {
      for (const suffix of ["", "?view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200);
        assertPrivateFileHeaders(response, "attachment"); assert.equal(response.headers.get("content-type"), source.mime);
        assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(source.bytes));
      }
      for (const suffix of ["?thumb=1", "?thumb=1&view=1", "?preview=thumbnail&thumb=1&view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 415); assert.equal(response.headers.get("content-disposition"), null);
      }
    }
  });
  await t.test("media.raster: оригинал неизменен; thumbnail/card/cover безопасны и bounded", async () => {
    for (const { row } of files.filter(item => item.source.label === "png")) {
      for (const suffix of ["", "?view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200); assertPrivateFileHeaders(response, "attachment");
        assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(png));
        assert.match(response.headers.get("content-disposition")!, new RegExp(`filename\\*=UTF-8''${encodeURIComponent(row.fileName)}`));
      }
      for (const [suffix, maxWidth, maxHeight] of [["?thumb=1", 160, 160], ["?thumb=1&view=1", 160, 160],
        ["?preview=thumbnail", 160, 160], ["?preview=card", 480, 480], ["?preview=cover&thumb=1", 1280, 1600]] as const) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200); assertPrivateFileHeaders(response, "inline");
        assert.equal(response.headers.get("content-type"), "image/webp");
        const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata(); assert.equal(metadata.format, "webp");
        assert.ok(metadata.width! > 0 && metadata.width! <= maxWidth && metadata.height! > 0 && metadata.height! <= maxHeight);
        assert.ok(Math.abs(metadata.height! - metadata.width! * 3 / 4) <= 1);
        if (suffix.includes("cover")) assert.ok(metadata.width! > 480, "preview имеет приоритет перед legacy thumb");
      }
    }
  });
  await t.test("media.corrupt-missing: corrupt422 и missing404 без inline fallback", async () => {
    for (const { source, row } of files.filter(item => item.source.label === "corrupt")) {
      for (const suffix of ["?thumb=1", "?thumb=1&view=1", "?preview=cover&thumb=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 422); assert.equal(response.headers.get("content-disposition"), null);
      }
      const response = await read(row.id); assertPrivateFileHeaders(response, "attachment");
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(source.bytes));
    }
    for (const suffix of ["", "?thumb=1", "?preview=cover"]) {
      const response = await read(missing.id, suffix); assert.equal(response.status, 404); assert.equal(response.headers.get("content-disposition"), null);
    }
  });
  await t.test("media.pdf: inline только при view; thumbnail415", async () => {
    for (const { row } of files.filter(item => item.source.label === "pdf")) {
      for (const suffix of ["", "?view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200); assertPrivateFileHeaders(response, suffix ? "inline" : "attachment");
        assert.equal(response.headers.get("content-type"), "application/pdf"); assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(pdf));
      }
      for (const suffix of ["?thumb=1", "?view=1&thumb=1"]) assert.equal((await read(row.id, suffix)).status, 415);
    }
  });
  await t.test("media.access: current production ENGINEER200, foreign404, anonymous middleware307", async () => {
    const image = files.find(item => item.source.label === "png")!.row;
    for (const suffix of deniedUrls) {
      const allowed = await read(productionFile.id, suffix); assert.equal(allowed.status, 200); await allowed.arrayBuffer();
      const denied = await read(image.id, suffix, foreign); assert.equal(denied.status, 404); assert.equal(denied.headers.get("etag"), null);
      const anonymous = await f.request(`/api/files/${image.id}${suffix}`); assert.equal(anonymous.status, 307);
      assert.equal(new URL(anonymous.headers.get("location")!, f.target.baseUrl).pathname, "/login");
      assert.notEqual(hash(new Uint8Array(await anonymous.arrayBuffer())), hash(png));
    }
  });
  await t.test("media.cache: 304 без body, preview priority400 и отзыв ACL до warm ETag", async () => {
    const image = files.find(item => item.source.label === "png")!.row;
    const first = await read(image.id, "?thumb=1"); const etag = first.headers.get("etag"); assert.ok(etag); await first.arrayBuffer();
    const unchanged = await read(image.id, "?thumb=1", engineer, { "if-none-match": etag });
    assert.equal(unchanged.status, 304); assert.equal(unchanged.body, null); assert.equal(unchanged.headers.get("content-length"), null);
    assert.equal(unchanged.headers.get("cache-control"), "private, max-age=0, must-revalidate");
    assert.ok(unchanged.headers.get("vary")?.split(/,\s*/).includes("Cookie"));
    assert.equal((await read(image.id, "?preview=unknown&thumb=1")).status, 400);
    await f.db.product.update({ where: { id: product.id }, data: { engineerId: foreign.id } });
    const revoked = await read(image.id, "?thumb=1", engineer, { "if-none-match": etag });
    assert.equal(revoked.status, 404); assert.equal(revoked.headers.get("etag"), null);
  });
  assert.deepEqual(await f.versions(project.id), originals, "GET и previews не изменяют ни одну S3-версию");
  for (const { source, row } of files) assert.equal(hash(await f.get(`${project.id}/${row.storedName}`)), hash(source.bytes));
  assert.deepEqual(await f.db.file.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }), rowsBefore);
  await f.verifyProtected();
});
