# Proposal
## Why
Project kanban не показывает cover53 и требует утверждённый порядок крупных номера/возраста/названия/клиента/суммы без currency label. Возраст должен отражать текущий этап, а не всё время существования заказа.
## What Changes
- Cover сверху, крупный boldномер и дни справа, далее title/client/число BYN без подписи и валютного суффикса.
- Cover открывает Project, readonlyfinancevisibility сохраняется.
- Stageage от latest actual transition; createdAt fallback только initial безhistory.
- Существующие counters/shortage после суммы остаются; Product карточки не меняются.
## Capabilities
### New Capabilities
- `project-kanban-card-layout`: Project card cover/layout/currentstageage.
### Modified Capabilities
Нет.
## Impact
Project list cover53/latesttransition projection, cardview/queryDTO и age helper; никаких contractdates/price writes/financial migrations/APIchanges.
