# Proposal

## Why

Подписи файлов больше не нужны в рабочих интерфейсах CRM. Новая и устаревшая форма загрузки не должна создавать новые значения File.caption; исторические данные сохраняются.

## What Changes

- Убрать поле подписи, отправку caption и отображение исторических подписей во всех файловых поверхностях; отображать имя файла.
- **BREAKING**: upload API явно отклоняет multipart caption, включая пустое значение, до чтения bytes и записи storage/БД.
- Сохранить File.caption в схеме/старых строках и read-only истории; ACL, MIME, stages, IDs, keys и действия FileViewer остаются прежними.

## Capabilities

### New Capabilities

- `file-captions-retired`: подписи файлов скрыты в UI и закрыты для новых upload writes.

### Modified Capabilities

Нет.

## Impact

Project FilesTab, общие uploader/FileGrid consumers, product/project page mapping, upload route и cover upload input. Без миграций, зависимостей, изменений комментариев/описаний иных сущностей или interaction FileViewer.
