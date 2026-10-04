import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';

test('generated MaterialCategory default scalar fields match the historical warehouse table', () => {
  const model = Prisma.dmmf.datamodel.models.find(({ name }) => name === 'MaterialCategory');
  assert.ok(model);
  const historicalSql = readFileSync('prisma/migrations/20260720153036_warehouse/migration.sql', 'utf8');
  const table = historicalSql.match(/CREATE TABLE "MaterialCategory" \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(table);
  const historicalFields = [...table.matchAll(/^\s+"(\w+)"\s+/gm)].map(([, name]) => name);
  assert.deepEqual(model.fields.filter(({ kind }) => kind === 'scalar').map(({ name }) => name), historicalFields);
  assert.equal(model.fields.some(({ name }) => name === 'revision'), false);
  assert.equal(model.fields.find(({ name }) => name === 'active')?.default, true);
  assert.equal(model.fields.find(({ name }) => name === 'materials')?.kind, 'object');
});
