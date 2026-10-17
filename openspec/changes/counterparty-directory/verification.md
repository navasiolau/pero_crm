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

## Исторический handoff до staging-приёмки

На этом этапе ожидались независимое ревью, коммит/интеграция и приёмка реально развёрнутого staging по SHA/образу и пользовательским сценариям; пункт4.3 оставался открытым. Локальные миграция/native и компонентный harness не заменяли staging-приёмку. Итоговая фактическая приёмка оркестратором ниже. Этот исполнитель команд БД, commit/push/deploy не выполнял; production им не изменялся.

## Фактическая staging-приёмка — PASS с явными границами

17.10.2026 оркестратор принял №174 на **SHA `0d399e96d56010b05cd8f4df077aef03a7064e05`**, image **`sha256:0f89f9de9c0e8a4ee0437a4e443a41784e0a173c3e429ce42a266974c8f2b189`**, `https://staging-crm.peromebel.by`. Внешние guards подтвердили прежние DB container/start/volume и W07; внутренние — URL host `db`, БД/schema `crm/public` и завершённые миграции171→174. Применение миграции174:64→65 таблиц, новая Counterparty изначально пуста, из прежних таблиц менялся только `_prisma_migrations`, все63 бизнес-таблицы сохранены. Production/main не изменялись.

[CI38996944460](https://github.com/navasiolau/pero_crm/actions/runs/38996944460) — все6 jobs SUCCESS по подтверждению оркестратора. Ранний `ci-all9.json` — промежуточный in_progress, не final proof. Интеграционный source: **988/988**, TypeScript PASS, lint0 errors/4 существующих warnings, strict9/9. Собственные49 локальных тестов, native локальной БД и CI-cohort proof выше сохранены; независимое source-ревью №174 — без замечаний.

Общий actual run **`1c0b0ed5-b65a-4fe2-8ba4-9116e8fa4d89`**, `STAGE171174_BROWSER_PASS`, 168 проверок. Собственный scope №174 и ссылки с SHA256 — [staging-acceptance.json](staging-acceptance.json). **18 business POST issued =18 actual ACK**, denied/clientErrors/guard mismatch — 0. Действия выполнялись настоящими кнопками и формами Next.js, со строгим allowlist собственных записей, без подменённых ACK и прямого обхода UI.

**Actual UI ADMIN:** по одному новому собственному контрагенту в каждой комбинации **1440×1000, 390×844, 360×800 × light/dark**. Проверены оба типа, заполнение компании/телефона/длинного комментария, немедленный просмотр подтверждённого результата, изменение компании/контактов, очистка телефона/комментария, поиск собственной компании, совместный фильтр типа, пустое состояние, сохранение поискового текста и отсутствие overflow. Итого создано6, изменений12, подтверждено18. Создано12 editor/view screenshots; оркестратор отдельно визуально проверил `counterparty174-editor-1440-light.png` и `counterparty174-view-390-dark.png` — PASS. Поиск по телефону/комментарию, открытие строки и сохранение ввода при конфликте дополнительно подтверждены локальным real-component harness выше; этот stage matrix их не расширяет на иные реальные профили.

**Доступ и native staging:** actual HTTP `/counterparties`: PROCUREMENT200, ENGINEER302, ACCOUNTANT302; actual UI использует существующий ADMIN. Реальный immutable core/helper на staging БД в outer rollback подтвердил оба типа, необязательные контакты, очистку, revision CAS, no-op без аудита, запреты ENGINEER/ACCOUNTANT и настоящий SQL SAVEPOINT rollback при отказе аудита. Native full fingerprints всех65 таблиц до/после совпали. DIRECTOR/MANAGER, совмещения и другие запрещённые роли покрыты локальными core/access/action/query тестами; отдельные реальные профили для них не создавались, отдельная UI-сессия PROCUREMENT create/edit не заявляется.

**Cleanup и сохранность:** guarded cleanup сверил revision/поля/точный аудит и удалил только собственных counterparty6/audit18 и клиента1 общей проверки171. Независимый readonly inspect: own counts0, **все65 stable fingerprints совпали**. Full отличается только `ApiToken.lastUsedAt`, оркестратор подтвердил движение timestamp вперёд; runtime поле не восстанавливалось. Полная неизменность full-снимков за весь UI-run не заявляется. Исторические и финансовые факты сохранены по независимому stable-сравнению.

Исходные приватные evidence: `.playwright-mcp/requests-171-179/staging171174/run-1c0b0ed5-b65a-4fe2-8ba4-9116e8fa4d89/{receipt,native,cleanup,independent-inspect,bundle-provenance}.json` в основном workspace. В версионируемый report включены только агрегаты, scope и хэши; raw строки других сущностей, пользователи и секреты не копировались. Существующие JWT900sec только в памяти; никаких новых пользователей/ролей/БД, reset/seed/dump, production-изменений.

Предыдущие HOLD `3265359f-6662-4616-b636-fa1570aeb801` и `6c23df5f-6314-4e45-81d4-1095dd8bb23f` сохранены. Ложное сравнение порядка UNION ALL и неоднозначный layout heading устранены в приватном QA, source приложения не менялся. Итоговый runner и compiler с379 DIFF-проверками, AST-discovery и cleanup прошли независимое ревью. Пункт4.3 закрыт на указанном SHA/образе с описанным покрытием; main/production-продвижение и production-миграция отдельно согласуются владельцем.
