# Proposal

## Why

Последнее указание владельца разрешает конвертацию текущих цен non-BYN проектов в существующих local/staging вместо прежнего report-only правила. Production остаётся только ручным ценовым отчётом №32 по реальному прикладному источнику, без доступа этого runner к production БД.

## What Changes

- Pure Decimal planner: текущая Project.currency, дата Project.createdAt в Europe/Moscow, официальный архив НБ РБ и строгая проверка масштаба/периода валюты.
- Отдельные строки unit/Product.initialPrice и Project.initialPrice/delivery/unloading/installation; null сохраняется, unit BYN округляется до копеек до умножения на qty.
- Один root-only bounded runner: подписанный исходный manifest, expected-value/target/image guards, атомарный apply только local/staging, подтверждение неизменности всех остальных моделей и idempotent replay.
- Исторические начисления, этапные snapshots, платежи, кассы, файлы, пользователи/таймеры не переписываются. Trigger conflict — STOP без обхода.

## Capabilities

### New Capabilities

- `test-environment-byn-price-conversion`: проверяемая разовая конвертация текущих тестовых цен в BYN.

### Modified Capabilities

Нет.

## Impact

Новые planner/fetch/report-schema scripts и root-only QA runner/tests. Нет автоматической миграции, новых БД, production mutator или изменений прикладных финансовых writers. №32 зависит от получения actual app source владельцем; этот change не объявляет production файл созданным.
