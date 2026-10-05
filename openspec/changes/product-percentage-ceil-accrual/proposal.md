# Proposal

## Why

Показанная сумма должна совпадать с новым начислением, округлённым вверх до целого BYN. Старые SQL-правила фиксируют округление до копеек.

## What Changes

- Единый точный расчёт для UI/server; ENGINEERING от единичной цены, ASSEMBLY/INSTALLATION от партии. Новая calculationVersion=4, forward CHECK с CEIL(sourceFundExact), неизменная история 1–3 и FX retry.
- Задача 77, ветка bugfix/77; область согласована владельцем 05.10.2026 в запросе реализации плана75–78.

## Capabilities

### New Capabilities

- `product-percentage-ceil-accrual`: Единый точный расчёт для UI/server; ENGINEERING от единичной цены, ASSEMBLY/INSTALLATION от партии. Новая calculationVersion=4, forward CHECK с CEIL(sourceFundExact), неизменная история 1–3 и FX retry.

### Modified Capabilities

Нет изменений основных спецификаций; связанные действующие changes сохраняют свою историю.

## Impact

Математический helper, preview/types, queries/direct-completion, SQL-миграция и денежные тесты. Округление не распространяется на прочие денежные операции CRM.

