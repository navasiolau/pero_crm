# Design

## Context

ACCOUNTANT сейчас в OFFICE_ROLES/fullProjectVisibility/task-execution; MANAGER в ADVANCE_ROLES. Складские actions используют один WAREHOUSE_MANAGERS даже для потребностей. Finance auth использует централизованный FINANCE_ROLES.

## Goals / Non-Goals

Goals: PROCUREMENT full supply/finance, Accountant finance-only, union roles. Non-Goals: financial workspace59, UIadvance relocation60, income/expense schema61/62, calendar63, production-wide worker67, employee payment conversion70.

## Decisions

Добавить enum без обновления людей. Операционные grants вычислять по ролям; Finance не должен глобально давать fullProjectVisibility. PROCUREMENT — отдельный OFFICE/WAREHOUSE_MANAGE/FINANCE grant, не MANAGER. Material requirements mutations остаются MANAGER; issue/return и каталог PROCURE разрешены. UI разделяет editNeed/issueReturn; цены показываются warehouse-money набору с PROCURE. ACCOUNTANT+ENGINEER/WORKER/MANAGER сохраняет права соответствующей второй роли. AD/DIR остаются эксклюзивными.

Чистый ACCOUNTANT не получает operational pages, technical file bytes/preview или tasks/recipients через прямой API. Финансовые picklists/DTO используют собственный FINANCE guard с минимальным project id/number/title/currency, без operational карточек и технических файлов; финансовая история не фильтруется общим operational where. User selected payScheme unchanged.

## Risks / Trade-offs

[Скрытое обходное разрешение] → серверные role/visibility/DTO tests. [Смешанные роли] → positive union matrix. [Разделение material controls] → отдельные flags/actions.

## Migration Plan

Additive ALTER TYPE Role ADD VALUE PROCUREMENT; без UPDATE людей/схем оплаты. Root выполняет migrations/runtime/staging. Source worker использует изолированные offline dependencies/private Prisma generation, RED/GREEN и type/lint. Production/restic/dumps не затрагиваются.
