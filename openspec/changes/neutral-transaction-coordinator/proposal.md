# Proposal

## Why

№150: общий денежный/task adapter находится в tasks/transaction, создавая ложное доменное владение. Смешанные writers уже используют его общий lock; требуется нейтральное расположение без изменения семантики.

## What Changes

- Нейтральный server/transactions/coordinator с прежней единственной реализацией, factory/singleton/type.
- tasks/transaction — compatibility aliases тех же объектов. Все runtime callers продолжают использовать один adapter; confirmation и payment scenario используют neutral type imports.
- Lock18435/55001, порядок lock→callback, ReadCommitted, maxWait5000/timeout15000, callback/error/rollback/commit fence неизменны. Warehouse/logistics собственные guards/опции и lock segmentation вне scope.

## Capabilities

### New Capabilities

- shared-transaction-boundary: neutral location и совместимые aliases общего adapter.

### Modified Capabilities

Нет.

## Impact

feature/150 от свежего origin/staging cfc4; обычное FF-слияние зависимости154 aa0a65dd. Четыре production-файла: coordinator, compatibility aliases, type imports в confirmation и payment core. Существующие work-shares/cash-mixed/confirmation проверки и одна регрессия aliases/rollback/options. Один нативный сценарий вызывает прежние payment/payout writers на двух соединениях: 500 против 600 при остатке 1000, ожидание lock, повтор UUID и fresh fence после abort. Он использует существующие helpers163/161 и запускается только после ревью и Root ONE. Проверка №130 на DI не выдаётся за нативный результат. Schema/role/FX/audit/receipt/history/UI не меняются. Владелец разрешил план и коммиты; интеграция и push принадлежат Root. SAFETY-RULES: STOP при mismatch; main/production/restic/dumps запрещены.
