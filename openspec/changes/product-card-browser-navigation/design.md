# Design

## Context

См. proposal.md. В исходном файле четыре полезных handler/SSR tests и один смешанный source-regex блок. Последний проверяет coverAction/onClick/setActivatorNodeRef и буквальный JSX CardNumber.
Оба действующих board передают navigate policy. Shared card без policy сохраняет fullscreen. Маршрут изделия использует product.number и контекстный returnTo.
CI уже устанавливает Chromium перед штатным test (.github/workflows/ci-cd.yml:55–59).

## Goals / Non-Goals

**Goals:**

- Проверить настоящие клики в Chromium по обложке и отдельно по неинтерактивному названию или телу ProductsTab и ProductsKanban: каждый жест даёт один router.push правильного изделия и правильный returnTo.
- Начать drag настоящей ручкой и PointerSensor, увидеть реальный DragOverlay и disabled cover button; навигация, fullscreen и server writes отсутствуют.
- Сохранить handler/SSR, оформление номера и проверку реальных mobile table components.
- Доказать устойчивость к форматированию и обнаружение двух дефектов через действия пользователя.

**Non-Goals:**

Production UI, handlers, права, API, DB/schema и версии зависимостей не меняются. JSDOM, DI и synthetic fixture не считаются серверной или staging-приёмкой. Миграционные guards не удаляются.

## Decisions

### Actual components and one fixture runner

product-card-navigation-browser.mjs — import-inert runner с общим lifecycle для baseline, formatting и двух mutants.
Он импортирует настоящие ProductsTab, ProductsKanban, ProductKanbanCard, product-card-cover-action, @dnd-kit/core, DragHandle и ListParamsProvider.
Прежний source-check номера ProjectKanbanCard уже покрывает project-kanban-card-layout.test.ts. Для ProjectsTable/ProductsTable добавляется проверка настоящего mobile markup.

Fixtures A/B имеют разные id/number: qa160-a/160.1 и qa160-b/160.2. Данные и PNG синтетические.
Loopback HTTP server обслуживает только bundle/CSS/известные images. Используется реальный Chromium channel=chromium, отдельный browser context и запись browser.version.
Next router записывает push URL после настоящего React event. Server actions закрыты явными boundaries; неожиданный callback или запрос ломает gate. Prisma/Next runtime и реальные данные не используются.
Готовые kanban-search-focus/image-natural scripts служат образцами; их нельзя импортировать, поскольку у них top-level execution. Новый runner переиспользуется внутри этой задачи.

### Click, drag and number assertions

После ready/images loaded выполняется настоящий pointer click по обложке A. Отдельно, после сброса счётчика push, выполняется trusted pointer click по неинтерактивному названию или телу той же карточки. Оба жеста проверяются для project и global boards: каждый даёт ровно один push, pathname=/products/160.1 и returnTo своего контекста, fullscreen dialog отсутствует. Body/title target не находится внутри кнопки, ссылки, ручки drag или обложки. Эта проверка отдельно защищает внешний onClick, поскольку cover handler останавливает propagation. Снятие внешнего обработчика обнаруживается body/title проверкой.
Drag начинается mouse gesture на действующей ручке. Проверяются появление overlay, disabled preview button и отсутствие перехода/fullscreen. Отпускание в том же статусе сохраняет zero server-action count.
Прежние четыре handler/rendered-HTML cases и существующий ProjectKanbanCard SSR сохраняются. Mobile table DOM содержит правильный CardNumber.
Кнопки и клавиатурная доступность остаются прежними.

### Formatting and two controlled faults

Варианты исходников существуют только в памяти и собственных ignored artifacts. Production files/hashes до и после совпадают.
Formatting variant создаёт TypeScript parser/printer при сохранённом AST/body.
Fault1 заменяет coverAction.onOpen callback на no-op; fault2 передаёт изделие B вместо A, оставляя обложку clickable.
AST locator ищет semantic coverAction у ProductKanbanCard в каждом board; private handler names и пробелы не являются условием baseline.
Каждый mutant имеет собственный declared source/transform digest. Provenance guard должен его принять. Проверка обязана пройти compile/mount/ready/trusted click, затем получить typed navigation-missing или target-mismatch. Ошибка hash/build/binary не считается убитым mutant.

### Commands and unavailable browser

После отдельного root install/heavy slot:

pnpm --filter @pero/web exec node --import tsx --test tests/product-card-navigation.test.ts tests/project-kanban-card-layout.test.ts
pnpm --filter @pero/web exec node --test tests/product-card-navigation-browser.test.mjs

Штатный web test glob подхватывает browser.test.mjs. CI/workflow не меняются.
Runner работает последовательно, всегда закрывает browser/server, ограничивает waits и запрещает внешнюю сеть.
Отсутствующий binary или launch error даёт failed gate и BROWSER_UNAVAILABLE/BLOCKED evidence. Silent skip и PASS запрещены. На planning этапе local binary не проверялся.

### Disposition and acceptance levels

В contract-matrix.json меняется только disposition последнего смешанного source block с replacement evidence/keepers. Baseline159/rawcoverage и его OpenSpec сохраняются.
Local/CI component-runtime подтверждает click wiring с синтетическими данными и boundaries.
Staging отдельно требует actual candidate SHA/image/health, approved signed readonly profile и настоящие project/global cover и body/title routes. Preferences изменяются только по reviewed CAS capture/restore.
Без profile/window staged сценарий остаётся NOT_RUN/BLOCKED. Cookies, PII и файлы сотрудников не входят в commits/evidence.

## Risks / Trade-offs

- Fixture скрывает server policy → уровень component-runtime указан явно; server ACL/runtime не подменяются.
- DnD timing → настоящий PointerSensor, overlay assertions, expect.poll/frame readiness, bounded waits и same-column drop.
- Mutant отказал до клика → обязательны ready/trusted click и подходящая failure stage; другой отказ ломает тест.
- Потеря проверки номера → сохранённый Project SSR и реальные table DOM replacements.
- Отсутствующий binary → fail closed, существующий CI install и отдельное разрешение local install.

## Migration Plan

Local targeted checks и Chromium → independent review → owner/root commit → normal merge staging → CI API и отдельные actual image/runtime receipts.
Исправления остаются в feature/160, повторяются затронутые checks. Production/main и данные не меняются.
