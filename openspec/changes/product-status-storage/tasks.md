# Tasks

## 1. Схема и миграция БД

- [x] 1.1 Переименовать `DELIVERY` → `STORAGE` в `enum ProductStatus` (`schema.prisma`) и выполнить `pnpm db:generate`; проверка — клиент генерируется без ошибок, `rg DELIVERY schema.prisma` пуст.
- [x] 1.2 Создать новую миграцию только с `ALTER TYPE "ProductStatus" RENAME VALUE 'DELIVERY' TO 'STORAGE'`; старые миграции не тронуты; проверка — `git status` показывает только `schema.prisma` + новый каталог миграции.
- [ ] 1.3 Применить миграцию на локальной БД (PostgreSQL 5433) через `pnpm db:migrate` и проверить `SELECT enumlabel FROM pg_enum`; проверка — `STORAGE` есть, `DELIVERY` нет. ЗАБЛОКИРОВАНО: `migrate dev` требует reset из-за дрейфа трёх старых миграций (см. `evidence.md`); reset без поручения владельца запрещён. Решение владельца: baseline/resolve без потери данных (предпочтительно) либо reset с потерей (запрещён AGENTS.md без отдельного поручения).
- [x] 1.4 Доказать диагноз дрейфа чтением: `migrate status` (51 applied / 3 pending), аудит `sha256` файлов vs `_prisma_migrations.checksum` (48/51 blob=БД, 16 — только CRLF/LF, 3 — истинный дрейф черновик→коммит), `git diff origin/staging -- migrations/` пуст; проверка — раздел «Диагноз дрейфа» в `evidence.md`.
- [x] 1.5 Доказать SQL миграции транзакцией с ROLLBACK на локальной 5433 (enum + 1305/69 + история, затем откат); проверка — раздел «Ключевая проверка» в `evidence.md`, БД не изменена.
- [x] 1.6 Обосновать безопасность `db:deploy` на staging/prod (entrypoint Dockerfile, доки Prisma 6: pending-only + warning-not-reset, дрейф локальный, наша миграция последняя и независима); проверка — раздел «Безопасность deploy-пути» в `evidence.md`.

## 2. Код и триггеры

- [x] 2.1 Обновить `lib/product-statuses.ts` (лейбл «На складе ГП», ключ `STORAGE`, стили cyan без изменений) и `lib/product-percentage-status.ts`, `server/product-percentage-pay/core.ts` (`reached`), `server/product-stage-pay/core.ts` (`assertEngineeringTransition`); проверка — `rg DELIVERY apps/web/src` не находит статус изделия.
- [x] 2.2 Обновить тесты со значением `ProductStatus.DELIVERY` → `STORAGE` (механическая замена, без `migration.sql`/`REPORT.md`/текстов про доставку); проверка — `pnpm --filter @pero/web test` зелёный (1245/1245).
- [x] 2.3 Проверить затронутые экраны без литералов (канбан, фильтр-бар, таблица, шапка изделия, вкладки проекта/истории, `actions.ts`, `status-core.ts`, `list-state.ts`) — правки не требуются, подхват через общие константы; проверка — `tsc --noEmit` без ошибок типов.

## 3. Проверки и evidence

- [x] 3.1 Прогнать `pnpm lint` (затронутые пакеты) и зафиксировать результаты; проверка — 0 errors, 5 предсуществующих warnings (см. `evidence.md`).
- [x] 3.2 Описать браузерную приёмку шагами в evidence-заметке (канбан, фильтр, смена статуса, история) без коммита/пуша/мержа; проверка — `evidence.md` добавлен.
