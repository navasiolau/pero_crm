# Design

## Context

См. proposal.md. Существующая UserPreference хранит normalized query/version1 и raw-value CAS. Shared controller уже сериализует сохранения, отменяет старый поиск и защищает поздние ответы. Текущий normalizer сохраняет только один ID, активность по умолчанию true; products не входят в изменение.

## Goals / Non-Goals

**Goals:** несколько значений по каждой из четырёх осей с надёжным сохранением; новый default показывает все доступные проекты.

**Non-Goals:** изменение ролевого доступа, многозначные фильтры Изделий, новые таблицы, автоматический сброс по времени, дополнительные подтверждения.

## Decisions

- Значения проекта кодируются JSON-массивом внутри одного существующего query parameter: stage/client/manager/engineer. Старое одиночное значение читается как singleton. Shared controller/setter interface сохраняется; повторные query keys не вводятся.
- По уточнению владельца пустой набор, отсутствующее значение и выбор всех известных пунктов означают отсутствие этого фильтра. В исходном состоянии чекбоксы не выбраны. Непустой частичный набор ограничивает выборку; остальные оси остаются активны. Для явного выбора всех UI записывает режим без ограничения, чтобы сохранялись неназначенные проекты. При изменении options сохранённые IDs сами не очищаются.
- Общий helper apps/web/src/lib/project-filter-values.ts сохраняет API parseProjectFilterValue(value:string|undefined):string[]|undefined и encodeProjectFilterValue(value:readonly string[]|undefined):string|null. Пустая строка/undefined/[] нормализуются в отсутствие фильтра; частичный набор сериализуется массивом. Старое значение [] читается без ограничения согласно новому прямому указанию. Нормализация детерминирована и не обрезает выбранные IDs молча.
- Новые project preferences version2; отсутствующий active теперь false, active=1 — true, active=0 остаётся совместимым false. Version1 preferences сохраняют прежний эффективный active=true при отсутствии параметра: при чтении добавляется active=1, raw исходная строка остаётся CAS expected. Это не сбрасывает существующие настройки; новые/ручной Сброс показывают всё. Products preferences и defaults не меняются.
- По каждой оси используется IN (OR значений), между осями AND. ProjectListFilters получает plural stages/clientIds/managerIds/engineerIds; старые scalar поля сохраняют совместимость прочих callers. Engineers используют union participant product IDs вместе с responsible engineer IN, строго внутри прежнего project/product visibility scope.
- UI worker владеет filter-bar и dropdown с чекбоксами. State/server worker владеет helper/list-state/preferences/projects query и тестами. Existing CAS/controller/переключение видов сохраняются; менять их только по конкретному failing test.
- Выпадающий список содержит одну кнопку «Сброс» и поиск. «Выбрать всё»/«Снять выбор» удаляются. Сброс или снятие последней галочки убирает только выбранную ось, не статус/инженера/остальные настройки. Выбор не закрывает меню и не двигает viewport; подтверждения нет. Срок хранения не ограничен.
- Множественные project IDs могут превышать прежние4096 символов. Только для Projects query bound16384 и raw expected32768; Products сохраняет4096/8192. Превышение возвращает явную ошибку, выбранный набор не обрезается и не заменяется другим.

## Risks / Trade-offs

- [Пустой/полный выбор оставил пустую доску или ограничил неназначенные проекты] → codec/parser/query/UI regression отсутствия ограничения.
- [Старые ответы сбросили новый набор] → существующие race tests и последовательные быстрые checkbox changes.
- [Выбор расширил видимость] → multi-engineer/participant visibility regressions.
- [Version1 CAS потерял исходный token] → compatibility/save/CAS tests и сохранение raw expected.

## Migration Plan

feature/3 от fresh origin/staging221eaeec, task3 существующего плана. Read compatibility upgrade выполняется без SQL миграции. Source tests/build/strict/review → ordinary merge staging → CI → exact image/health → targeted native/preferences и краткий browser фильтры/возврат/reload. Existing local/staging, без дампов/restic/reset/seed/newDB/main/prod; W07/refresh неизменны.
