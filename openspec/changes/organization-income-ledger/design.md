# Design

## Context

Feature61 начинается от fresh staging d94e25d с workspace59, live guards54 и codes62. Payment.projectId/projectAmount обязательны; org/cash aggregates и getTurnoverByn уже не ограничены проектом.

## Goals / Non-Goals

Goals: один общий приход без фиктивных сущностей, строгая касса/FX/BYN, безопасный finance UI.
Non-Goals: переписывание истории, новая финансовая формула, manager grant, новые currencies, production.

## Decisions

Payment получает nullable projectId/association и projectAmount. Forward CHECK фиксирует: EXPENSE имеет projectId и projectAmount; общий INCOME имеет оба NULL; проектный имеет оба значения. FK сохраняется без перезаписи строк.

Общий INCOME проходит тот же writer: Finance guard до чтений, cash currency, Decimal cents, rate/date; пропускается только project lookup. EXPENSE без проекта отказывает до FX/DB. Повторная проверка live project и cash внутри существующей глобально сериализованной транзакции. Payment, ChangeLog, outbox атомарны, уведомление после commit. Удаление общего прихода сохраняет кассовый и общий потолки.

Финансы → Приходы использует безопасный nullable project DTO и общий PaymentDialog, optional selector на основе existing live refs. Прежний project dialog остаётся fixed-target. Никакой общий приход не входит в getProjectEconomics. Организация/касса/месячный оборот включают ровно одну Payment. Null projectAmount никогда не превращается в ноль в DTO.

## Risks / Trade-offs

Nullable связь затрагивает удаление/проекции → tsc и регрессии платежей/баланса. Неоднозначная история payout → прежний requireHistoricalByn fail-closed, без нового FX.

## Migration Plan

Worker создаёт migration20261003080000 и private native runner BUILD ONLY. Root выполняет static DDL и реальные cores в одной outer rollback на существующем local, подтверждает public data/schema fingerprints; потом ordinary staging merge, actual image/health/smoke. Main не разрешён; restic/dumps/seed/reset запрещены.
