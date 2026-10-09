# Verification

Задача 117, `feature/117`, база `origin/staging` `87c404846bdb659a2f9f45e3b9d7a0a98c5ad17a`. Локальная проверка завершена 09.10.2026 МСК (08.10.2026 23:25 UTC). Согласованное изменение реализовано в отдельном worktree. Git-коммиты, merge и deployment координирует основной агент. Независимое ревью завершено. Root подтвердил фактическую staging-приёмку ревизии `37f882f69a2d76901b98321ff7824d0d04db4db8`; её evidence и завершённая очистка описаны ниже.

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

## Actual staging acceptance

Root выполнил run `45724aed-e43c-4bdb-9b90-8ee20610d6dc` после обычной интеграции и публикации CI. Фактически развёрнутый staging: SHA `37f882f69a2d76901b98321ff7824d0d04db4db8`, OCI image `sha256:e59a361d87fb0acd84be943747375115f8aa014225b7dd8d5d39e95d693daf0f`. Подписанные native/PRE/checkpoint/observation/cleanup receipts подтверждают один и тот же web container `5768bed77a88f6ce8309492c86082553801f06ce76c1d5d51a9200cc80b98959`, DB container `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a` и volume `crm-staging_pgdata`. Actual browser проверил HTTP 200, `status=ok` и `database=ok`. Публикация образа проходит обязательный test gate CI; прямой ответ private GitHub Actions API не используется как отдельное доказательство.

Actual staging browser — **30/30 PASS**: оба канбана на 1440×900, 390×844 и 360×800. Реальные ответы подтверждают собственные номер/название и отсутствие совпадения по клиенту, техническому описанию и названию связанной сущности. При точном номере карточка достигает ближайшего доступного центра с ошибкой менее 2 px, сохраняются колонки, размеры, порядок и синхронизация нижней полосы. На desktop сохраняются DOM-фокус и курсор ввода. На телефоне поиск не закрывает Sheet и не прокручивает доску до закрытия пользователем. Для названия и отрицательных запросов сохраняется предварительно выставленная ручная позиция. Фактические PNG `projects-1440.png` и `products-360.png` просмотрены визуально: целевая карточка видна, структура колонок сохранена. Все шесть PNG лежат в private ignored `.playwright-mcp/search117/staging-45724aed-e43c-4bdb-9b90-8ee20610d6dc/`.

Clear/reenter, частичные номера, stale pending, SSE и active DnD покрыты перечисленными выше **34 локальными React/Chrome группами**. Они не объявляются дополнительными сценариями actual 30-group staging loop. Actual запросы завершены: `requestsDrained=true`, `unresolvedIntents=0`, denied requests и page errors — 0; ledger содержит 36 INTENT и 36 genuine ACK только для двух предпочтений собственного QA-пользователя.

Native prerequisite на настоящем PostgreSQL подтвердил exact CAS cleanup с 0, 1 и 2 предпочтениями и проверенный внешний ROLLBACK: `rollbackVerified=true`, `originalsMatch=true`. Затем Root создал только собственные User/Client/Project/Product (4 записи). После browser были удалены эти четыре записи и два собственных UserPreference; подписанный late closed proof: **`remainingOwnedRows=0`, `originalsMatch=true`**. Защищены исходные данные и схема всех 54 public-таблиц. Только монотонный operational `ApiToken.lastUsedAt` изменился в рамках reviewed token-clock contract (`apiClockChanged=true`); bot clock не изменился. Данные существующих пользователей, файлы, склад и финансовые факты не изменялись.

Первый cleanup вызов Root (tool chunk `6e7d68`) был отклонён protected wrapper: `BROWSER_INPUT_TOO_LARGE`, base64 input 98 512 символов при лимите 98 304. Отказ произошёл после физического guard/lock, **до container/Prisma/SQL dispatch**. Этот неуспешный вызов не отмечается PASS и не выдаётся за cleanup ACK. Исходные intent, signed PRE/checkpoint/observation и 72 ledger-события сохранены без изменений.

Отдельно reviewed one-shot recovery helper передал тот же полный подписанный input в compile-time bundle 140 055 B (SHA256 `455b22245ec9db0d035f4120f35cbb4974173d9ed42b653e71cf9abec2e7a33a`) и минимальный restore envelope 216 base64-символов. Лимиты wrapper остались 96 KiB input / 256 KiB bundle; frozen producer sources и полномочия не расширены. Новый эксклюзивный каталог transport diagnostics сохраняет исходный refusal log. Единственный recovery restore получил настоящий signed commit ACK; отдельное последующее read-only наблюдение подтвердило закрытие run (Root tool chunk `984929`).

Private ignored signed artifacts: `.playwright-mcp/search117/owned-45724aed-e43c-4bdb-9b90-8ee20610d6dc/`. SHA256 исходных bytes:

