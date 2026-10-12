# Proposal

## Why

Страница проекта вызывает getProjectMaterials отдельно для каждого изделия. Повторяются domain queries материалов, движений, складского состояния, авторов и документов; задача148 заменяет это пакетным чтением без изменений DTO, правил склада, денег, ACL и внешнего вида.

## What Changes

- Один reader по списку productId с текущим ACL и shared selections/grouping; scalar getProjectMaterials делегирует тому же механизму.
- Проект запрашивает материалы одним вызовом, сохраняя порядок groups относительно project.products и текущую форму ProjectMaterialsData.
- Сохраняются500 движений на каждое изделие ДО исключения INCOME, полный expenses total из active EXPENSE/RETURN, точные WAC/legacy/return-source правила, денежное маскирование, soft-delete и archived issued quantities.
- Query budget на1/5/20 изделиях: count20<=count1+2, без auth/setup; независимая DTO reference и native/actual UI/staging acceptance обязательны.

## Capabilities

### New Capabilities

- batch-project-materials: измеримый bounded query count при чтении нескольких изделий с сохранением существующего material read contract.

### Modified Capabilities

Нет. Пять main specs изучены, warehouse-specific batch read capability отсутствует. Бизнес-требования инженера/склада/финансов и роли не расширяются.

## Impact

bugfix/148 от свежего stagingcd38cb745759becd58dbbad4d6d37afa03f0ab7a. Предлагаются warehouse queries, project page loader и focused reference/query-count/native tests. Accounting/writer/schema/migration/API/SDK/UI components/styles не меняются, dependencies не добавляются. WIP135/139 сюда не переносится. Только planning до independent DESIGN_GO/root RELEASE; actual DB/install/runtime0. Main/production/restic/dump/reset/seed/new DB и new commits HOLD.
