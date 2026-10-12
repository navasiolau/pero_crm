# Design

## Context

См. proposal.md. Root принял legacy/disabled policy 12.10.2026;135 event claim/backoff/maxAttempts и152 context emitter сохраняются. Новый business subscriber не устанавливается.

## Goals / Non-Goals

**Goals:** durable ordered recipient snapshot, включая EMPTY; отдельный receipt и фиксированный event.id для идемпотентности.

**Non-Goals:** новый брокер/worker/registry, global activation, восстановление старых successes из логов, изменение financial/warehouse/UI и exactly-once внешнего эффекта.

## Decisions

Два additive models: DomainEventDeliveryPlan(eventId PK, createdAt) фиксирует empty initialization; DomainEventDelivery имеет compositePK(eventId,subscriberId), position, attempts, nextAttemptAt, deliveredAt, skippedAt, lastError, claimToken. FK каскад только от event→plan→receipt; pluginId не FK, чтобы сохранять факт removed subscriber. Порядок фиксируется по первой выборке enabled registered hooks. Оригинальные13 физических DomainEvent columns/rows не меняются; только Prisma relation.

Store.initialize/begin/complete/fail/skip используют shorttransaction: lock exact DomainEvent current token/unprocessed, проверка DBclock после lock, повтор expiry guard перед commit; lost ownership откатывает всю транзакцию. Общий event lock даёт единственную инициализацию и serial receipt CAS; external hook выполняется вне DBtransaction, только после owned guard. begin сохраняет текущий token/attempt; completed/skipped неизменны. До hook/ctx.emit действует существующий ownership guard135.

Per-subscriber backoff рассчитывается прежним eventRetryDelay по фактическим attempts. Event budget/backoff/exhaustion135 остаются верхней границей; самостоятельный scheduler/reset не вводится. Event получает общий ACK, когда все адресаты terminal; при неподтверждённом/deferred B main retry сохраняется. Disabled/removed pending → SKIPPED reason, re-enable не возвращает его в старый snapshot.

Old pending получает текущий snapshot только при первом новом processing. Unknown previous success может повториться; completed events не проходят claim/initialize. SDK комментарий требует consumer idempotency по event.id, а не называет ctx.emit дедупликацией. Crash effect→ACK и UNKNOWN ACK не компенсируются внешними действиями.

## Risks / Trade-offs

[Эффект произошёл до ACK] → consumer durable idempotency; scoped fault proof. [Пустая snapshot и crash] → отдельный plan сохраняет пустоту. [Lease истёк во время lock wait] → postlock clock/finalguard, native2sessions. [Schema ещё не применена] → deploy additive migration прежде worker delivery; globalflag false.

## Migration Plan

BEGIN/COMMIT создаёт только две таблицы, compositePK/order uniqueness, nonnegative checks и cascade FKs; backfill/UPDATE DomainEvent отсутствуют. LocalNative после Rootwindow: только owned event IDs/receipts, uniqueness/concurrentinit/rollback/expiry; nativeSnapshot/cleanup135 reuse, originals/old completed неизменны. Staging точно accepted SHA/DB, own scope/literal handlers, без настоящих notifications; main/prod не разрешены.

## Scope

apps/web/prisma/schema.prisma; new additive migration; server/plugins/event-subscriber-store.ts; server/plugins/events.ts; packages/plugin-sdk/src/index.ts comments; unit/native subscriber tests и truthful adapters двух существующих queue/context тестов. Fixtures только подtests; новые transport/metadata registries не нужны.