# Design

## Context

См. proposal.md. Существующая UserPreference хранит normalized query/version1 и raw-value CAS. Shared controller уже сериализует сохранения, отменяет старый поиск и защищает поздние ответы. Текущий normalizer сохраняет только один ID, активность по умолчанию true; products не входят в изменение.

## Goals / Non-Goals

**Goals:** несколько значений по каждой из четырёх осей с надёжным сохранением; новый default показывает все доступные проекты.

**Non-Goals:** изменение ролевого доступа, многозначные фильтры Изделий, новые таблицы, автоматический сброс по времени, дополнительные подтверждения.

## Decisions

- Значения проекта кодируются JSON-массивом внутри одного существующего query parameter: stage/client/manager/engineer. Старое одиночное значение читается как singleton. Shared controller/setter interface сохраняется; повторные query keys не вводятся.
- Отсутствующее значение означает все, явное [] — ничего, непустой массив — точный набор. Для выбранных всех пунктов UI использует режим все, чтобы оставались видимы неназначенные проекты. Пункты не удаляются из сохранённого набора только потому, что отсутствуют в текущем options; новых участников не добавляют автоматически в явно выбранный набор.
- Общий helper apps/web/src/lib/project-filter-values.ts экспортирует parseProjectFilterValue(value:string|undefined):string[]|undefined и encodeProjectFilterValue(value:readonly string[]|undefined):string|null. Пустая строка/undefined — все; [] сериализуется явно. Нормализация детерминирована и не обрезает выбранные IDs молча.
- Новые project preferences version2; отсутствующий active теперь false, active=1 — true, active=0 остаётся совместимым false. Version1 preferences сохраняют прежний эффективный active=true при отсутствии параметра: при чтении добавляется active=1, raw исходная строка остаётся CAS expected. Это не сбрасывает существующие настройки; новые/ручной Сброс показывают всё. Products preferences и defaults не меняются.
- По каждой оси используется IN (OR значений), между осями AND. ProjectListFilters получает plural stages/clientIds/managerIds/engineerIds; старые scalar поля сохраняют совместимость прочих callers. Engineers используют union participant product IDs вместе с responsible engineer IN, строго внутри прежнего project/product visibility scope.
- UI worker владеет filter-bar и dropdown с чекбоксами. State/server worker владеет helper/list-state/preferences/projects query и тестами. Existing CAS/controller/переключение видов сохраняются; менять их только по конкретному failing test.
- Выпадающий список поддерживает все/снять выбор и поиск; выбор не закрывает меню и не двигает viewport. Дополнительной кнопки подтверждения нет. Срок хранения не ограничен; bounds входа сохраняют безопасность без тихого усечения.
- Множественные project IDs могут превышать прежние4096 символов. Только для Projects query bound16384 и raw expected32768; Products сохраняет4096/8192. Превышение возвращает явную ошибку, выбранный набор не обрезается и не заменяется другим.

## Risks / Trade-offs

- [Пустой выбор превращён во все] → codec/parser/query/UI regression.
- [Старые ответы сбросили новый набор] → существующие race tests и последовательные быстрые checkbox changes.
- [Выбор расширил видимость] → multi-engineer/participant visibility regressions.
- [Version1 CAS потерял исходный token] → compatibility/save/CAS tests и сохранение raw expected.

## Migration Plan

feature/3 от fresh origin/staging221eaeec, task3 существующего плана. Read compatibility upgrade выполняется без SQL миграции. Source tests/build/strict/review → ordinary merge staging → CI → exact image/health → targeted native/preferences и краткий browser фильтры/возврат/reload. Existing local/staging, без дампов/restic/reset/seed/newDB/main/prod; W07/refresh неизменны.
