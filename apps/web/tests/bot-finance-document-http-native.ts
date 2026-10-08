import assert from "node:assert/strict";
import { readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runBotFinanceDocumentHttp } from "./bot-finance-document-http-scenarios";

process.loadEnvFile(".env");
const target = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.port === "5433" && target.pathname === "/pero_crm", "LOCAL_TARGET_GUARD");
assert.equal(process.env.CRM_FILE_STORAGE, "local");
const db = new PrismaClient();
const port = process.env.CRM_QA_PORT ?? "3098";
assert.ok(["3097", "3098"].includes(port), "LOCAL_HTTP_PORT_GUARD");
void runBotFinanceDocumentHttp(db, `http://127.0.0.1:${port}`, async (document, expected) => {
  assert.equal(document.storageMode, "local"); assert.ok(document.storageKey.startsWith(`finance-documents/${document.id}/`));
  const root = await realpath(path.resolve("uploads")), file = await realpath(path.join(root, ...document.storageKey.split("/")));
  const relative = path.relative(root, file); assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.deepEqual(await readFile(file), expected); await unlink(file);
}, process.env.CRM_QA_REQUIRE_DOCUMENT === "1").then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
