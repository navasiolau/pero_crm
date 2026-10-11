# Proposal

## Why

Задача №158 утверждённого CRM_APPLICATION_IMPROVEMENT_PLAN.md сокращает остаток закрытого деления задач. `splitTaskCore` уже возвращает успех только по точному историческому receipt, но result contract допускает новое деление, а обёртка содержит недостижимые уведомление и dispatch.

## What Changes

- Удалить из `splitTask` ветку `!repeated` и два её импорта.
- Сузить успешный внутренний результат до данных исторического replay и существующей revalidation; `repeated` имеет литеральный тип `true`.
- Сохранить проверки actor/entity/recipient/percent/revision и запрет новой команды, существующие права, исторические суммы, закрытые endpoints и инертный диалог.
- Проверить эквивалентность существующими retired/share и percentage-pay тестами; измерить уменьшение кода отдельно от размера JavaScript.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет. Это рефакторинг без изменения пользовательского поведения; `skip_specs: true`. Действующий контракт изложен в `remove-task-payment-shares/specs/task-payment-share-retirement/spec.md` и сохраняется целиком.

## Impact

Production scope: только `apps/web/src/server/tasks/share-core.ts` и `share-actions.ts`. При необходимости уточнить существующие regression tests исторического replay; не вводить новый framework. UI, schema, миграции, Decimal-арифметика, lockfile, финансовая история и внешние API не меняются. Local-проверки выполняются без БД; интеграцией и staging-приёмкой управляет Root. Main/production запрещены в текущем поручении.
