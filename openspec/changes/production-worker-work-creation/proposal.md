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

## Уточнение владельца: задача конкретной работы
Новая Task создаётся только для Work живого Product с сохранённой расценкой и одним активным допустимым исполнителем. Manager writer больше не создаёт generic/project-only/orphan/unassigned задачи. Нулевая известная цена остаётся допустимой; independent allocations количества №69 не являются делением долей Task. Старые денежные обязательства и комбинированные роли №70 сохраняются. Service-импорт t47 не удаляется. По прямому уточнению владельца рабочие списки требуют structural Work/Product/executor bindings и доступную расценку либо fixed monetary snapshot; финансовая история остаётся без этого фильтра. Actual readonly sampler подтвердил 1129 service-prefix t47 Task с NULL workId и нулём Payroll/StageSettlement/activeTimer refs; это не основание удалять данные. UI долей относится к отдельной №69.
