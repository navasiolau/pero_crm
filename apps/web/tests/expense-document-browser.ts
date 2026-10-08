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
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.port === "5433" && target.pathname === "/pero_crm", "LOCAL_TARGET_GUARD");
assert.equal(process.env.CRM_FILE_STORAGE, "local");
const db = new PrismaClient(), baseUrl = "http://localhost:3097", marker = `qa-doc99-${randomUUID()}`;
const paymentId = randomUUID(), output = path.resolve("../../.playwright-mcp/finance99");
async function main() {
  const project = await db.project.findFirstOrThrow({ where: { currency: "BYN", deletedAt: null }, select: { id: true } });
  const article = { id: `${marker}-article` }, account = { id: `${marker}-cash` };
  const baseline = await Promise.all([db.user.count(), db.payment.count(), db.financeDocument.count(), db.file.count(), db.cashAccount.count(), db.expenseArticle.count()]);
  const secret = process.env.AUTH_SECRET; assert.ok(secret);
  const browser = await chromium.launch({ headless: true });
  try {
    await db.user.create({ data: { id: marker, name: marker, email: `${marker}@invalid.local`, passwordHash: "qa-login-disabled", roles: ["ACCOUNTANT"] } });
    await db.cashAccount.create({ data: { id: account.id, name: "QA99 Касса", currency: "BYN", createdAt: new Date("2000-01-01T00:00:00Z") } });
    const maxCode = await db.expenseArticle.aggregate({ _max: { code: true } });
    await db.expenseArticle.create({ data: { id: article.id, name: "QA99 Материалы", code: (maxCode._max.code ?? 0) + 1 } });
    const token = await encode({ secret, salt: "authjs.session-token", maxAge: 600, token: { id: marker, sub: marker, sessionVersion: 0 } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: "authjs.session-token", value: token, url: baseUrl, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await mkdir(output, { recursive: true });
    await page.goto(`${baseUrl}/finance/projects/${project.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Добавить расход", exact: true }).click();
    await page.locator("#pay-amount").fill("10");
    assert.equal(await page.getByRole("button", { name: "Внести расход", exact: true }).isDisabled(), true);
    const image = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#dcfce7" } }).png().toBuffer();
    await page.locator("#pay-document").setInputFiles({ name: "QA99 receipt.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "QA99 receipt.png", exact: true }).waitFor();
    await expect(page.getByRole("button", { name: "Внести расход", exact: true })).toBeEnabled();
    await page.getByRole("dialog").screenshot({ path: path.join(output, "expense-dialog-desktop.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "MOBILE_OVERFLOW");
    await page.getByRole("dialog").screenshot({ path: path.join(output, "expense-dialog-mobile.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Внести расход", exact: true }).scrollIntoViewIfNeeded();
    const submitBox = await page.getByRole("button", { name: "Внести расход", exact: true }).boundingBox();
    assert.ok(submitBox && submitBox.y >= 0 && submitBox.y + submitBox.height <= 844, "MOBILE_SUBMIT_NOT_REACHABLE");
    await page.getByRole("dialog").screenshot({ path: path.join(output, "expense-dialog-mobile-footer.png"), animations: "disabled" });
    // Сохранение расхода проверяется PostgreSQL native с rollback; здесь создаётся только нулевая read-фикстура без рассылок.
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    const storedDocument = await db.financeDocument.findFirstOrThrow({ where: { uploadedById: marker, state: "READY" } });
    await db.payment.create({ data: { id: paymentId, projectId: project.id, direction: "EXPENSE", amount: 0, currency: "BYN", rate: 1,
      bynAmount: 0, projectAmount: 0, expenseArticleId: article.id, cashAccountId: account.id, reportDocumentId: storedDocument.id,
      comment: marker, createdById: marker } });
    await page.reload({ waitUntil: "networkidle" });
    const searches = page.getByPlaceholder("Поиск по расходам…");
    await searches.fill("QA99 receipt.png");
    await page.getByRole("button", { name: "QA99 receipt.png", exact: true }).click();
    const picture = page.getByRole("img", { name: "QA99 receipt.png", exact: true });
    await expect.poll(() => picture.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(320);
    assert.equal(await db.payment.count({ where: { id: paymentId, amount: 0 } }), 1);
    console.log("BROWSER99: required file, confirmed upload, 1440/390 dialog, expense-row original viewer PASS; no monetary submit/messages");
  } finally {
    await browser.close();
    const documents = await db.financeDocument.findMany({ where: { uploadedById: marker } });
    for (const document of documents) {
      assert.ok(document.storageKey.startsWith(`finance-documents/${document.id}/`));
      const root = await realpath(path.resolve("uploads")), file = await realpath(path.join(root, ...document.storageKey.split("/")));
      const relative = path.relative(root, file); assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative)); await unlink(file);
    }
    await db.$transaction(async tx => {
      await tx.payment.deleteMany({ where: { id: paymentId, comment: marker } });
      await tx.changeLog.deleteMany({ where: { actorId: marker, entity: "financeDocument" } });
      await tx.financeDocument.deleteMany({ where: { uploadedById: marker } });
      await tx.user.deleteMany({ where: { id: marker, name: marker } });
      await tx.cashAccount.deleteMany({ where: { id: account.id, name: "QA99 Касса" } });
      await tx.expenseArticle.deleteMany({ where: { id: article.id, name: "QA99 Материалы" } });
    });
    assert.deepEqual(await Promise.all([db.user.count(), db.payment.count(), db.financeDocument.count(), db.file.count(), db.cashAccount.count(), db.expenseArticle.count()]), baseline);
    await db.$disconnect(); console.log("BROWSER99: own rows/files cleaned; original counts MATCH");
  }
}
void main().catch(async error => { console.error(error); await db.$disconnect(); process.exitCode = 1; });
