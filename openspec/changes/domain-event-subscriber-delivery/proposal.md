# Proposal

## Why

Задача136: общий processedAt повторяет успешный hook A после отказа B. Принятые135 и152 дают owned очередь и явный emitter; теперь сохраняем прогресс подписчиков отдельно.

## What Changes

- Уникальная delivery(eventId,subscriberId) хранит attempts/backoff/ACK либо terminal SKIPPED, под текущей lease очереди135.
- Отдельный durable delivery plan фиксирует даже пустой первоначальный набор адресатов. Исходные13 физических колонок DomainEvent не меняются.
- Успешные receipts не меняются при retry; internal cleanup остаётся до пользовательской доставки.
- SDK документирует at-least-once и consumer idempotence по event.id: crash после эффекта до ACK может повторить consumer.
- Принятая Root legacy policy: completed events не переоткрываются; old pending при первом processing фиксирует current enabled registered hooks, прежний неизвестный success не восстанавливается из PluginRunLog. Disabled/removed до retry → явный terminal SKIPPED. Новых бизнес-подписчиков/глобальную активацию не добавляем.

## Capabilities

### New Capabilities

- `domain-event-subscriber-delivery`: фиксированные адресаты и отдельная долговечная доставка.

### Modified Capabilities

Нет: базовый lease/budget135 сохраняется.

## Impact

Events dispatcher, небольшой subscriber store, два новых Prisma models/additive migration, SDK комментарии, целевые unit/native tests и truthful adapters существующих context/queue tests. UI/financial/warehouse mutations и lockfile не меняются. Local/staging SQL только по Rootwindow после protocol review.