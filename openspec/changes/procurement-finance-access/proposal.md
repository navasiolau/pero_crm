# Proposal

## Why

Владелец утвердил Снабженца: склад и финансы без полномочий менеджера. Чистый бухгалтер должен работать только в Finance, а чистый менеджер больше не выдаёт авансы.

## What Changes

- Добавить Role.PROCUREMENT «Снабженец», офисный readonly просмотр, складской каталог/приход/выдачу/возврат и финансовые операции.
- Отделить складские mutations от редактирования потребностей менеджментом.
- Убрать ACCOUNTANT operational read/execute и MANAGER из advance grants.
- Согласовать роли, навигацию, API/DTO, уведомления и денежные складские projections.

## Capabilities

### New Capabilities
- `procurement-finance-access`: отдельная supply/finance роль и изоляция operational/financial прав.

### Modified Capabilities
Нет.

## Impact

Prisma enum/migration, roles/auth/visibility, складские actions/UI, user schema/chips, finance DTOs и уведомления. Реальные назначения ролей и payScheme, движения и старые денежные данные не меняются.
