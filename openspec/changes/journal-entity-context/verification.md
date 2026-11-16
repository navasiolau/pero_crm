# Проверки №224

## Исходное состояние

Ветка `feature/224`, собственный worktree `journal-224`, базовый staging `26f1d12ab131e673930475f30203e35797a062ce`. Новый EntityJournal подключает UI №223 после штатного merge; файлы соседних worktree не копируются. Данные и инфраструктура не изменяются.

## RED → GREEN серверных страниц

`pnpm --filter @pero/web exec node --test tests/journal-entity-pages.test.mjs` до реализации завершился exit1: последняя вкладка проекта — «Модуль», «Журнал» отсутствует. После реализации PASS 1/1 (0,559 s).

Тест исполняет реальные async ProjectPage/ProductPage, роли из настоящего roles.ts, Base UI Tabs, ProductSinglePage и EntityJournal. Изолированы внешние readers, чужие тяжёлые визуальные блоки и содержимое Journal; записи БД невозможны. Проверены ADMIN, DIRECTOR, MANAGER, ENGINEER, ACCOUNTANT, PROCUREMENT, WORKER, MOUNTER и две допустимые комбинации. Только ADMIN получает вкладку/секцию; `tab=journal` у остальных не монтирует журнал. Проверены последний trigger после плагина, последняя секция без продуктовых tabs и постоянные IDs вместо URL-номеров. Неактивная вкладка ADMIN не монтирует Journal; нижний журнал изделия до intersection содержит только placeholder.

Регрессия `product-single-page.test.ts`: PASS 4/4 (1,281 s). Целевой ESLint: exit0, 0 warnings.

## Browser RED

`journal-entity-browser.test.mjs` подготовлен до реализации: exit1 на отсутствующем EntityJournal. Тест использует реальные Tabs/ProductSinglePage/EntityJournal/Journal с synthetic read-only transport, проверяет zero-before-load, точные scopes, reset, direct tab, повторные intersections и fallback без IntersectionObserver.

## Интеграция №223 и GREEN

По явному разрешению root выполнен fast-forward `origin/staging` до `5d7dd7580291edc7166057096966b49eed6b8cd8`. Собственный WIP сохранён, UI №223 получен обычным merge, без копирования. Добавлено только имя `journal-entity-browser.test.mjs` в существующий components-1 cohort; graph/jobs/gates/caches не изменены.

- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: exit0.
- `pnpm --filter @pero/web exec tsx --test tests/journal-*.test.ts tests/journal-page-access.test.mjs tests/journal-entity-pages.test.mjs tests/product-single-page.test.ts`: PASS 54/54, 0 skipped, 2,466 s.
- `pnpm --filter @pero/web exec node --test tests/journal-entity-browser.test.mjs tests/journal-interface.test.mjs`: PASS 2/2, 0 skipped, 6,606 s. Реальный Journal №223, Tabs и IntersectionObserver; только транспорт синтетический.
- Подтверждены ноль journal requests до открытия вкладки/нижней секции, один точный scope после открытия, direct tab, reset без потери scope, отсутствие повторного initial запроса после повторного intersection и кнопка загрузки при отсутствии API наблюдения. Desktop и mobile390.
- Целевой ESLint: exit0, 0 warnings; OpenSpec strict и diff-check: PASS.

## Оставшаяся приёмка

Diff передаётся root без собственного commit или push. Actual staging root проверяет отдельно после CI и фиксирует результат в checklist 3.2; результаты local fixtures не являются его заменой.

## Последний CSS №223 и полная ролевая матрица

По явному Git GO выполнен fast-forward до `a632e1e36326c61f157d3de5d506e533fe0b3ff2`, WIP №224 сохранён. В существующие матрицы `journal-entity-pages`, `journal-page-access`, `journal-reader-access` и `journal-admin-only` добавлены WORK_COORDINATOR и WORK_COORDINATOR+WORKER. Новые тестовые файлы или дублирующие сценарии для ролей не создавались; production guard уже общий ADMIN-only.

Повторные проверки: полный web tsc exit0; профильные journal/page/product tests PASS 54/54 (1,752 s), включая реальные project/product SSR для 12 сочетаний ролей, глобальную навигацию/route callback, нулевые journal reads/transactions и отсутствие рендера для координатора. Browser PASS 2/2 (5,946 s), включая последние узкие фильтры №223. Scoped ESLint: exit0, 0 warnings; strict OpenSpec и diff-check PASS. HTTP-проверка координатора на реальном staging остаётся за root с его собственной QA auth-фикстурой; local тест не объявляется её заменой.
