# Proposal
## Why
Изображения в списках занимают большие галереи или загружают старые thumbnails; детали требуют более качественного preview без загрузки оригинала до просмотра.
## What Changes
- Защищённый bounded thumbnail160 для маленького изображения справа от подписи файла.
- Детальный cover preview сохраняет большой размер с качеством90; card остаётся меньше.
- Оригинал не изменяется и загружается только при просмотре/явном скачивании.
## Capabilities
### New Capabilities
- `responsive-file-image-thumbnails`: компактные previews файлов с защищённым просмотром оригинала.
### Modified Capabilities
Нет.
## Impact
Существующие image-preview и file GET, shared FileGridView и Task attachments. Без upload/storage изменений, миграций и зависимостей; навигация kanban39 не меняется.
