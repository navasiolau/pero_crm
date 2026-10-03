# Why
Работник видит производство после67, но добавить работу из действующего прайса может только менеджер. №68 даёт узкое создание работы и устраняет устаревший тариф вне транзакции.
# What Changes
- Активный WORKER добавляет работу только на живое PRODUCTION Product; manager union сохраняет прежний поток.
- Nullable Work.unitSnapshot для новых доверенных тарифов; старые NULL без backfill, изменение unit прайса не переписывает снимок.
- Узкий просмотр обычных LEGACY Work в live PRODUCTION для созданной работы/будущей69; дополнительные деньги/пулы не раскрываются.
- В глобальной task transaction повторно проверяются actor роли/active, Product/parent и PriceItem.active; снимок цены и количество рассчитывает сервер.
- Строгий payload исключает подмену unit/priceSnapshot/total/paymentKind; audit атомарен с Work.
- Отдельный canAddWork в UI не открывает task create/edit/delete, Product/status/files/finance или PriceList CRUD.
# Capabilities
## New Capabilities
- `production-worker-work-creation`: серверное создание производственной работы по действующему прайсу.
## Modified Capabilities
# Impact
Work core/action, targeted price picker, shared TasksTab и Product page. Исторические тарифы/quantity/payroll неизменны;69 allocation отдельно.
