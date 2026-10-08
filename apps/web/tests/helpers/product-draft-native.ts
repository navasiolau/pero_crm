import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import type { Prisma, PrismaClient } from "@prisma/client";

export function assertDraftTarget() {
  const target = process.env.CRM_MODERNIZATION_TARGET;
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.searchParams.get("schema") ?? "public", "public");
  if (target === "local") {
    assert.equal(process.platform, "win32");
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.equal(url.port, "5433"); assert.equal(url.pathname, "/pero_crm");
  } else if (target === "staging") {
    assert.ok(existsSync("/.dockerenv") && /^[a-f0-9]{12,64}$/.test(hostname()));
    assert.equal(url.hostname, "db"); assert.equal(url.pathname, "/crm");
    assert.equal(process.env.S3_BUCKET, "pero-crm-staging");
    const proof = JSON.parse(process.env.CRM_MODERNIZATION_STAGE_PROOF ?? "");
    assert.equal(proof.hostname, "crm-staging"); assert.equal(proof.databaseVolume, "crm-staging_pgdata");
    assert.match(proof.revision, /^[a-f0-9]{40}$/); assert.match(proof.outerW07Sha256, /^[a-f0-9]{64}$/);
  } else throw Error("EXPLICIT_LOCAL_STAGING_TARGET_REQUIRED");
  return target;
}

export async function assertDraftDatabase(db: PrismaClient | Prisma.TransactionClient, target: string) {
  const [identity] = await db.$queryRaw<{ name: string; schema: string }[]>`SELECT current_database() AS name,current_schema() AS schema`;
  assert.equal(identity.name, target === "local" ? "pero_crm" : "crm"); assert.equal(identity.schema, "public");
}

export type Fingerprints = Record<string, { count: string; hash: string }>;
export async function draftFingerprint(db: PrismaClient | Prisma.TransactionClient, productBusinessOnly = false): Promise<Fingerprints> {
  const tables = await db.$queryRaw<{ name: string }[]>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Fingerprints = {};
  for (const { name } of tables) {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    const row = productBusinessOnly && name === "Product" ? "(to_jsonb(t)-'status'-'statusChangedAt')::text" : "row_to_json(t)::text";
    const [hash] = await db.$queryRawUnsafe<{ count: string; hash: string }[]>(
      'SELECT count(*)::text AS count,md5(COALESCE(string_agg(' + row + ",'' ORDER BY " + row + "),'')) AS hash FROM " + '"' + name + '" t',
    );
    result[name] = hash;
  }
  return result;
}
/** Ошибки driver/child_process могут содержать URL/stdout с credentials. */
export function reportDraftNativeError(error: unknown) {
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name) ? error.name : "UnknownError";
  const driverCode = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  const code = typeof driverCode === "string" && /^[A-Za-z0-9_]{1,80}$/.test(driverCode) ? driverCode : undefined;
  const guard = error instanceof Error ? /\bLOCAL111_[A-Z_]{1,80}\b/.exec(error.message)?.[0] : undefined;
  const meta = error && typeof error === "object" ? (error as { meta?: unknown }).meta : undefined;
  const rawState = meta && typeof meta === "object" ? (meta as { code?: unknown }).code : undefined;
  const sqlState = typeof rawState === "string" && /^[A-Z0-9]{5}$/.test(rawState) ? rawState : undefined;
  console.error(JSON.stringify({ error: name, ...(code ? { code } : {}), ...(guard ? { guard } : {}), ...(sqlState ? { sqlState } : {}) }));
}
export type DraftSchemaFingerprint = {
  columns: { count: string; hash: string };
  constraints: { count: string; hash: string };
  indexes: { count: string; hash: string };
  enums: { count: string; hash: string };
  productStatusDefault: string | null;
};
/** Только hashes каталога; определения/default остаются в памяти для сравнения. */
export async function draftSchemaFingerprint(db: PrismaClient | Prisma.TransactionClient): Promise<DraftSchemaFingerprint> {
  const [columns] = await db.$queryRaw<{ count: string; hash: string }[]>`
    SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(row_to_json(c)::text,'' ORDER BY c.table_name,c.ordinal_position),'')) AS hash
    FROM (
      SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,
        udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,
        datetime_precision,is_identity,identity_generation,is_generated,generation_expression
      FROM information_schema.columns WHERE table_schema='public'
    ) c
  `;
  const [constraints] = await db.$queryRaw<{ count: string; hash: string }[]>`
    SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(row_to_json(c)::text,'' ORDER BY c.table_name,c.constraint_name),'')) AS hash
    FROM (
      SELECT t.relname AS table_name,c.conname AS constraint_name,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public'
    ) c
  `;
  const [indexes] = await db.$queryRaw<{ count: string; hash: string }[]>`
    SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(row_to_json(i)::text,'' ORDER BY i.tablename,i.indexname),'')) AS hash
    FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') i
  `;
  const [enums] = await db.$queryRaw<{ count: string; hash: string }[]>`
    SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(row_to_json(e)::text,'' ORDER BY e.type_name,e.enumsortorder),'')) AS hash
    FROM (
      SELECT t.typname AS type_name,e.enumlabel,e.enumsortorder FROM pg_enum e
      JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public'
    ) e
  `;
  const [status] = await db.$queryRaw<{ value: string | null }[]>`
    SELECT column_default AS value FROM information_schema.columns
    WHERE table_schema='public' AND table_name='Product' AND column_name='status'
  `;
  assert.ok(status, "Product.status column is required");
  return { columns, constraints, indexes, enums, productStatusDefault: status.value };
}