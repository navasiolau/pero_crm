import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = resolve(root, 'apps/web/prisma/migrations');
const oldPath = resolve(directory, '20261006180000_product_percentage_nonempty_rates/migration.sql');
const additivePath = resolve(directory, '20261011130000_product_percentage_missing_configs/migration.sql');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalized = (sql) => sql.replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();
const statements = (sql) => normalized(sql).split(';').map((item) => item.trim()).filter(Boolean);
const additive = () => readFileSync(additivePath, 'utf8');

test('канонический Git SQL применённой миграции сохраняет точные исходные bytes', () => {
  // Windows checkout может преобразовать LF в CRLF; semantic SQL остаётся byte-exact после только этого преобразования.
  const bytes=readFileSync(oldPath);
  const canonicalBytes=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  assert.equal(sha(canonicalBytes), 'd0948074ff79ac17f365490440c851650550910a6909d952ca278464b3f80a62');
  const blob=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'hash-object',
    '--path=apps/web/prisma/migrations/20261006180000_product_percentage_nonempty_rates/migration.sql',oldPath]).toString('ascii').trim();
  assert.equal(blob,'9759270d3116248cf09eae309f8c8cacdaf6b808');
});

test('композиция исходных пяти строк и нового INSERT сохраняет прежние операции', () => {
  // Точные bytes blob32c0… закреплены SHA; shallow CI содержит только текущие Git objects.
  const baseline = Buffer.from("-- Backfill пустых процентных ставок нулями (решение владельца 06.10.2026: пустое = 0).\n-- Начислений, ревизий и истории не создаёт и не меняет; только заполняет NULL.\nUPDATE \"ProductPercentageConfig\" SET \"ratePercent\" = 0 WHERE \"ratePercent\" IS NULL;\nUPDATE \"OrgSetting\" SET \"value\" = REPLACE(\"value\", ':null', ':\"0.00\"')\nWHERE \"key\" = 'productPercentageDefaults' AND \"value\" LIKE '%null%';\n-- Изделия без конфигов (legacy-импорт) получают все три ставки 0: поле никогда не пустое.\nINSERT INTO \"ProductPercentageConfig\" (\"id\",\"productId\",\"kind\",\"ratePercent\",\"revision\",\"reviewedLegacyWorkIds\",\"createdAt\",\"updatedAt\")\nSELECT gen_random_uuid(), p.\"id\", k.\"kind\"::\"ProductPercentageKind\", 0, 1, '{}', NOW(), NOW()\nFROM \"Product\" p CROSS JOIN (VALUES ('ENGINEERING'),('ASSEMBLY'),('INSTALLATION')) AS k(\"kind\")\nWHERE NOT EXISTS (SELECT 1 FROM \"ProductPercentageConfig\" c WHERE c.\"productId\" = p.\"id\" AND c.\"kind\" = k.\"kind\"::\"ProductPercentageKind\");\n");
  assert.equal(sha(baseline), '277540457e9b832e483e0f3de3d09ee47d313bf845388605c6fd03be0488ee96');
  const insertWithoutConflict = additive().replace(/\s+ON CONFLICT\s*\(\s*"productId"\s*,\s*"kind"\s*\)\s+DO NOTHING\s*;/i, ';');
  assert.deepEqual(statements(`${readFileSync(oldPath, 'utf8')}\n${insertWithoutConflict}`), statements(baseline.toString('utf8')));
});

test('новая миграция атомарно вставляет и не повторяет старые UPDATE', () => {
  const sql = additive();
  const operations = statements(sql);
  assert.equal(operations.length, 1);
  assert.match(operations[0], /^INSERT INTO "ProductPercentageConfig" /);
  assert.doesNotMatch(normalized(sql), /\b(?:UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|BEGIN|COMMIT|ROLLBACK)\b/i);
});

test('добавляются все отсутствующие пары, включая частично настроенные и удалённые изделия', () => {
  const sql = normalized(additive());
  assert.match(sql, /CROSS JOIN \(VALUES \('ENGINEERING'\),\('ASSEMBLY'\),\('INSTALLATION'\)\)/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "ProductPercentageConfig" c WHERE c\."productId" = p\."id" AND c\."kind" = k\."kind"::"ProductPercentageKind"\)/);
  assert.match(sql, /SELECT gen_random_uuid\(\), p\."id", k\."kind"::"ProductPercentageKind", 0, 1, '\{\}', NOW\(\), NOW\(\)/);
  assert.doesNotMatch(sql, /"deletedAt"|"status"|"projectId"|ratePercent"\s+IS NULL/);
});

test('идемпотентность защищает только productId/kind и не подавляет PK collisions', () => {
  const sql = normalized(additive());
  assert.match(sql, /ON CONFLICT \("productId","kind"\) DO NOTHING;$/);
  assert.equal((sql.match(/\bON CONFLICT\b/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /DO UPDATE|ON CONFLICT DO NOTHING|ON CONFLICT \("id"\)/);
});
