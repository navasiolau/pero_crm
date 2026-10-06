# Design

## Context

См. proposal.md (Why). Текущее состояние: `ProductStatus` (`DESIGN`, `PRODUCTION`, `DELIVERY`, `INSTALLATION`, `DONE`, `RECLAMATION`) используется в `Product.status`, `ProductStatusHistory.fromStatus/toStatus`, `ProductPercentageCompletion.statusAtCompletion`. UI (канбан, фильтры через `PRODUCT_STATUSES` + `list-state.ts`, таблица, шапка, история) и сервер (`status-core.ts`, `actions.ts`) работают через общие словари `productStatusLabels`/`productStatusStyles` без жёстких литералов `DELIVERY` в компонентах. Жёсткие литералы есть только в `product-statuses.ts`, `product-percentage-status.ts`, `product-percentage-pay/core.ts`, `product-stage-pay/core.ts` и тестах.

## Goals / Non-Goals

**Goals:** переименовать значение enum одним `RENAME VALUE`, сохранить семантику триггеров и историю, обновить все строковые литералы `DELIVERY` как статуса изделия (включая тесты).

**Non-Goals:** переименование `TASK_TYPES` «Доставка», денег проекта `delivery`, склада материалов, текстов напоминаний; рефакторинг фильтров/канбана; обратная совместимость query `status=DELIVERY` (нормализуется как неизвестное).

## Decisions

- `ALTER TYPE "ProductStatus" RENAME VALUE 'DELIVERY' TO 'STORAGE'` в новой миграции (альтернатива `UPDATE ... USING` с пересозданием типа — отклонена: тяжелее и требует переписывания зависимых колонок; `RENAME VALUE` атомарно переименовывает во всех колонках типа).
- Старые миграции не правим (история миграций обязана воспроизводиться); новая миграция — единственная точка изменения БД.
- Стили `STORAGE` наследуют cyan-токены `DELIVERY` без переименования оттенка — визуальной дифференциации достаточно, тёмная/светлая темы не ломаются.
- Лейбл «На складе ГП» — короткий вариант для колонок канбана и «таблеток»; длинный «На складе готовой продукции» отклонён (не влезает в колонку).
- Тесты обновляются механической заменой `DELIVERY` → `STORAGE` там, где это значение `ProductStatus`; строковые `intent.kind === "delivery"` и тексты про доставку напоминаний/событий не трогаем.
- `REPORT.md` legacy-импорта и старые `migration.sql` — исторические документы, не правим.

## Risks / Trade-offs

- [Риск] Сохранённые пользовательские предпочтения фильтров (`list-preference` v1/v2) со `status=DELIVERY` → нормализация отбросит неизвестное значение, фильтр сбросится. Митигация: приемлемо для переименования; пользователь выберет «На складе ГП» заново.
- [Риск] Параллельные ветки со старым `DELIVERY` получат конфликт типов после rebase. Митигация: поиск по `DELIVERY` в `apps/web/src` обязан давать ноль совпадений статуса изделия после задачи.
- [Риск] `prisma migrate dev` на несогласованной локальной БД может предложить дрейф. Митигация: сначала `db:generate`, затем `migrate dev` только на локальной БД 5433; production-миграция — отдельно по поручению владельца.

## Migration Plan

1. `schema.prisma`: `DELIVERY // Доставка` → `STORAGE // На складе ГП`.
2. `pnpm db:generate` (клиент).
3. Новая миграция с `ALTER TYPE "ProductStatus" RENAME VALUE 'DELIVERY' TO 'STORAGE';`.
4. `pnpm db:migrate` на локальной БД 5433, проверка `SELECT enumlabel FROM pg_enum`.
5. Обновление 4 исходников + тесты, `lint` + `test` + типовая сборка.

## Open Questions

Нет открытых вопросов, меняющих подход: объём замены подтверждён поиском (жёсткие литералы только в 4 исходниках + тесты).
