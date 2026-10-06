# Proposal

## Why

Работник цеха (WORKER) видит карточку чужого изделия в PRODUCTION по глобальному чтению, но файлы изделия пустые, эскиз скрыт, флаг hasB3d ложный, а скачивание через /api/files/:id возвращает 404, потому что fileVisibilityWhere требует назначения на изделие или задачу. Монтажник (MOUNTER) также не видит файлы неназначенных изделий со статусом не DESIGN. Цех не может открыть замеры, документы производства и монтажа и файлы инженера, нужные для работы.

## What Changes

- WORKER и MOUNTER видят все файлы изделия со статусом не DESIGN: прямые файлы изделия (замеры MEASUREMENT, документы производства и монтажа, файлы инженера), эскиз sketchFile, признак .b3d hasB3d, счётчик _count.files и файлы задач этого изделия.
- Статус DESIGN остаётся закрытым для неназначенных WORKER/MOUNTER: файлы DESIGN-изделий по-прежнему требуют назначения.
- Только чтение через fileVisibilityWhere: списки файлов, эскиз, hasB3d, счётчики и скачивание /api/files/:id. Загрузка, удаление, правка эскиза и цены не меняются.

## Capabilities

### New Capabilities

- `product-file-visibility`: видимость файлов не-DESIGN изделий для цеха и монтажников только на чтение.

### Modified Capabilities

Нет.

## Impact

Сервер: server/access/visibility.ts fileVisibilityWhere (новая ветка для FIELD_ROLES рядом с productVisibilityWhere и комментарием про ненаследование File-доступа). Покрытие тем же fileVisibilityWhere без изменений呼び出し側: server/products/sketch-projection.ts, products/queries.ts и projects/queries.ts (эскиз и hasB3d), _count.files, tasks/queries.ts taskDetailsIncludeFor.files, /api/files/:id и server/files/actions.ts (чтение). НЕ меняются: upload-context.ts, delete-permission.ts, cover-core.ts, canEdit/canReplaceProductCover, maskProductionRead. Миграции и UI не меняются.
