import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const migration = "prisma/migrations/20261002140000_product_assembly_payroll_fields/migration.sql";
test("forward assembly payroll migration extends only the existing scheme allowlist", () => {
  const oldSql = readFileSync("prisma/migrations/20260930150000_product_percentage_pay/migration.sql", "utf8");
  const newSql = readFileSync(migration, "utf8");
  const check = (sql:string) => sql.match(/ADD CONSTRAINT "PayrollEntry_percentage_fields" CHECK \([\s\S]*?\n\);/)?.[0].replace(/\s+/g," ");
  assert.ok(check(oldSql));
  assert.equal(check(newSql),check(oldSql)?.replace("'PRODUCT_PERCENT_ENGINEERING','PRODUCT_PERCENT_INSTALLATION'","'PRODUCT_PERCENT_ENGINEERING','PRODUCT_PERCENT_INSTALLATION','PRODUCT_PERCENT_ASSEMBLY'"));
  assert.match(newSql,/DROP CONSTRAINT "PayrollEntry_percentage_fields"/);
  assert.doesNotMatch(newSql,/CREATE OR REPLACE FUNCTION|UPDATE|INSERT|DELETE|TRIGGER/);
});
