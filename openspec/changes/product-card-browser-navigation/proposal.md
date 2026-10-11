# Proposal

## Why

Блок подключения карточек в product-card-navigation.test.ts сравнивает буквальный JSX и ломается от форматирования. Задача160 заменяет этот блок наблюдением реального клика и сохраняет существующие проверки handler/SSR.

## What Changes

- Сохранить первые четыре handler/rendered-HTML tests и существующий project-kanban-card-layout runtime test.
- Удалить только последний source-regex блок подключения project/global карточек; отметить его disposition в карте159.
- Добавить реальный Chromium component gate с ProductsTab, ProductsKanban, ProductKanbanCard и DnD: правильное изделие, один переход по обложке и отдельно по неинтерактивному названию или телу карточки, отсутствие fullscreen и навигации из drag-preview.
- Перенести прежние source-assertions CardNumber в runtime coverage: существующий ProjectKanbanCard SSR и настоящие mobile project/product tables в browser fixture.
- Проверить форматирование-only вариант и два контролируемых дефекта: отключённый cover callback и callback другого изделия. Дефекты должны отвергаться actual click assertions.
- Результаты браузера, source/metafile provenance, mutation outcomes и отдельной staging-приёмки фиксировать по фактическому уровню. Missing binary не становится PASS.

## Capabilities

### New Capabilities

Нет новых бизнес-возможностей. Это обслуживание тестов и QA tooling; change использует skip_specs:true согласно spec-driven инструкции.

### Modified Capabilities

Нет. Действующие требования навигации, клавиатуры, DnD, ролевого доступа и внешнего вида сохраняются. Бизнес-specs не переписываются ради нового теста.

## Impact

Владелец:feature/160, base cd38cb745759becd58dbbad4d6d37afa03f0ab7a.
Планируемые файлы:
apps/web/tests/product-card-navigation.test.ts;
apps/web/tests/product-card-navigation-browser.mjs;
apps/web/tests/product-card-navigation-browser.test.mjs;
docs/testing/contract-matrix.json иREADME.md;
только соответствующий OpenSpec change.

Production components служат входами fixture и не меняются. Установленные React19.1.0/Playwright1.63.0/Chromium/esbuild переиспользуются без обновления versions/lockfile.
Local fixture использует synthetic rows/images и loopback HTTP, закрытые Next-navigation/server-action boundaries; реальные роли/SQL/серверные actions этим уровнем не доказываются.
Нет БД, миграций, seed/reset/dump, файлов сотрудников, production/main или infrastructure mutations. Commit/push требует root/owner разрешения.
