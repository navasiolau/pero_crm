import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

process.loadEnvFile(".env");
const target = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.port === "5433" && target.pathname === "/pero_crm", "LOCAL_DATABASE_GUARD");
assert.equal(process.env.CRM_FILE_STORAGE, "local", "LOCAL_STORAGE_GUARD");
const baseUrl = "http://localhost:3097";
const db = new PrismaClient(), userId = `qa-finance97-ui-${randomUUID()}`;
const output = path.resolve("../../.playwright-mcp/finance97");

async function main() {
  const beforeUsers = await db.user.count(), beforeDocs = await db.financeDocument.count(), beforeFiles = await db.file.count();
  await db.user.create({ data: { id: userId, name: "QA финансовые документы 97", email: `${userId}@invalid.local`, passwordHash: "qa-login-disabled", roles: ["ACCOUNTANT"] } });
  const browser = await chromium.launch({ headless: true });
  const secret = process.env.AUTH_SECRET;
  assert.ok(secret);
  const cookie = await encode({ secret, salt: "authjs.session-token", maxAge: 600, token: { id: userId, sub: userId, sessionVersion: 0 } });
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "authjs.session-token", value: cookie, url: baseUrl, httpOnly: true, sameSite: "Lax" }]);
  try {
    const page = await context.newPage();
    const pageErrors: string[] = []; page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/finance/documents`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Отчётные документы" }).waitFor();
    const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#dbeafe" } }).png().toBuffer();
    await page.locator('input[type="file"]').setInputFiles({ name: "QA 97 Receipt.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "QA 97 Receipt.png", exact: true }).waitFor();
    assert.equal(await db.financeDocument.count({ where: { uploadedById: userId, state: "READY" } }), 1);
    await page.screenshot({ path: path.join(output, "documents-desktop.png"), fullPage: true });
    await page.getByRole("button", { name: "QA 97 Receipt.png", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    const picture = page.getByRole("img", { name: "QA 97 Receipt.png", exact: true });
    await expect.poll(() => picture.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(640);
    await page.screenshot({ path: path.join(output, "document-viewer.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Закрыть полноэкранный просмотр" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "documents-mobile.png"), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "MOBILE_OVERFLOW");
    const storedDocument = await db.financeDocument.findFirstOrThrow({ where: { uploadedById: userId } });
    const response = await context.request.get(`${baseUrl}/api/finance/documents/${storedDocument.id}`);
    assert.equal(response.status(), 200); assert.deepEqual(await response.body(), png);
    const repeatId = randomUUID();
    const request = { multipart: { clientMutationId: repeatId, file: { name: "Receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nQA97") } } };
    const first = await context.request.post(`${baseUrl}/api/finance/documents/upload`, request);
    assert.equal(first.status(), 201);
    const repeated = await context.request.post(`${baseUrl}/api/finance/documents/upload`, request);
    assert.equal(repeated.status(), 200); assert.equal((await first.json()).document.id, (await repeated.json()).document.id);
    await db.user.update({ where: { id: userId }, data: { roles: ["MANAGER"] } });
    const revoked = await context.request.get(`${baseUrl}/api/finance/documents/${storedDocument.id}`, { maxRedirects: 0 });
    // Триггер изменения ролей отзывает прежнюю сессию; новая сессия менеджера также не получает bytes.
    assert.equal(revoked.status(), 307);
    assert.equal(new URL(revoked.headers().location, baseUrl).pathname, "/login");
    const changedUser = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
    const managerCookie = await encode({ secret, salt: "authjs.session-token", maxAge: 600,
      token: { id: userId, sub: userId, sessionVersion: changedUser.sessionVersion } });
    await context.addCookies([{ name: "authjs.session-token", value: managerCookie, url: baseUrl, httpOnly: true, sameSite: "Lax" }]);
    assert.equal((await context.request.get(`${baseUrl}/api/finance/documents/${storedDocument.id}`, { maxRedirects: 0 })).status(), 403);
    assert.deepEqual(pageErrors, [], "BROWSER_RUNTIME_ERRORS");
    console.log("BROWSER97: actual upload/original bytes/viewer/retry/role revocation and 1440/390 layout PASS");
  } finally {
    await browser.close();
    const documents = await db.financeDocument.findMany({ where: { uploadedById: userId } });
    for (const document of documents) {
      assert.match(document.storageKey, /^finance-documents\/[0-9a-f-]{36}\/[0-9a-f]{64}$/);
      const root = await realpath(path.resolve("uploads"));
      const file = await realpath(path.join(root, ...document.storageKey.split("/")));
      const relative = path.relative(root, file);
      assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "FILE_CLEANUP_GUARD");
      await unlink(file);
    }
    await db.$transaction(async tx => {
      await tx.changeLog.deleteMany({ where: { actorId: userId, entity: "financeDocument" } });
      await tx.financeDocument.deleteMany({ where: { uploadedById: userId } });
      await tx.user.delete({ where: { id: userId } });
    });
    assert.equal(await db.user.count(), beforeUsers); assert.equal(await db.financeDocument.count(), beforeDocs); assert.equal(await db.file.count(), beforeFiles);
    console.log("BROWSER97: own test rows/bytes removed; original entity counts MATCH");
    await db.$disconnect();
  }
}
void main().catch(async error => { console.error(error); await db.$disconnect(); process.exitCode = 1; });
