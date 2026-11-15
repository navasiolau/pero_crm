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

Принято root на `26f1d12ab131e673930475f30203e35797a062ce` после обычного merge `0193e95a`. [Штатный CI](https://github.com/navasiolau/pero_crm/actions/runs/43769709750): все 7 jobs SUCCESS. Watcher развернул web `sha256:43dd12130f2c62ebd2a30d16b29f29d657149b79b4d3049ae06449552badf217` и соответствующий renderer `sha256:2b01efb658993e99976cd7676c1a64b4c6ba959b610e6ee0390fbd3a9be61dd2`; обе OCI revisions совпали, health 200.

Штатный entrypoint применил `20261116120000_journal_event_presentation`; `pg_trgm` 1.6 установлен. Root выполнил тот же native probe внутри действующего staging web под W07: полные значения, System/инициатор при неизменном raw actor, ссылки, известный null, скрытие секретов, JSONB scope, raw receipt и rollback — PASS. 75 из 76 таблиц совпали с исходными hash/count; 5529 прежних ChangeLog сохранены. DB container/startedAt/volume и proxy сохранены. Итоговый receipt: `D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/accepted-221.json`.

ApiToken сохраняет 1346 строк, но полный hash меняется при работающем API: существующий `plugins/tokens.ts:42` обновляет lastUsedAt при чтении. Две дополнительные read-only проверки зафиксировали сдвиг последнего использования 22:49:41→22:50:11 UTC и один неизменный hash всех остальных колонок `8df20f8c69448a22ba367a68c15962dc`. Первоначальный снимок не выделял lastUsedAt отдельно; поэтому побайтовое совпадение ApiToken с самым первым снимком не утверждается. Остальные 75 таблиц, включая полный исходный ChangeLog, проверены непосредственно против первого снимка.

Собственный metadata observer сначала сравнивал порядок Docker Mounts и остановился на перестановке списка. Read-only сравнение всех полей доказало одинаковый состав; исправлена только нормализация порядка observer, W07/target guards не изменялись. Production и restic не затрагивались.
