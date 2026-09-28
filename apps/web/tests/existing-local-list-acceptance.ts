import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";
import { existingLocalListDsn as localDsn } from "./existing-local-list-db";

const require = createRequire(import.meta.url);
const baseURL = "http://localhost:3103";
const keys = ["projects.list", "products.list"] as const;

async function businessCounts(prisma: PrismaClient) {
  const [users, clients, projects, products, tasks, works, payments, payouts, payroll, files] = await Promise.all([
    prisma.user.count(), prisma.client.count(), prisma.project.count(), prisma.product.count(), prisma.task.count(),
    prisma.work.count(), prisma.payment.count(), prisma.payout.count(), prisma.payrollEntry.count(), prisma.file.count(),
  ]);
  return { users, clients, projects, products, tasks, works, payments, payouts, payroll, files };
}

function stopRuntime(runtime: ChildProcess | undefined) {
  if (runtime?.pid && runtime.exitCode === null) {
    // Только порождённое этим helper дерево Node, не Docker/службы/другие runtime.
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(runtime.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else runtime.kill("SIGTERM");
  }
}

async function main() {
  const dsn = localDsn();
  const prisma = new PrismaClient({ datasourceUrl: dsn });
  const runDir = path.resolve("../../.playwright-mcp/local-list-acceptance", randomUUID());
  await mkdir(runDir, { recursive: true });
  const secret = randomBytes(48).toString("hex");
  const originals = new Map<string, string | null>();
  let runtime: ChildProcess | undefined;
  const result: Record<string, unknown> = { runDir, localDatabase: "127.0.0.1:5433/pero_crm", status: "pending" };
  try {
    const [identity] = await prisma.$queryRaw<{ database: string; role: string }[]>`SELECT current_database() AS database, current_user AS role`;
    assert.deepEqual(identity, { database: "pero_crm", role: "pero" }, "database identity mismatch");
    const users = await prisma.user.findMany({ where: { active: true, roles: { hasSome: ["ADMIN", "DIRECTOR", "MANAGER"] } }, orderBy: { id: "asc" }, take: 2, select: { id: true, name: true, email: true, roles: true, sessionVersion: true } });
    assert.equal(users.length, 2, "two existing management users required");
    const [project, product, engineer] = await Promise.all([
      prisma.project.findFirst({ orderBy: { numberInt: "desc" }, select: { id: true } }),
      prisma.product.findFirst({ where: { title: { not: "" } }, orderBy: { createdAt: "desc" }, select: { number: true, title: true } }),
      prisma.user.findFirst({ where: { active: true, roles: { has: "ENGINEER" } }, select: { id: true } }),
    ]);
    assert.ok(project && product && engineer, "existing project, product and engineer required");
    const beforeCounts = await businessCounts(prisma);
    result.beforeCounts = beforeCounts;
    for (const user of users) for (const key of keys) {
      const value = (await prisma.userPreference.findUnique({ where: { userId_key: { userId: user.id, key } } }))?.value ?? null;
      originals.set(`${user.id}/${key}`, value);
    }
    await writeFile(path.join(runDir, "preference-checkpoint.json"), JSON.stringify([...originals], null, 2), "utf8");
    const runtimeEnv = { ...process.env, DATABASE_URL: dsn, AUTH_SECRET: secret, AUTH_URL: baseURL, AUTH_TRUST_HOST: "true", S3_ENDPOINT: "", S3_BUCKET: "", S3_ACCESS_KEY: "", S3_SECRET_KEY: "" };
    for (const key of Object.keys(runtimeEnv)) if (/TELEGRAM|BOT_TOKEN|WEBHOOK/.test(key)) delete runtimeEnv[key as keyof typeof runtimeEnv];
    for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
      try { await readFile(name); throw new Error("Refusing runtime with an application env file; use the clean worktree"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const log = createWriteStream(path.join(runDir, "runtime.log"));
    runtime = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3103"], { env: runtimeEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    runtime.stdout?.pipe(log);
    runtime.stderr?.pipe(log);
    console.log(`Local filters runtime PID ${runtime.pid}; evidence ${runDir}`);
    const deadline = Date.now() + 60_000;
    for (;;) {
      try { if ((await fetch(`${baseURL}/login`)).status === 200) break; } catch { /* Только ожидание своего runtime */ }
      if (runtime.exitCode !== null || Date.now() > deadline) throw new Error("Local runtime did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const browserEnv: NodeJS.ProcessEnv = { ...process.env, CRM_E2E_BASE_URL: baseURL, CRM_E2E_PROJECT_PATH: `/projects/${project.id}`, CRM_E2E_PRODUCT_PATH: `/products/${product.number}`, CRM_E2E_ENGINEER_ID: engineer.id, CRM_E2E_PRODUCT_SEARCH: product.title.slice(0, 20), CRM_E2E_OWN_WRITES: path.join(runDir, "own-preference-writes.jsonl"), CRM_E2E_OUTPUT_DIR: path.join(runDir, "browser-artifacts") };
    for (const [index, account] of ["MANAGER", "OTHER"].entries()) {
      const user = users[index];
      const token = await encode({ secret, salt: "authjs.session-token", maxAge: 3600, token: { id: user.id, name: user.name, email: user.email, roles: user.roles, sessionVersion: user.sessionVersion } });
      const statePath = path.join(runDir, `${account.toLowerCase()}-state.json`);
      await writeFile(statePath, JSON.stringify({ cookies: [{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 3600 }], origins: [] }), "utf8");
      browserEnv[`CRM_E2E_${account}_STATE`] = statePath;
      browserEnv[`CRM_E2E_${account}_ID`] = user.id;
      browserEnv[`CRM_E2E_${account}_EMAIL`] = user.email;
    }
    const testArgs = [require.resolve("@playwright/test/cli"), "test", "--config", "tests/list-filters.playwright.config.ts"];
    if (process.env.CRM_E2E_GREP) testArgs.push("--grep", process.env.CRM_E2E_GREP);
    const test = spawn(process.execPath, testArgs, { env: browserEnv, windowsHide: true, stdio: "inherit" });
    const exitCode = await new Promise<number | null>((resolve) => test.on("exit", resolve));
    result.browserExitCode = exitCode;
    result.status = exitCode === 0 ? "passed" : "failed";
    if (exitCode !== 0) process.exitCode = 1;
  } finally {
    stopRuntime(runtime);
    const own = new Map<string, string>();
    try {
      for (const line of (await readFile(path.join(runDir, "own-preference-writes.jsonl"), "utf8")).split("\n").filter(Boolean)) {
        const row = JSON.parse(line);
        const id = `${row.userId}/${row.key}`;
        if (originals.has(id) && typeof row.value === "string") own.set(id, row.value);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const restored: string[] = [];
    const conflicts: string[] = [];
    // Перед записями повторно проверяются ровно те же container/volume/DB границы.
    if (originals.size > 0) assert.ok(localDsn() === dsn, "database binding changed before restore");
    for (const [id, original] of originals) {
      const split = id.lastIndexOf("/");
      const userId = id.slice(0, split), key = id.slice(split + 1);
      const current = (await prisma.userPreference.findUnique({ where: { userId_key: { userId, key } } }))?.value ?? null;
      if (current === original) { restored.push(id); continue; }
      const expected = own.get(id);
      if (!expected || current !== expected) { conflicts.push(id); continue; }
      const restore = original === null
        ? await prisma.userPreference.deleteMany({ where: { userId, key, value: expected } })
        : await prisma.userPreference.updateMany({ where: { userId, key, value: expected }, data: { value: original } });
      if (restore.count === 1) restored.push(id); else conflicts.push(id);
    }
    result.restoredPreferenceCount = restored.length;
    result.restoreConflicts = conflicts;
    result.afterCounts = await businessCounts(prisma);
    result.businessCountsUnchanged = !result.beforeCounts || JSON.stringify(result.afterCounts) === JSON.stringify(result.beforeCounts);
    if (conflicts.length > 0) result.status = "restore-conflict";
    if (!result.businessCountsUnchanged) result.status = "business-count-mismatch";
    await writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    await prisma.$disconnect();
    if (conflicts.length > 0) { process.exitCode = 1; console.error("STOP: preference restore conflict; no concurrent value was overwritten", { runDir, count: conflicts.length }); }
    else console.log("Preference checkpoint restored with exact compare-and-swap", { count: restored.length, runDir });
    if (result.beforeCounts) assert.deepEqual(result.afterCounts, result.beforeCounts, "business entity counts changed during list acceptance");
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
