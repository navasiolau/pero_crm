# Design

## Context

См. `proposal.md` и `specs/product-cover-layout/spec.md`. У изделия уже есть `Product.sketchFileId` → `File`; карточка сейчас показывает превью, filename/open action и техническое описание отдельными блоками. Обычный `FileViewer` используется многими вложениями и показывает filename bar. File reads уже проходят через защищённый `/api/files/<id>` route, upload — через `/api/files/upload`; новые таблицы или storage locations не нужны. Product detail query уже возвращает только доступный actor-у sketch metadata.

## Goals / Non-Goals

**Goals:**
- Сгруппировать title/status/general data/description и cover в одной responsive detail area.
- Добавить opt-in fullscreen для обложки, не меняя стандартный `FileViewer` для остальных файлов.
- Добавить picker для уже прикреплённых к этому изделию изображений и загрузки нового PHOTO с атомарным cover pointer update по backend contract Sol.
- Использовать защищённые и сжатые `card`/`cover` previews; оригинал загружать для fullscreen.

**Non-Goals:**
- Не добавлять schema/storage changes, viewer 3D/B3D, crop/edit инструменты, File delete/detach, изменения состава ролей, статусов, ставок, shares, денег или kanban image/info ratio.
- Не создавать QA images/rows и не отправлять реальные file selections или cover changes в native acceptance.

## Decisions

1. **Responsive shell вокруг существующих product sections.** Когда cover назначен, на desktop объединить h1/ProductHeader/общие поля/description в левую часть около 60% и поставить cover в правую около 40%, выровняв его по первой строке title. На viewport ниже 1024 px оставить title/status group первым, cover следующим, далее поля и description; tabs остаются после detail block. Без cover убрать правую колонку целиком и оставить инфоблок на всю ширину; единственная affordance замены — небольшая иконка в области заголовка. Это переносит существующие content blocks, а не вводит второй набор полей или edit controls.
2. **Отдельная ProductCover presentation-компонента.** Если cover существует, slot содержит только защищённое preview и overlay icon actions — fullscreen и authorized replace. Без cover не показывать большую пустую рамку, filename, «Эскиз», «Открыть оригинал» или поясняющий текст; разрешённую замену дать одной небольшой иконкой у заголовка. Icon buttons получают accessible labels. Broken preview заменяется иконкой и screen-reader-only описанием.
3. **Оптимизированные previews с проверкой доступа до cache.** Kanban запрашивает `/api/files/<id>?preview=card` WebP (ограниченный 480×480), детальная обложка — `?preview=cover` WebP (до 1280×1600). Sol реализует ограниченный memory LRU cache и singleflight для одинаковых параллельных запросов. Handler каждый раз авторизует actor и проверяет связь File/Product до чтения cache или ответа `304`; ошибка обработки возвращается как HTTP error и никогда не вызывает original fallback. Старый `?thumb=1` путь сохраняется без изменений. `FileViewer` получает opt-in cover-fullscreen variant и открывает `/api/files/<id>` оригинал с `object-contain`, viewport-sized содержимым, Esc и close; его default variant и другие consumers остаются без изменений. Board/picker preview ленивые и `decoding=async`; cover eager/high priority; original загружается только при fullscreen action.
4. **Cover replacement through existing File records.** Picker получает только image Files уже прикреплённые к этому product из ACL-filtered detail DTO. Выбор существующего File вызывает Sol action `setProductCover(productId, fileId)`. Новый upload переиспользует POST `/api/files/upload` с `file`, `projectId`, `productId`, `category=PHOTO`, `assignCover=1` и без `taskId`; backend валидирует image MIME до storage write и связь того же product/project, атомарно сохраняет File+cover pointer+audit и возвращает `{ok:true,id}`. Старые файлы не удаляются; повторное назначение текущего cover идемпотентно. Селектор/клиентский action доступен management (A/D/M) на всех доступных изделиях и ENGINEER только на своём/участвуемом DESIGN по существующей technical-block permission. Остальные роли не получают replace action; union ролей сохраняет менеджерский приоритет.
5. **Display refresh only after successful pointer update.** Выбранный attached File или ответ upload/action переводит UI к новому cover только после подтверждённого успеха. Cancel или ошибка сохраняет текущий `sketchFileId` и показывает ошибку рядом с picker; повторный выбор того же cover идемпотентен. Не менять status, description, rates, participant shares или историю произведений.
6. **Offline tests plus constrained native picker check.** RED→GREEN tests покрывают grid order/ratios, action permissions, preview source, fullscreen viewer variant separation, pointer-commit/error behavior и минимальный file picker filter. Native local/staging разрешает только открыть и отменить file picker на существующей видимой карточке; не выбирать/загружать файл и не менять cover.

## Risks / Trade-offs

- [Оригинал на fullscreen дорог для сети] → не prefetch-ить его; загружать только при явном fullscreen action, а для cover/card использовать оптимизированные защищённые previews.
- [Preview-API отсутствует или отдаёт неожиданный размер] → сохранять прежний cover pointer, показывать icon fallback и не переходить на открытый storage URL; проверять HTTP error сценарий.
- [Picker случайно покажет файл другого изделия] → строить список только из уже ACL-filtered `product.files` данного product, а `setProductCover` повторно валидирует productId/projectId/MIME server-side.
- [Изменение общего FileViewer заденет вложения] → новый fullscreen layout включать только явным cover variant; default component markup и существующие consumers проверять регрессионным тестом.
- [Storage write прошёл, а File/pointer DB transaction завершился ошибкой или outcome неизвестен] → прежний cover pointer и старые Files остаются; не удалять новые storage keys автоматически при неизвестном commit, поскольку объект мог успешно стать новым cover. Возможен orphan blob; старые media не перезаписывать и не удалять.
- [Навигация сохраняет list preference] → перед любым read-only native navigation фиксировать исходную строку/отсутствие и возвращать исходное состояние через CAS; final preservation receipt обязателен отдельно для local и staging.

## Migration Plan

Схема БД и storage не мигрируют. UI использует Sol-owned actions/preview route, затем обновляется только `Product.sketchFileId`; старые File остаются. План локальной и staging проверки не создаёт новых files или QA records: native file picker только открывается и отменяется, а full-size screenshot используются лишь из уже существующих данных. Для проверки visual layout root выполняет CUA на 360×800, 390×844, 1440×900 и целевом 1920×1080, staging отдельно от local; CI workflow `needs:test` и текущий standard auto-deploy не изменяются. Rollback возвращает прежнюю раскладку и preview client; cover pointer и сами Files не затрагиваются кодовым rollback.