| Артефакт | SHA256 |
|---|---|
| `native.json` | `9ccf3da8f8b5708bc49c19788f19b0127d869567d92faaa306d27af300e4d480` |
| `pre.json` | `d71ff187c1f76098de6f8c77c4de4e886cbbadbc84dc9171d17c25a81018a508` |
| `browser-result.json` | `2ad7f034e07b9f5d6922ba8c768125358ca576494cb80cfd7a8f9407debcbbd6` |
| `observation.json` | `809ee13b004406e7a54dd4f564c697e70abd5b8e9fe2aaf5bdd5b9fc7a03ef4d` |
| `cleanup-intent.json` | `5218a940125c3949072529137ff8f545d9d6ccea3c566ea8ac43e070c060429f` |
| `cleanup-events.json` | `c1dccdcdc5627edeffa89ee6a5c6f4a7396cebf140d3481a998fd27d41aa2cc8` |
| `cleanup-recovery-intent.json` | `f81d4537a161e3673cefe66b2c944abf7f7e7654249504f3b98d0d6716f96045` |
| `cleanup-recovery-ack.json` | `a9b29e6a1d2d766acb23dc6e359eff54a89bfe9aa4f1b486d22c359f777a99e6` |
| `cleanup-recovery-closed.json` | `26bbb8d9582cdffdf96cc9a61c8b8640023112fd0c7724b1dddc94bd4928c1a8` |

Приёмка приложения задачи 117 и lifecycle закрыты на указанной ревизии. Main/production не выпускались. После интеграции последующих QA/docs-коммитов Root фиксирует итоговую фактически развёрнутую ревизию всего пула задач. Дампы, restic и инфраструктурные изменения не выполнялись; этот evidence worker читает только локальные receipts и запускает локальные controls.

## Cleanup recovery source verification

Два новых source-only QA файла проверены отдельно; appsource и восемь frozen lifecycle/contract файлов задачи 117 не менялись. Независимое source review `review114_112` — NONE. SHA256:

- `tests/kanban-search-cleanup-recovery.mjs` — `e7296c44d8d3e78a4e5368a1fb43413c24d90521bccc8d74a394b53e7e6ce2e0`.
- `tests/kanban-search-cleanup-recovery.test.mjs` — `0cdc6f9b9ca56b4c92309d67d0bf394708f38341a94822fb2f45fabbc65b48c4`.

`pnpm --config.verify-deps-before-run=false --filter @pero/web exec tsx --test tests/kanban-search-cleanup-recovery.test.mjs` — **5/5 PASS**, fail/skip 0. Controls проверяют известный remote отказ до dispatch, неизменность signed chain/ledger и лимитов, отказ при unknown outcome/другой границе, совпадение последнего genuine ACK и физической identity, сохранение исходного диагностического журнала. Первоначальный `node --test` остановился до исполнения tests на extensionless TypeScript import; для locked TS импортов использован штатный `tsx` без изменения source/runtime.

`pnpm --config.verify-deps-before-run=false --filter @pero/web exec eslint tests/kanban-search-cleanup-recovery.mjs tests/kanban-search-cleanup-recovery.test.mjs` — PASS. Эти controls не выполняют DB, HTTP, SSH или staging actions.


## Staging adapter source checkpoint

Новый source-only stage-browser и controlled contract tests описаны в [staging-acceptance.md](staging-acceptance.md). Независимое QA ревью выявило scalar/JSON-array mismatch. После RED actual-service startup обеих секций builder использует реальные normalizeListQuery/encodeListFilterValue; GREEN15/15 controlled tests, включая реальные service/store/controller startup и genuine Flight ACK, lint PASS; appsource не менялся. Это не staging-приёмка; actual runtime/Git/DB этим worker не выполнялись.


QA P2 исправление: полный unit-набор1492/1492 PASS, TSC/lint/strict OpenSpec/diff-check PASS. Новые actual server-normalizer/service/controller startup tests дали RED на scalar обеих секций, затем GREEN15/15 с canonical JSON-array. Положительные ACK получены из настоящего service/store; ручной scalar ACK запрещён. Stage/DB/Git не выполнялись.


## Separate producer/Root caller source

Для117 подготовлен самостоятельный fresh4-row lifecycle, настоящий producer-HMAC/current verifier и actual manifest ABI (`server/...`→public`src/...`, unique42hex, две typed worker/layer routes), без расширения113 scope. Source controlled20/20 и lint PASS; compile-only bundle70009 B PASS. Actual native PostgreSQL prerequisite/DB/SSH/browser не выполнялись worker; shared111 dependency runtime и generated client не менялись. Detailed Root-only API и failure/closure boundaries — staging-acceptance.md.
