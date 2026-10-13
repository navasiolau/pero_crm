import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaClient, type Prisma, type Role } from "@prisma/client";
import { nativeSnapshot, verifiedRollback } from "../helpers/native-acceptance-snapshot";
import { assertCiRuntimeTarget } from "./runtime/target.mjs";

type RowsDb = Pick<Prisma.TransactionClient, "user" | "client" | "project" | "product">;
type UserFields = Omit<Prisma.UserUncheckedCreateInput, "id" | "email" | "name" | "passwordHash" | "roles">;
type ProjectFields = Omit<Prisma.ProjectUncheckedCreateInput, "id" | "number" | "numberInt" | "title" | "clientId">;
type ProductFields = Omit<Prisma.ProductUncheckedCreateInput, "id" | "number" | "title" | "projectId" | "suffixInt">;
const numberFor = (value: string) => 1_000_000_000 + Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 7), 16);

function syntheticRows(db: RowsDb, prefix: string) {
  const id = (label: string) => {
    assert.match(label, /^[a-z0-9][a-z0-9.-]{0,70}$/, "CI_FIXTURE_LABEL_INVALID");
    return `${prefix}-${label}`;
  };
  const user = (label: string, roles: Role[], fields: UserFields = {}) => db.user.create({ data: {
    ...fields, id: id(label), name: `Проверка169 ${label}`, email: `${id(label)}@example.invalid`,
    passwordHash: "CI169_NO_PASSWORD_LOGIN", roles,
  } });
  const project = async (label: string, fields: ProjectFields = {}) => {
    const client = await db.client.create({ data: { id: id(`${label}-client`), name: "Синтетический клиент169", phone: "CI169" } });
    const numberInt = numberFor(id(label));
    return db.project.create({ data: { ...fields, id: id(label), title: `Проверка169 ${label}`, number: String(numberInt), numberInt, clientId: client.id } });
  };
  const product = async (label: string, projectId: string, fields: ProductFields = {}) => {
    const parent = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { number: true } });
    const suffixInt = numberFor(id(label)) - 999_999_999;
    return db.product.create({ data: { ...fields, id: id(label), title: `Проверка169 ${label}`, projectId,
      number: `${parent.number}.${suffixInt}`, suffixInt } });
  };
  return { id, user, project, product };
}
export type PostgresRows = ReturnType<typeof syntheticRows>;

/** Import ничего не подключает; все строки принадлежат временному CI-стенду. */
export async function createPostgresFixture(scenarioId: string) {
  assert.match(scenarioId, /^[a-z0-9][a-z0-9.-]{0,50}$/, "CI_SCENARIO_INVALID");
  const target = assertCiRuntimeTarget();
  const db = new PrismaClient({ datasourceUrl: target.databaseUrl });
  const peer = new PrismaClient({ datasourceUrl: target.databaseUrl });
  const rows = syntheticRows(db, `ci169-${target.runId}-${target.attempt}-${scenarioId}`);
  try {
    for (const client of [db, peer]) assert.deepEqual(await client.$queryRawUnsafe(
      "SELECT current_database() AS database,current_schema() AS schema,current_user AS role,current_setting('server_version_num')::int / 10000 AS major"
    ), [{ database: "pero_ci", schema: "public", role: "ci_runner", major: 17 }], "CI_DATABASE_IDENTITY_MISMATCH");
    const sentinelUser = await rows.user("protected-user", ["ENGINEER"]);
    const sentinelProject = await rows.project("protected-project", { currency: "BYN", initialPrice: "123.45" });
    const sentinelClient = await db.client.findUniqueOrThrow({ where: { id: sentinelProject.clientId } });
    const sentinelProduct = await rows.product("protected-product", sentinelProject.id, { status: "DESIGN", expectedPrice: "10.01", initialPrice: "123.45", quantity: 3, engineerId: sentinelUser.id });
    const verifyProtected = async () => assert.deepEqual(await Promise.all([
      db.user.findUnique({ where: { id: sentinelUser.id } }), db.client.findUnique({ where: { id: sentinelClient.id } }),
      db.project.findUnique({ where: { id: sentinelProject.id } }), db.product.findUnique({ where: { id: sentinelProduct.id } }),
    ]), [sentinelUser, sentinelClient, sentinelProject, sentinelProduct], "CI_PROTECTED_SENTINELS_CHANGED");
    let rollbackIndex = 0;
    const rollback = async <T>(operation: (tx: Prisma.TransactionClient, fixtures: ReturnType<typeof syntheticRows>) => Promise<T>): Promise<T> => {
      const before = await nativeSnapshot(db), marker = new Error("CI169_EXPECTED_ROLLBACK");
      let result: T | undefined;
      await verifiedRollback(async () => {
        try {
          await db.$transaction(async tx => {
            result = await operation(tx, syntheticRows(tx, `${rows.id("rollback")}-${++rollbackIndex}`));
            throw marker;
          }, { timeout: 120_000, maxWait: 10_000 });
          assert.fail("CI_ROLLBACK_MARKER_NOT_RAISED");
        } catch (error) { if (error !== marker) throw error; }
      }, async () => assert.deepEqual(await nativeSnapshot(db), before, "CI_ROLLBACK_DATA_SCHEMA_CHANGED"));
      return result as T;
    };
    return { target, db, peer, ...rows, verifyProtected, rollback,
      // Append-only деньги не удаляем поштучно: runtime уничтожает весь synthetic stand.
      dispose: async () => { await Promise.all([db.$disconnect(), peer.$disconnect()]); } };
  } catch (error) { await Promise.allSettled([db.$disconnect(), peer.$disconnect()]); throw error; }
}

export async function rejectedSql(tx: Prisma.TransactionClient, operation: () => Promise<unknown>, pattern?: RegExp) {
  await tx.$executeRawUnsafe("SAVEPOINT ci169_rejected_sql");
  try { if (pattern) await assert.rejects(operation, pattern); else await assert.rejects(operation); }
  finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ci169_rejected_sql");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT ci169_rejected_sql");
  }
}
