# Проверки №174

17.10.2026. Ветка `feature/174`, worktree `D:/Projects/pero_crm_worktrees/requests-174`.

## Основание

OpenSpec подготовлен на `e8886cc3`. После GO оркестратора выполнены `git fetch origin` и `git merge --ff-only origin/staging` до **635dad832de9bb2744089e554b8fa774b4c041ae**; поля и миграция №171 присутствуют и сохранены. Новая `20261017000200_counterparty_directory` создаёт только enum и отдельную таблицу.

## Выполнено локально

- `pnpm install --offline --frozen-lockfile` — успешно, lockfile не изменён.
- RED до реализации: новый пункт навигации отсутствовал, центральная политика разрешала неизвестный `/counterparties` ограниченным ролям через fallback.
- `pnpm db:generate` и `pnpm --filter @pero/web exec prisma validate` — успешно. Для validate использовался фиктивный loopback DATABASE_URL; соединения с БД не было.
- `pnpm --filter @pero/web exec tsx --test tests/counterparty-component.test.mjs tests/counterparty-access.test.ts tests/counterparty-core.test.ts tests/counterparty-actions.test.ts tests/engineer-access.test.ts tests/procurement-payroll-access.test.ts tests/product-return-navigation.test.ts tests/management-dashboard.test.ts` — **49/49**, в том числе 12 новых core/access/action/browser-сценариев.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false` — успешно.
- `pnpm --filter @pero/web exec eslint` для всех изменённых TS/TSX/MJS файлов, включая native-helper и существующий CI-файл — успешно, 0 предупреждений.
- `openspec validate counterparty-directory --strict`, `git diff --check` — успешно.

## Покрытые сценарии

- Реальные политики навигации/маршрута и auth callback; реальные page/query/action/core с существующим guarded-module-cache и адаптером транзакции. Разрешены ADMIN/DIRECTOR/MANAGER/PROCUREMENT и совмещённые разрешённые роли; чистые ENGINEER/ACCOUNTANT, производственные роли и отсутствие сессии не читают и не изменяют данные.
- Оба типа, обязательная компания/тип, строгий payload, nullable-контакты, revision CAS, конфликт между чтением и updateMany, no-op без аудита и откат адаптера действия при отказе аудита.
- Реальные DataTable/Select/Dialog/CounterpartiesView в Chromium: совместный поиск и фильтр, поиск по телефону/комментарию, сброс пагинации, пустое состояние, создание, немедленный просмотр подтверждённого результата, очистка и сохранение ввода при конфликте.
- Проверены **1440×1000, 390×844, 360×800**, каждый размер в light/dark; длинная компания/комментарий, доступность Save прокруткой, отсутствие горизонтального переполнения. Просмотр начинает с заголовка даже при длинном комментарии. Screenshots `apps/web/test-results/counterparty-directory/{1440,390,360}-{light,dark}-{editor,viewer}.png` проверены визуально. Это компонентный harness без Next.js font-loader, реальной БД и настоящего транспорта действий; он не заменяет staging-приёмку.

## CI classification

`counterparty-component.test.mjs` добавлен в явный список **components-1** в `.github/workflows/ci-cd.yml`, где устанавливается совместимый Chromium. Остальные списки, gates и версии не менялись.

Блок `files=()`/`for`/`case` извлечён из фактического workflow в ignored `.playwright-mcp/counterparty-ci-classifier.sh` и выполнен через `C:/Program Files/Git/bin/bash.exe` для всех COHORT. На базе 635dad83: backend — 141 файл, новый browser 0 раз; components-0 — 8, 0 раз; components-1 — 7, **ровно 1 раз**. Evidence: `apps/web/test-results/counterparty-directory/ci-classification.txt`. Параллельные исправления mappings №171/175 интегрирует оркестратор; при merge сохранить все новые имена.

## Local migration / native — PASS

Оркестратор выполнил миграцию `20261017000200_counterparty_directory` на существующей разрешённой `localhost:5433/pero_crm`. Evidence прочитан и сопоставлен исполнителем только с диска, без команд БД:

- `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-before174-migration.json`
- `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-after174-migration.json`
- `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-native174.json`
- `D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-after174-native.json`

До миграции 64 таблицы, после 65. Добавлена только пустая Counterparty; среди прежних таблиц изменился только `_prisma_migrations`, все **63 прежние бизнес-таблицы** имеют прежние fingerprints. Завершённая миграция присутствует в applied, новая таблица содержит 0 строк.

`verifyCounterpartyNative(tx, actor)` из `tests/helpers/counterparty-native.ts` выполнен оркестратором во внешней guarded rollback-транзакции: **PASS** для обоих типов, необязательных контактов, ролевой границы, revision CAS, no-op без лишнего аудита и настоящего SAVEPOINT rollback при отказе аудита. Receipt подтверждает отсутствие обеих собственных записей и аудита после rollback. Все **65 fingerprints** после native-проверки совпадают со снимком после миграции.

В существующий `tests/integration/domain-postgres.test.ts` добавлен один rollback-сценарий вызова того же helper. CI-фикстура локально не запускалась; новый стенд, seed и дампы не создавались.

## Ожидает оркестратора

Независимое ревью, коммит/интеграция и приёмка реально развёрнутого staging по SHA/образу и пользовательским сценариям. **Staging-пункт 4.3 остаётся открытым**; локальные миграция/native и компонентный harness не заменяют staging-приёмку. Этот исполнитель команд БД, commit/push/deploy не выполнял; production им не изменялся.
