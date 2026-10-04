# Design

## Context

См.proposal.md. Shared PaymentDialog показывает статьи только для EXPENSE, organization view передаёт пустой список. paymentSchema и Payment FK уже допускают expenseArticleId, но addPaymentCore молча игнорирует его для INCOME. Native select с длинными project title растягивает intrinsic grid track DialogContent; overflow-y-auto даёт горизонтальную прокрутку при overflow-x:visible.

## Goals / Non-Goals

**Goals:** правильные первые поля, сохранение явного выбора, bounded popup/form widths и реальные viewport measurements.

**Non-Goals:** новый каталог доходных статей, обязательная новая классификация старых/новых income API, изменение финансовых формул/права, новые ledger columns, миграция/production.

## Decisions

- Использовать существующий ExpenseArticle FK и active lookup. EXPENSE требует статью, INCOME сохраняет и проверяет её если передана. Transaction helper сверяет input/prepared article и повторно проверяет active; отсутствие Income статьи сохраняет текущий nullable API.
- Loader передаёт active articles по существующему code/name. Income выбор ручной с placeholder, без auto-first. Project option text только number, empty option означает общий приход. Shared project-income использует тот же исправленный комментарий/статью; expense layout/requirement сохраняются.
- Устранить min-content ширину: shared DialogContent получает bounded minmax grid track/min-w-0, PaymentDialog containers/controls w-full/min-w-0/max-w-full. Mobile money row одна колонка, desktop две. Не лечить только сокрытием overflowing полей; измерить элементы и доступность footer. Общий запрет горизонтального overflow можно добавить после реального ограничения ширины.
- Browser проверяет только открытие/выбор полей/геометрию, без submit финансовой операции. Сохранение проверяется actual native OUTERROLLBACK на existing local/staging, без уведомлений и реальных денежных движений. Реальные DOM observations записать ДО вторичных protocol asserts; не повторять проблему прежней недоказанной UI-приёмки.

## Risks / Trade-offs

- [Новый income article ошибочно учитывается как расход] → direction/баланс/FX regression +actual savedFK/INCOME assertions.
- [Общий dialog fix обрежет поле вместо исправления ширины] → actual scrollWidth/clientWidth и bounding boxes/видимость footer на3viewports.
- [Чужие старые операции изменятся] → нет migration/backfill; native rollback/сохранность исходных данных.

## Migration Plan

bugfix/61 от fresh staging6f98 → meaningful tests → local checks/native и layout → ordinary merge/CI → exact deployed revision/health → focused hosted form +native +cleanup. No dumps/restic/seed/reset/newDB/prod/main; W07/refresh неизменны.
