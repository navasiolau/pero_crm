# Verification

## Реализация

Ветка `bugfix/209`, база `origin/staging` `33911889f4ad70609db45fce38fdcd769d665a0d`. Локальная приёмка завершена; по запросу владельца 02.11.2026 начат выпуск в staging.

- ProjectStage содержит шесть действующих значений, ProductStatus — семь. PAUSED/RECLAMATION отсутствуют в рабочих enum Prisma/PostgreSQL.
- Четыре поля историй и `statusAtCompletion` отделены от enum и хранят TEXT. Прежние значения, причины, ChangeLog и frozen payload сохраняются.
- Прежний операторский перенос заменён одной транзакционной миграцией. CLI всегда INERT, исполнителя/планировщика больше нет.
- Архивный parser допускается только до проверки точной существующей квитанции. Новые команды с выведенным статусом или параметрами рекламации отвергаются. Это проверено в ядре, сервисе и bot REST transport с прежними auth/scopes/role gates.
- Bootstrap изделия в REFUSED выбирает последний обычный этап, пропуская архивные PAUSED/RECLAMATION. Текущие UI/бот больше не содержат рабочих веток и подписей удалённых статусов.

## Локальный PostgreSQL

Проверена существующая `127.0.0.1:5433/pero_crm`, schema public, systemIdentifier `7663912963695341602`, контейнер `bf45c761b568…` postgres:16-alpine. До миграции текущих и исторических выведенных значений было 0; миграции до `20261029000300_logistics_delete_receipt` применены, посторонних pending миграций и DB clients не было.

1. **Upgrade/rollback PASS:** точный SQL миграции испытан с синтетическими PAUSED/RECLAMATION, скрытыми записями, упорядоченной историей, acceptance КП, незавершёнными и terminal prune jobs, completion и frozen КП. Переносы/аудит проверены; исходные исторические строки, файлы, начисления, события, completion и версии сохранены. После обычного и принудительного аварийного rollback снимки всех **77 таблиц**, enum и типов колонок совпали. Квитанция `.playwright-mcp/task-209/migration-native.json`.
2. **Local deploy PASS:** выполнен `pnpm db:deploy`, применена только `20261102120000_remove_retired_stage_enums`. Снимки всех **76 бизнес-таблиц** до/после совпали. Изменились схема и `_prisma_migrations`; каталог enum и пять TEXT-колонок проверены. Квитанция `.playwright-mcp/task-209/local-deploy.json`.
3. **Runtime на новой схеме PASS:** настоящий Prisma/core проверил архивные истории/финансовый снимок, REFUSED bootstrap, точный replay старой операции без нового перехода/событий и отказ новой команде. PostgreSQL отвергает PAUSED/RECLAMATION в рабочих enum. Все синтетические строки откатились, полный снимок совпал. Квитанция `.playwright-mcp/task-209/archived-runtime.json`.

После проверок существующий локальный контейнер PostgreSQL возвращён в исходное состояние `exited (0)`; Next-серверы остановлены. Миграция сохранена на прежнем volume.

Дампы, reset/seed, новые БД и контейнеры не создавались. Production/staging БД не читались и не изменялись.

## Автоматические проверки

- Полный существующий web suite после последней transport-поправки: `pnpm --filter @pero/web exec tsx --test --test-concurrency=2 tests/*.test.ts tests/*.test.mjs` — **1360 PASS, 0 FAIL, 0 SKIP**; `.playwright-mcp/task-209/web-tests-final.log`.
- Bot: `pnpm --filter @pero/telegram-bot test` — **41 PASS**, build/typecheck PASS.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`, scoped ESLint, `prisma validate/generate`, `pnpm build`, strict OpenSpec validation и `git diff --check` — PASS.
- В раннем штатном параллельном Windows-прогоне два существующих browser cases завершились timeout; изолированный повтор 23/23 и два полных прогона с двумя процессами прошли. Workflow и зависимости не менялись.
- Сохранён existing PostgreSQL integration suite: проверяет каталог enum, архивные TEXT-факты и прямой отказ PostgreSQL удалённым значениям. Полный hosted native CI здесь не запускался.

## Выпуск

Коммитов, push, merge, remote CI и staging/production-приёмки не было. Совместная интеграция №208/209 должна пройти штатный CI и фактический staging после разрешения коммитов. Миграция требует окна обновления без старых writers; дальнейший порядок и ограничения отката описаны в `operator.md`.

## Выпуск staging по запросу владельца 02.11.2026

После сообщения владельца со скриншотом staging выполняются коммит/публикация №209 и обычная интеграция с №208. Принятый SHA/image/health, миграция и инженерный UI записываются в ignored `.playwright-mcp/task-208/staging-release/acceptance.json` интеграционного worktree. Прежний раздел «Выпуск» выше описывает состояние до этого поручения. Main/production не разрешены.
