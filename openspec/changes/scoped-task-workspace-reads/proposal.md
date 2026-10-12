# Proposal

## Why

Задача 147 утверждённого плана. В accepted cd38 `taskWorkspaceWhere(actor)` вызывает eligibility без контекста: SQL извлекает все допустимые `Task.id`, затем Prisma переносит их в `IN`. Это происходит при открытии одного проекта, изделия, списка проектов и глобального поиска. Рост посторонних задач увеличивает передаваемый массив, хотя не влияет на результат карточки.

## What Changes

- Сделать контекст чтения обязательным и заменить `Task.id` read-моделью координат живых изделий `{id, projectId}` только выбранной области.
- Выражать согласованность Task, Work и Product константами одной пары проекта/изделия в Prisma relation filters. Отдельно сохранять прежние `taskWorkspaceBindings` и серверный ACL.
- Передавать projectId в карточке проекта и ключ id/номер в карточке изделия. Уже ограниченный worker-allocation сохраняет exact projectId/productId.
- Считать задачи списка проектов через один aggregate только для реально выбранных проектов после прежних фильтров и пагинации. Возвращаемые `_count.tasks`, порядок, total, маскирование, суммы и остальные DTO сохраняются.
- Ограничить eligibility глобального поиска прежним поисковым предикатом и отдельным actor/office grant; прежние порядок и take6 сохраняются. Для `/my`, `/tasks` и dashboard передавать их текущий task predicate, сохранив take100/take300 и прежнюю dashboard статистику без добавления task ACL.
- Зафиксировать query observer, эквивалентность ACL/cross-relations/drafts/soft-delete и метрики объёма координат на 1 и 10000 посторонних задач. Native SQL/EXPLAIN и staging проверяются отдельно по guards и разрешению root.

## Capabilities

### New Capabilities
- `scoped-task-workspace-reads`: ограниченная область чтения допустимых задач без массива ID всей базы, с сохранением ACL и прежнего результата.

### Modified Capabilities
- Нет: действующие роли, финансовые/исторические правила и видимость инженера DESIGN/PRODUCTION не изменяются.

## Impact

Предлагаемые8source paths: `apps/web/src/server/tasks/{workspace-contract,queries}.ts`, `apps/web/src/server/projects/queries.ts`, `apps/web/src/server/products/queries.ts`, `apps/web/src/app/api/search/route.ts`, `apps/web/src/app/(app)/{page.tsx,my/page.tsx,tasks/page.tsx}`. Meaningful tests: новый observer/read-contract, actual3pages и существующий task-reward workspace/relational fixtures/role tests; точный6test allowlist фиксируется в design перед RELEASE.

Цена решения: у списка проектов появляется aggregate вместо предварительного глобального массива; величина OR зависит от изделий выбранной области, а не числа задач. Это проверяется фактическим query shape и отдельным approved EXPLAIN; снижение latency заранее не объявляется.

## Non-goals

Нет изменения статусов/таймеров/денежных расчётов, записей/схемы/миграций, UI, механизмов аутентификации, новой роли или доступа. WIP130/132/133 не переносится. Main/production, restic, dumps/reset/seed/new DB запрещены. Планирование не разрешает implementation/SQL/staging/commit.
