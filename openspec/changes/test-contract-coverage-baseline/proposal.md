# Proposal

## Why

2150 web-тестов и 38 bot-тестов текущего CI не показывают, какие действующие контракты и ветви действительно защищены. Перед сокращением кода и тестов нужна проверяемая карта доказательств и воспроизводимый baseline для критических production-модулей.

## What Changes

- Добавить карту критических денежных, ACL, файловых, timer и queue контрактов: requirement → test/block → уровень доказательства → native/browser сценарий → SHA/target/status и явный gap задачи.
- Зафиксировать решения KEEP/REWRITE/CONSOLIDATE/RETIRE на уровне блоков из согласованного плана, сохранив финансовую историю, guards и реальные Chromium tests.
- Добавить локальный V8 coverage runner существующего Node test entrypoint с фильтром production-модулей, воспроизводимыми метаданными и явным отсутствием покрытия для ненагруженных модулей. Не вводить произвольный общий процент или считать Node coverage доказательством PostgreSQL/Chromium/staging.

## Capabilities

### New Capabilities

- `test-evidence-map`: проверяемая контрактная карта и честный отчёт измерения покрытия тестового инструментария.

### Modified Capabilities

Нет. Пользовательские требования и поведение приложения сохраняются.

## Impact

Только docs/testing, QA coverage scripts, локальный package script и OpenSpec этого change. Не меняются production-код, миграции, lockfile, существующая команда CI или сами действующие тесты. Native/runtime доказательства собираются в задачах исправлений и последующей задаче 163; здесь для них остаются NOT_RUN/BLOCKED с точным объяснением.