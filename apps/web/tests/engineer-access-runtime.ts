import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { encode } from "@auth/core/jwt";
import { PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";

const baseUrl = "http://127.0.0.1:3101";
const secret = "engineer-access-test-local-only-secret";

async function main() {
  const databaseUrl = existingLocalCrmDatabaseUrl();
  if (process.argv.includes("--serve")) {
    // Normal CRM bootstrap updates only the two Plugin metadata records.
    // This is an explicit local acceptance server, never staging/production.
    const require = createRequire(import.meta.url);
    const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3101"], {
      stdio: "inherit", windowsHide: true,
      env: {
        ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: secret,
        AUTH_URL: baseUrl, NEXTAUTH_URL: baseUrl,
        S3_ENDPOINT: "", S3_BUCKET: "", S3_ACCESS_KEY: "", S3_SECRET_KEY: "",
      },
    });
    process.on("SIGINT", () => server.kill("SIGINT"));
    process.on("SIGTERM", () => server.kill("SIGTERM"));
    server.on("exit", (code) => { process.exitCode = code ?? 1; });
    return;
  }
  assert.ok(process.argv.includes("--check"), "Pass --serve or --check explicitly");
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const context = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const actor = await tx.user.findFirst({ where: { active: true, roles: { equals: ["ENGINEER"] }, engineeredProducts: { some: { status: "DESIGN" } } }, select: { id: true, roles: true, sessionVersion: true } });
      assert.ok(actor, "An existing active engineer with DESIGN products is required");
      const own = await tx.product.findMany({ where: { engineerId: actor.id, status: "DESIGN" }, select: { id: true, number: true, projectId: true } });
      const hidden = await tx.product.findFirst({ where: { OR: [{ engineerId: { not: actor.id } }, { status: { not: "DESIGN" } }] }, select: { id: true, number: true } });
      const hiddenFile = await tx.file.findFirst({ where: { product: { OR: [{ engineerId: { not: actor.id } }, { status: { not: "DESIGN" } }] } }, select: { id: true } });
      const tasks = await tx.task.findMany({ where: { product: { engineerId: actor.id, status: "DESIGN" } }, select: { id: true } });
      const before = await Promise.all([tx.user.count(), tx.project.count(), tx.product.count(), tx.file.count(), tx.task.count(), tx.work.count(), tx.timeEntry.count()]);
      assert.ok(hidden && hiddenFile, "Hidden real product and file are required");
      return { actor, own, hidden, hiddenFile, tasks, before };
    });
    // This is a signed isolated test session, not a password-login claim.
    const cookie = `authjs.session-token=${await encode({ secret, salt: "authjs.session-token", token: context.actor })}`;
    const headers = { cookie };
    const session = await (await fetch(`${baseUrl}/api/auth/session`, { headers })).json();
    assert.equal(session.user?.id, context.actor.id, "Signed test session validation failed");
    const allowedProducts = new Set(context.own.map((product) => product.id));
    const allowedProjects = new Set(context.own.map((product) => product.projectId));
    const allowedTasks = new Set(context.tasks.map((task) => task.id));
    for (const q of [context.own[0].number, context.hidden.number]) {
      const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(q)}`, { headers });
      assert.equal(response.status, 200, "Search endpoint failed");
      const body = await response.json();
      assert.ok(body.products.every((item: { id: string }) => allowedProducts.has(item.id)), "Search returned hidden product");
      assert.ok(body.projects.every((item: { id: string }) => allowedProjects.has(item.id)), "Search returned hidden project");
      assert.ok(body.tasks.every((item: { id: string }) => allowedTasks.has(item.id)), "Search returned hidden task");
    }
    for (const suffix of ["", "?thumb=1"]) {
      const response = await fetch(`${baseUrl}/api/files/${context.hiddenFile.id}${suffix}`, { headers });
      assert.equal(response.status, 404, "Hidden file endpoint must deny access");
      // Distinguishes policy denial from an allowed metadata lookup followed by
      // missing local bytes ("Файл не найден на диске"). No storage is touched.
      assert.deepEqual(await response.json(), { error: "Файл не найден" });
    }
    assert.equal((await fetch(`${baseUrl}/products/${encodeURIComponent(context.own[0].number)}`, { headers })).status, 200, "Own DESIGN page must open");
    assert.equal((await fetch(`${baseUrl}/products/${encodeURIComponent(context.hidden.number)}`, { headers })).status, 404, "Hidden product page must deny access");
    const after = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return Promise.all([tx.user.count(), tx.project.count(), tx.product.count(), tx.file.count(), tx.task.count(), tx.work.count(), tx.timeEntry.count()]);
    });
    assert.deepEqual(after, context.before, "Business record counts changed during read-only acceptance");
    console.log(JSON.stringify({ ok: true, signedTestSession: true, passwordLoginTested: false, searches: 2, hiddenFileDenials: 2, productPages: 2, businessCountsUnchanged: true }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : "Local runtime verification failed");
  process.exitCode = 1;
});
