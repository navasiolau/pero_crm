import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { createPostgresContractTransaction } from "../src/server/kp/contract-store";
import { ContractWorkflowError } from "../src/server/kp/contract-types";
import { assertContractNativeDatabaseIdentity, assertContractNativeTarget, runContractDatabaseNativeCases } from "./kp-contract-native-cases";
import { contractWorkflowFixture } from "./helpers/contract-workflow-fixture";

const nativeProof = () => ({ databaseUrl: "postgresql://pero:synthetic-unused-password@127.0.0.1:5433/pero_crm", expectedDatabase: "pero_crm", rollbackOnly: true as const,
  declaration: { target: "local" as const, revision: "d".repeat(40), runId: "a5dcac6e-bc7d-4707-8072-7771854d4ee8", scenarioId: "kp-contract-workflow" } });

test("store проверяет текущего пользователя, версию сессии, владельца/scopes и отзыв ключа", async () => {
  const user = { id: "manager", name: "Менеджер", active: true, roles: ["MANAGER"] as Role[], sessionVersion: 2 };
  const token = { createdById: "manager", revokedAt: null as Date | null, scopes: ["kp:contracts:generate"], pluginId: null as string | null, plugin: { enabled: true } };
  const tx = createPostgresContractTransaction({ $queryRaw: async () => [], user: { findUnique: async () => ({ ...user }) }, apiToken: { findUnique: async () => ({ ...token }) } } as unknown as Prisma.TransactionClient);
  assert.equal((await tx.authorize({ id: "manager", source: "web", sessionVersion: 2 }, "kp:contracts:read")).id, "manager");
  const rejected = (error: unknown) => error instanceof ContractWorkflowError && error.status === 403;
  await assert.rejects(tx.authorize({ id: "manager", source: "web", sessionVersion: 1 }, "kp:contracts:read"), rejected);
  await assert.rejects(tx.authorize({ id: "manager", source: "web" }, "kp:contracts:read"), rejected);
  await assert.rejects(tx.authorize({ id: "manager", source: "api" }, "kp:contracts:generate"), rejected);
  const actor = { id: "manager", source: "api" as const, tokenId: "key" };
  assert.equal((await tx.authorize(actor, "kp:contracts:generate")).id, "manager");
  await assert.rejects(tx.authorize(actor, "kp:contracts:write"), rejected);
  token.revokedAt = new Date(); await assert.rejects(tx.authorize(actor, "kp:contracts:generate"), rejected); token.revokedAt = null;
  token.createdById = "other"; await assert.rejects(tx.authorize(actor, "kp:contracts:generate"), rejected); token.createdById = "manager";
  token.pluginId = "plugin"; token.plugin.enabled = false; await assert.rejects(tx.authorize(actor, "kp:contracts:generate"), rejected); token.pluginId = null;
  user.active = false; await assert.rejects(tx.authorize(actor, "kp:contracts:generate"), rejected); user.active = true;
  user.roles = ["WORKER"]; await assert.rejects(tx.authorize(actor, "kp:contracts:generate"), rejected);
});

test("native guard отклоняет удалённую цель, legacy5432 и другое имя до первого DB-вызова", async () => {
  const good = nativeProof();
  assert.doesNotThrow(() => assertContractNativeTarget(good));
  let calls = 0;
  const tx = { $queryRaw: async () => { calls++; throw Error("Нельзя подключаться"); } } as unknown as Prisma.TransactionClient;
  for (const databaseUrl of ["postgresql://qa:unused@prod.invalid:5433/pero_crm", "postgresql://qa:unused@127.0.0.1:5432/pero_crm", "postgresql://qa:unused@127.0.0.1:5433/other"]) {
    await assert.rejects(runContractDatabaseNativeCases(tx, { ...good, databaseUrl }, contractWorkflowFixture().ports), /local5433/);
  }
  assert.equal(calls, 0);
});

test("native declaration и явный rollback обязательны до первого DB-вызова", async () => {
  const good = nativeProof(), { declaration: _declaration, ...withoutDeclaration } = good; void _declaration;
  let calls = 0;
  const tx = { $queryRaw: async () => { calls++; throw Error("Запрещённый DB-вызов"); } } as unknown as Prisma.TransactionClient;
  const invalid = [withoutDeclaration, { ...good, rollbackOnly: false }, { ...good, expectedDatabase: "other", databaseUrl: "postgresql://pero:unused@127.0.0.1:5433/other" },
    ...[{ ...good.declaration, target: "staging" }, { ...good.declaration, revision: "invalid" }, { ...good.declaration, runId: "invalid" }, { ...good.declaration, scenarioId: "" }, { ...good.declaration, scenarioId: "../unsafe" }].map(declaration => ({ ...good, declaration }))];
  for (const proof of invalid) await assert.rejects(runContractDatabaseNativeCases(tx, proof as typeof good, contractWorkflowFixture().ports), /local5433/);
  assert.equal(calls, 0);
});

test("pure URL guard сверяет полную guarded binding без Docker и без раскрытия credentials", () => {
  const good = nativeProof();
  assert.doesNotThrow(() => assertContractNativeTarget(good, good.databaseUrl));
  for (const databaseUrl of [good.databaseUrl.replace("synthetic-unused-password", "synthetic-different-password"), good.databaseUrl.replace("pero:", "other:"), good.databaseUrl + "?schema=public", good.databaseUrl.replace("127.0.0.1", "127.0.0.2"), good.databaseUrl + "#ignored"]) {
    assert.throws(() => assertContractNativeTarget({ ...good, databaseUrl }, good.databaseUrl), error => error instanceof Error && /local5433/.test(error.message) && !error.message.includes("password"));
  }
});

test("Docker host5433 и PostgreSQL internal5432 проверяются отдельно; DI не является native acceptance", () => {
  const good = nativeProof();
  const listener = { database: "pero_crm", schema: "public", user: "pero", serverPort: 5432, tableReady: true, serverAddress: "172.18.0.3" };
  assert.doesNotThrow(() => assertContractNativeDatabaseIdentity(good, [listener]));
  assert.throws(() => assertContractNativeDatabaseIdentity(good, []), /цель/);
  for (const row of [{ ...listener, database: "other" }, { ...listener, schema: "other" }, { ...listener, user: "other" }, { ...listener, tableReady: false }, { ...listener, serverAddress: "127.0.0.1", serverPort: 5433 }]) {
    assert.throws(() => assertContractNativeDatabaseIdentity(good, [row]), /цель/);
  }
});
