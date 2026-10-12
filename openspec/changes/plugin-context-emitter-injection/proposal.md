# Proposal

## Why

Задача152: runtime цикл events → context → events связывает создание контекста с доставкой очереди и мешает отдельной проверке. После принятой135 устраняем эту зависимость без изменения поведения плагинов.

## What Changes

- Фабрика buildPluginContext получает обязательный типизированный emitter; context больше не импортирует events.
- Все существующие вызовы фабрики явно передают прежний emitDomainEvent.
- Actor plugin:<id>, trusted permissions, аудит, lease guard и внутренний obsolete sketch cleanup сохраняются.

## Capabilities

### New Capabilities

Нет: внутренний рефакторинг, skip_specs: true.

### Modified Capabilities

Нет изменений пользовательского или SDK контракта.

## Impact

Четыре production пути: plugins/context.ts, plugins/events.ts, plugins/actions.ts и REST plugin-command route. Один regression test использует фактическую фабрику/dispatcher с контролируемыми persistence boundaries. Schema, миграции, UI, очередь135, lockfile и внешние зависимости неизменны.