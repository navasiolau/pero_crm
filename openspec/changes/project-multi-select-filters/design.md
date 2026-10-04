# Design

## Context

См. proposal.md. Projects использует MultiSelectFilter/JSON/V2; Products всё ещё имеет scalar Select/SearchableSelect, active defaulttrue и V1. Повторяются JSX поиска, чекбокса и сброса.

## Goals / Non-Goals

**Goals:** одна конфигурируемая панель и один codec для двух страниц, одинаковые правила выбора/сброса/сохранения.

**Non-Goals:** добавление отсутствующих предметных фильтров, изменение ролей/денег, миграции или production.

## Decisions

- Новый apps/web/src/components/entity-list-filter-bar.tsx владеет поиском, MultiSelectFilter rendering, active checkbox с единым текстом «Незавершённые» и общим Сброс. Props section, searchPlaceholder, fields: queryKey/label/allLabel/searchPlaceholder/options/width. Project/Product wrappers только формируют конфигурацию; не копируют JSX или get/set/reset/active логику.
- Rename project-filter-values.ts → list-filter-values.ts и exports parseListFilterValue/encodeListFilterValue. UI/normalizer/оба серверных parsers используют один codec. Старые ссылки scalar читаются как singleton; []/пустое/all UI означают отсутствие оси; другие оси сохраняются, unknown selected IDs не удаляются по options.
- Нормализация использует конфигурацию keys/status enum по разделу: Projects stage/client/manager/engineer; Products status/project/client/engineer. Не копировать project-only ветку normalizer.
- Общий MAX_LIST_QUERY_LENGTH=16384 используется preferences и безопасным returnTo из карточки; старый предел4096 не должен терять большие наборы. Prefix /products? учитывается отдельно, same-origin/path/tab/controlchar guards сохраняются; реальный150clients roundtrip проверен.
- Оба раздела сохраняют V2, читают V1 с прежним effective active=true при отсутствии explicitactive0, сохраняя raw CAS expected. Новые/Сброс activefalse, active1true/0false. Обеим страницам bounded query16384/expected32768 без усечения. Никакого TTL или общего ключа: projects.list/products.list независимы.
- ProductListFilters получает plural statuses/projectIds/clientIds/engineerIds с scalar caller compatibility. OR внутри оси, AND между осями; empty arrays не добавляют ограничений. Engineer responsible/participant union строго внутри существующего product/project visibility.
- UI worker владеет общей панелью/двумя wrappers и realcomponent tests. State worker владеет rename codec/normalizer/preferences/обоими parsers и unit tests. Согласовать imports, не конфликтовать.
- Reuse existing controller/CAS store и готовый QA flow: durable genuine HTTP ACK сразу передаётся браузеру; signedcurrent/exact restore перед cleanup. Никаких per-click блокирующих capture RPC или нового QA framework.
- Stage acceptance: новая Products цепочка partial/Сброс/reload/newcontext + короткий Project shared-renderer smoke; без повторного Income/finance/старых browser циклов. Native оба раздела на existingDB в outerROLLBACK, original MATCH.

## Risks / Trade-offs

- [Дублирование осталось под разными именами] → thin wrapper/source review и общие actualcomponent tests.
- [Product фильтр расширил права] → actual query visibility/participant regression.
- [Сброшены старые значения/другой раздел] → V1rawCAS/V2/user+section isolation tests.
- [Shared UI сломал Projects] → прежние component/race tests и короткий stage smoke.

## Migration Plan

Продолжение feature/3 FF доab1604a → RED/GREEN → необходимые localchecks/native/review → ordinarymerge/CI → actualstage. Без SQL/data backfill/restic/дампов/reset/seed/newDB/main/prod; W07/refresh неизменны. Nightlystaging externalrestore может заменять UserPreference, приложение TTL не вводит.
