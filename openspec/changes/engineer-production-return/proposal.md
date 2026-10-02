# Proposal

## Why

Новое прямое решение владельца №37 разрешает текущему назначенному инженеру возвращать изделие из PRODUCTION в DESIGN и отменяет обязательность модели. Прежние model/participant guards и исчезновение карточки послеPRODUCTION противоречат этому решению.

## What Changes

- Current Product.engineerId: DESIGN↔PRODUCTION, включая безопасный повтор, без file/task/legacyrecipient prerequisites.
- Менеджмент выбирает любойProductStatus, financialguards/unique snapshots сохраняются.
- Assignedengineer read/list/filter DESIGN+PRODUCTION, technicaledit/finance не расширяются.
- NoModelcheckbox/ordinarysetter и B3Dstatusgate убраны без DBmigration/удаления данных.

## Capabilities

### New Capabilities

- `engineer-production-return`: card/kanban/current server transition без модели.

### Modified Capabilities

- `engineer-product-access`: read grant текущего назначенного инженера на DESIGN и PRODUCTION.

## Impact

product-header/product-percentage-status/status-core/accessvisibility/queries/NoModelordinaryactions; legacy DB/files/pay/history preserved. feature37 fresh3cd, root owns integration/runtime; no schema/dependencies/moneychanges.
