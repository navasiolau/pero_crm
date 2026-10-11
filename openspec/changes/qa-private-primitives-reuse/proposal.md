# Proposal

## Why

Задача №162 согласованного CRM_APPLICATION_IMPROVEMENT_PLAN.md: в двух семействах QA повторяются сериализация, хеширование, обход предков приватного пути и запись с fsync. Повторение усложняет сопровождение одинаковых механических операций; специфические протоколы приёмки должны сохраниться.

## What Changes

- Вынести canonical JSON, SHA-256, обход предков и open/write/fsync/close в один небольшой helper, используемый ровно двумя семействами.
- Сохранить в адаптерах все ограничения путей, валидаторы, лимиты, форматы, коды отказов, проверку readback и цепочку ledger.
- Добавить новый helper в source manifests обоих семейств; дополнить локальные guard и fault fixtures.

## Capabilities

### New Capabilities

Нет. Чистый QA-рефакторинг, skip_specs: true.

### Modified Capabilities

Нет. Разрешения, отказы и внешнее поведение не меняются.

## Impact

Allowlist: apps/web/tests/{warehouse-units-stage-wire,warehouse-units-stage-runner,product-draft-stage-wire,product-draft-stage-runner}.mjs; новый tests/helpers/qa-private-primitives.mjs; один новый guard test и точечные существующие guard tests при необходимости; этот OpenSpec change.

Пакеты, lockfile, приложение, миграции, БД, инфраструктура, подписи, phase machines и recovery unknown ACK не меняются. Native/SQL/HTTP/браузерные сценарии не запускаются ради рефакторинга. Согласование scope до реализации; независимое review до коммита. Main/production запрещены.
