# Проверки №179 — 17.10.2026

Основание feature/179 получено по GO оркестратора двумя FF merge с сохранением истории: origin/staging `e742e2e18014191ac03551ff2730f112749b38bb`, затем local staging `4d81bad3fe8512c8d4bd420357fe703c1f211657`, содержащий №175/178. Код/тесты не копировались между ветками. Коммитов, push и deployment агент не выполнял. Схема БД, зависимости и lockfile не менялись; offline/frozen install и генерация Prisma Client выполнены.

## RED → GREEN

Первой проверкой был реальный PaymentDialog в Chromium с разрешёнными creation options: meaningful RED из-за отсутствия кнопки «Создать материал». После реализации этот сценарий и остальное новое поведение проходят.

Общий MaterialDialog переиспользуется в каталоге create/edit и во вложенном создании оплаченной закупки склада/расходов организации. Action возвращает фактически сохранённые id/name/unit/sku и stock:0. Единственная schema общая для формы и сервера; lookup options передаются родителями с прежним WAREHOUSE_MANAGE grant. Чистый ACCOUNTANT не получает опции и серверное право создания.

## Проверки

- inline-material-action + warehouse-units + inline-expense-article-action + default-cash-account: 11/11 unit/DI PASS. Реальный requireRole/warehouse gate, FROZEN/VERIFYING, canonical option, nullable/необязательные поля, unit/category validation, отсутствие денежных delegates, атомарный откат material/audit.
- default-cash-account-component + income-form-component + inline-expense-article-component + stock-movement-component: 30 сценариев PASS.
- inline-material-component + warehouse-units-component: 14/14 PASS после обновления прежней fixture новой общей формы. В том числе оба реальных purchase контейнера, пустой каталог, канонический выбор без дублей, отсутствие проведения до parent submit, сохранение количества/цены/кассы/валюты/курса/дат/комментария/документа, UNKNOWN/reopen с прежним material/UUID, cancel/error/Escape, pending/blocked, динамические единицы и read-only учётная цена.
- Существующий Chromium PaymentDialog manual-FX/UNKNOWN/reload regression: 1/1 PASS.
- TypeScript `--noEmit --incremental false`, lint изменённых TS/TSX/MJS, `git diff --check`, `openspec validate inline-material-create --strict`: PASS.

Новый browser filename явно направлен в CI components-1 отдельным case. В существующих browser fixtures добавлены только новые внешние action exports; source/domain guards не подменялись.

## Визуальный harness

Реальные React/Base UI компоненты с полным globals.css/Tailwind, Chromium 1440×1000 и 390×844, светлая/тёмная темы. Проверены размеры, отсутствие горизонтального overflow, отдельное закрытие child и возврат фокуса; PNG просмотрены в ignored `node_modules/.cache/inline-material179`. Sans-serif fallback без Next font loader. Это локальная компонентная проверка, не staging-приёмка.

## Native и staging

Для guarded outer rollback оркестратору передан `tests/helpers/inline-material-native.ts`: `verifyInlineMaterialNative(tx, actor)`. Он использует существующую единицу, warehouseMetadataGate, проверяет canonical option, нулевую цену/остаток, role boundary, missing unit/category, audit rollback через SAVEPOINT и неизменность Payment/Payout/StockMovement/WarehouseBalance/MaterialUnit. Подключён сценарий существующего finance-postgres.test.ts без нового CI inventory.

Агент не подключался к local/staging БД, не создавал БД/единицы/стенд, не запускал seed/reset/dump/CI fixture.

Оркестратор выполнил native-проверку на существующей local БД `localhost:5433` под guards и outer rollback: PASS для canonical option, существующей единицы, нулевой цены/остатка, серверного запрета чистого ACCOUNTANT, audit rollback и отсутствия денежных/складских движений. Собственный QA-actor и аудит после rollback отсутствуют; fingerprints всех 65 таблиц совпали с baseline. Receipts: [local-native179.json](D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-native179.json), [local-after179-native.json](D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-after179-native.json). Независимое ревью оркестратора — без замечаний.

Пункт 3.2 выполнен. Фактическая staging-приёмка остаётся pending (3.3).
