# Design
## Context
См. proposal. addWork сейчас manager-only, читает тариф вне task transaction и пишет audit после commit. TasksTab использует один canManage для всех контролов.
## Goals / Non-Goals
Узкое создание и атомарный audit. Price CRUD, изменение Work, task allocation69, финансовый ledger вне68.
## Decisions
Выделить addWorkCore и строгий контракт, оставить action тонким auth/invalidation. Current User.active/roles и active PriceItem читать внутри общей task transaction; Product row lock и live-parent predicates повторно проверяют статус. Decimal helpers inputNorm/scaleNorm/workBudget сохраняются. UI canAddWork отдельно от canManage; price picker привязан к разрешённому Product. Серверный unit сохраняется nullable Work.unitSnapshot, берётся только из active PriceItem; старые NULL не наследуют текущий unit. Миграция20261003120000 только ADD COLUMN, без DML. Обычные LEGACY Work без связей percentage pool читаются WORKER в live PRODUCTION; новые глобальные DTO маскируют priceSnapshot/total вне прежнего назначенного grant. Task visibility/execute прежние,69 отдельно.
## Risks / Trade-offs
Snapshot из stale price → свежий tx lookup. Ролевой отзыв/переход статуса → tx locks/current checks. Ошибка audit → Work rollback. Исторические rows/snapshots не массово изменяются, номера и деньги неизменны.

## Task writer и read DTO
Manager create проверяет обязательные productId/workId/assigneeId, живую связь Work→Product→Project, известный priceSnapshot и active/eligible исполнителя. Update не очищает эти ссылки и проверяет итоговый контекст. Существующий quantity budget, group-count-once и taskPieceAmount не меняются. Старые allocation денежные snapshots не переписываются. Additive rewardAmount/rewardCurrency/rewardSource вычисляются сервером; null остаётся недоступной суммой, 0 остаётся известным нулём. Workspace quarantine проверяет structural Work/Product/executor bindings, без title-эвристик; Finance/Payroll/settlements и ACL файлов не меняются, строки не удаляются.

## Проверка фактической связи Work/Task
Обе reward-ветки требуют живое изделие работы. Статичный параметризованный readonly eligibility join сравнивает Task.projectId/productId с Work.projectId/productId и Product.projectId, проверяет live Product/Project и возвращает только Task IDs. IDs добавляются AND к прежнему ACL; пустой набор остаётся id in []. Ни роли, ни money tables в этом join не расширяются. Тот же predicate используют рабочие списки, поиск, count и созданные назначения. Mapper дополнительно строго сравнивает фактические координаты Work/Task; NULL не трактуется как совпадение.
