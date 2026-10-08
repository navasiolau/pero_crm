# Приёмка №102 — виды прихода

08.10.2026, feature/102 от staging6db0bc055df89071cf6a2b02874558f8da7e9f46.

## Local

- RED нового контракта подтверждён, focused7/7 и fullweb1334/1334 PASS. TypeScript/build PASS, lint изменённых файлов0 ошибок/предупреждений, strict PASS.
- Миграция20261008130000_warehouse_receipt_kinds применена только к существующему localhost5433/pero_crm. До/после сравнивались все прежние поля StockMovement, WarehouseMovementValuation, WarehouseBalance, Material, Payment, Payout: digest MATCH. Все старые receiptKind остаютсяNULL. Ни UPDATE истории, ни dump/reset/seed.
- PostgreSQL native использовал собственную номенклатуру и актёраPROCUREMENT внутри полностью откатываемой транзакции. Если local ещё не имеет состояния учёта, только в этой транзакции добавляется временное ACTIVE для собственной QA-номенклатуры; существующее состояние не заменяется. На staging требуется существующее ACTIVE.
- Инвентарный приход3×20: остаток3, стоимость60BYN, receiptKindINVENTORY, одна запись/audit/event после retry. Payment/Payout неизменны. CHECK не допускает вид прихода у EXPENSE. WORKER отклонён. Все исходные digest MATCH, QA ROLLED_BACK, рассылок0.
- Единый контракт в server/warehouse/contracts, прежний lib-файл реэкспортирует его. PAID/касса запрещены inventory-контрактом. addStockIncome делегирует addInventoryReceipt для уже открытых клиентов; fingerprint не изменён.
- Настоящие React/BaseUI-компоненты с CSS сборки проверены в изолированном браузере1440/390: название/пояснение, quantity/price payload, блокировка полей/закрытия во время сохранения, тот жеUUID после потери подтверждения. Подменена только граница server action; реальное ядро проверено native. Снимки .playwright-mcp/finance102/inventory-*.png просмотрены; складское состояние ради UI не менялось.
- Новый PAID зарезервирован для атомарного проведения в103; неработающей кнопки оплаты нет. Исторические приходы явно неопределённые, общий фильтр приходов включает все виды.
- Staging bundle подготовлен с guard и native/реальными SSR-запросами, меньше256KiB.

## Staging

Ожидаются merge, CI, фактический образ и runtime-приёмка. Main/production не изменялись.
