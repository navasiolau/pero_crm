# Proposal

## Why

Статус изделия DELIVERY с лейблом «Доставка» вводит в заблуждение: фактически изделия после производства ожидают на складе готовой продукции, а не находятся в доставке. Переименование в STORAGE «На складе ГП» устраняет путаницу в канбане, фильтрах и истории.

## What Changes

- Переименование значения enum `ProductStatus.DELIVERY` в `STORAGE` без изменения порядка и семантики переходов.
- UI-лейбл статуса: «Доставка» → «На складе ГП»; визуальные стили (cyan) сохраняются.
- Новая миграция БД: `ALTER TYPE "ProductStatus" RENAME VALUE 'DELIVERY' TO 'STORAGE'`; старые миграции не правятся.
- Обновление триггеров начислений (`ENGINEERING`/`ASSEMBLY`) и инженерного гейта на новое имя значения; логика срабатывания не меняется.
- Старые записи истории статусов (`ProductStatusHistory`, `ChangeLog`, `DomainEvent`) показывают новый лейбл через общий словарь `productStatusLabels`.

## Capabilities

### New Capabilities

- `product-status-storage`: переименование статуса изделия «Доставка» в «На складе ГП» с сохранением семантики триггеров и истории.

### Modified Capabilities

Нет.

## Impact

- Затронуты: `apps/web/prisma/schema.prisma`, `apps/web/src/lib/product-statuses.ts`, `apps/web/src/lib/product-percentage-status.ts`, `apps/web/src/server/product-percentage-pay/core.ts`, `apps/web/src/server/product-stage-pay/core.ts`; косвенно (через общие константы, без правок литералов) — канбан, фильтры, таблица, шапка изделия, вкладки проекта/истории, `server/products/actions.ts`, `server/products/status-core.ts`, `lib/list-state.ts`.
- Не затрагиваются: `TASK_TYPES` «Доставка» (`task-dialog.tsx`), денежные поля проекта `delivery/unloading/installation`, склад материалов, напоминания календаря.
- Требуется генерация Prisma-клиента и прогон миграции на локальной БД (PostgreSQL 5433); приёмка — канбан, фильтр, смена статуса, история.
