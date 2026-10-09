# Verification

Задача 117, `feature/117`, база `origin/staging` `87c404846bdb659a2f9f45e3b9d7a0a98c5ad17a`. Локальная проверка завершена 09.10.2026 МСК (08.10.2026 23:25 UTC). Согласованное изменение реализовано в отдельном worktree. Git-коммиты, merge, deployment и staging-приёмку координирует основной агент; независимое ревью завершено, staging пока ожидается.

## Source freeze

14 appsource файлов, суммарный SHA256 `a3e01a46716ae7f58c3400071dfee4e3232288a6ccdc167649655f46345cf981`. Точные относительные пути и отдельные SHA256 сохранены в private ignored `.playwright-mcp/search117/source-freeze.json`.

## RED / GREEN

- Query RED: старый запрос возвращал проекты `hidden`, `client`, `own` только по `CustomerToken`, вместо пустого результата identity-режима. После ограничения области GREEN — 4/4 новых query-теста и 15/15 вместе с multi-select compatibility.
- Browser RED: настоящий канбан не прокручивался к точному номеру; остаточная ошибка координат 1324.5 px. После общего hook оба настоящих канбана центрируют карточку и сохраняют курсор поиска.
- Первый full-unit/TSC обнаружил устаревшие прямые SSR callers после добавления required props/context к board. Реализация сохранена совместимой: View подтверждает query/pending/draft/modal; board ждёт rows/DnD. Без подтверждённой пары обычный caller имеет disabled поиск. Старые SSR assertions не изменены.

- Независимое ревью нашло P2: возврат desktop→mobile при ещё открытом Sheet не возвращал блокировку. Реальный browser RED mobile→desktop→mobile + exact q дал boardleft1289/pageY1381 вместо0/0. Исправлена только синхронизация модальности открытого Sheet; обычное закрытие всё ещё ждёт onOpenChangeComplete. GREEN обеих досок — 34 browser-группы, TSC/lint PASS. Повторный full-unit — 1477/1477 PASS; focused re-review — NONE, reviewer проверил все 14 appsource SHA, mismatches0.

## Commands and results

В новом worktree использованы junctions к существующему dependency runtime задачи 111, без install и Prisma generate. Первый обычный pnpm-запуск остановился до изменений на `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; последующие проверки задают существующий CLI флаг `--config.verify-deps-before-run=false`, который отключает автоматический install metadata-check, сохраняя реальные locked зависимости.

- `pnpm --config.verify-deps-before-run=false --filter @pero/web test` — PASS, **1477/1477**, 0 fail/skip; private лог `apps/web/test-results/task117-full-unit.log`.
- `pnpm --config.verify-deps-before-run=false --filter @pero/web exec tsx --test tests/global-product-thumbnail-navigation.test.ts tests/product-draft-boards.test.ts tests/product-preparation-boards.test.ts tests/project-kanban-card-layout.test.ts tests/kanban-search-page-adapter.test.mjs tests/kanban-identity-search.test.ts` — PASS, **19/19**.
- `pnpm --config.verify-deps-before-run=false --filter @pero/web exec tsc --noEmit` — PASS.
- `pnpm --config.verify-deps-before-run=false --filter @pero/web exec eslint` с перечислением всех 14 appsource файлов и трёх новых тестовых файлов — PASS.
- `openspec validate kanban-identity-search-focus --strict` — PASS.
- `git diff --check` — PASS.

Query-тесты исполняют настоящие listQueries/visibility на связанном read-only fixture adapter: собственные номера/названия, регистр названия, отрицательные description/client-name/surname/middle-name/parent-title/parent-number, роли, soft-delete, все оси фильтров, прежний поиск default callers и отсутствие searchScope в URL. Page adapter исполняет реальные server page функции на границах session/listQueries, проверяя identity только для канбана и связанную пару resolvedQuery/rows.

## Actual browser

`pnpm --config.verify-deps-before-run=false --filter @pero/web exec node tests/kanban-search-focus-browser.mjs` — PASS, **34 группы** на реальных React Views, Controller, карточках, DnD, Sheet/Base UI и Tailwind. Подменены только Next-навигация и серверный transport; эти результаты не являются staging-приёмкой.

Проверены оба канбана: дальняя колонка/вертикальная страница, достижимый центр, activeElement/caret, неизменные ширины/колонки/порядок, нижняя полоса; полный и быстрый clear/reenter до debounce; title/partial/no-result без автоперехода; pending/stale RSC и q с устаревшей осью фильтра; consumed missing exact с late SSE; ручная прокрутка/SSE без повтора; active DnD с ожиданием завершения и без маркера DragOverlay. На 390 и 360 px: initial saved query после responsive render, открытая панель фильтров сохраняется, переход ждёт полного закрытия, реальный CDP touch возвращает native snap перед ручной прокруткой и сохраняет синхронизацию полосы/отсутствие body-overflow. Переход мгновенный, включая reduced motion.

Private ignored receipt: `.playwright-mcp/search117/receipt.json`. Скриншоты: `projects-1440.png`, `products-1440.png`, а также оба раздела на 390/360 px в той же папке. Фактический mobile PNG проверен визуально: карточка целиком в центре, колонки не перестроены.

## Remaining acceptance

Фактически развёрнутый staging SHA/OCI/health плюс реальные desktop/mobile сценарии поиска. Для browser на staging использовать только согласованного QA-пользователя и фиксировать/очищать только его предпочтения по reviewed lifecycle; данные существующих пользователей не менять. Новый поиск не требует миграций, новых библиотек или инфраструктурных действий. БД, staging и production этим worker не изменялись; дампы и restic не использовались.


## Staging adapter source checkpoint

Новый source-only stage-browser и controlled contract tests описаны в [staging-acceptance.md](staging-acceptance.md). Независимое QA ревью выявило scalar/JSON-array mismatch. После RED actual-service startup обеих секций builder использует реальные normalizeListQuery/encodeListFilterValue; GREEN15/15 controlled tests, включая реальные service/store/controller startup и genuine Flight ACK, lint PASS; appsource не менялся. Это не staging-приёмка; actual runtime/Git/DB этим worker не выполнялись.


QA P2 исправление: полный unit-набор1492/1492 PASS, TSC/lint/strict OpenSpec/diff-check PASS. Новые actual server-normalizer/service/controller startup tests дали RED на scalar обеих секций, затем GREEN15/15 с canonical JSON-array. Положительные ACK получены из настоящего service/store; ручной scalar ACK запрещён. Stage/DB/Git не выполнялись.


## Separate producer/Root caller source

Для117 подготовлен самостоятельный fresh4-row lifecycle, настоящий producer-HMAC/current verifier и actual manifest ABI (`server/...`→public`src/...`, unique42hex, две typed worker/layer routes), без расширения113 scope. Source controlled20/20 и lint PASS; compile-only bundle70009 B PASS. Actual native PostgreSQL prerequisite/DB/SSH/browser не выполнялись worker; shared111 dependency runtime и generated client не менялись. Detailed Root-only API и failure/closure boundaries — staging-acceptance.md.
