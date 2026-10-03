# Proposal

## Why

Общий приход организации сейчас требует фиктивного проекта. №61 позволяет учесть такой доход один раз, сохраняя физическую валюту кассы и фиксированный BYN-эквивалент.

## What Changes

- Payment для INCOME допускает projectId/projectAmount NULL; EXPENSE требует действующий проект.
- Финансовый журнал приходов с необязательным safe picker проекта и существующим кассовым диалогом.
- Аудит и outbox создания в денежной транзакции; прежние лимиты удаления и расходов сохраняются.

## Capabilities

### New Capabilities

- `organization-income-ledger`: общие приходы и их финансовый учёт.

### Modified Capabilities

Нет.

## Impact

Payment schema, forward migration 20261003080000, payments core/actions, finance journal и nullable DTO. Org/cash/turnover aggregates уже учитывают все Payment без project-фильтра. Project economics остаётся по projectId. Никаких новых зависимостей, production/DB execution работником.
