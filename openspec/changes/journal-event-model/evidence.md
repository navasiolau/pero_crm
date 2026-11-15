# Проверки №221

База ветки `feature/221`: `a391e5f1df7f307905513df7e1d46a10bee09a01`. Изолированный worktree `D:/Projects/pero_crm_worktrees/journal-221`; собственная установка `pnpm install --offline --frozen-lockfile`, версии и lockfile не менялись.

## Local

- RED: после генерации отсутствовавшего Prisma Client новый тест завершался `Cannot find module '../src/server/changelog/presentation'`; реализации ещё не было. Ошибка prerequisite до generate не считается проверкой поведения.
- GREEN: `pnpm --filter @pero/web exec tsx --test tests/journal-model.test.ts` — **18/18 PASS**. Проверены полные длинные/вложенные значения, literal кавычки/переносы в поиске, reference labels, scalar hints, sparse legacy/явный null/полные snapshots, self-context без parent fanout, точная классификация receipts, system/initiator, raw receipt и ошибка обязательного writer.
- Security: вложенные/скалярные секреты, варианты имён полей, JSON-строки, signed URL credentials, Bearer, бинарные data URI/буферы, очистка сохранённого presentation и небезопасных ссылок. Изменение секрета сохраняет факт изменения, обе стороны скрыты.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — PASS после функциональных правок.
- Scoped ESLint для четырёх новых модулей, bridge и теста — PASS, в том числе после дополнения словарей №225/227.
- `pnpm db:generate` и `prisma validate` — PASS. Validate получил только фиктивный URL синтаксической проверки; worker не подключался к БД.
- Полная web-регрессия — **1462/1462 PASS**, 99,9 с, на промежуточном cut перед последними дополнениями formatter/security/self-context/search. Последние изменения проверены целевыми 18 тестами, typecheck и lint; CI должен повторить полный набор на итоговом SHA.
- `openspec validate journal-event-model --strict` и `git diff --check` — PASS.

## Root native

Сообщение оркестратора: миграция применена на существующем guarded PostgreSQL 16.14, loopback 5433. SHA-256 SQL `4f92e37f42f2bb38b72ee756c9c60e94807a3bf004b3a634174072dc64d95436`; после этой проверки schema/migration не изменялись.

Root native **8 assertions PASS**: full values, system/raw receipt, references/null/secrets, scope SQL и rollback. Сохранность всех 76 существующих таблиц подтверждена hash/count; 289 исходных ChangeLog сохранены. Приватные evidence у оркестратора: `.playwright-mcp/journal-221-228/local221-model.stdout.private.log` и `local221-preservation.json` в основном workspace. Этот результат не подменяет приёмку staging.

## Staging

PENDING: обычный merge/CI, проверка фактического SHA/образа/здоровья и runtime оркестратором. Коммит/push/merge worker не выполнял. Production, restic и инфраструктура не изменялись.
