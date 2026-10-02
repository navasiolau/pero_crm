# Design
## Context
Один сервис преобразует read-only original в card480/cover1280x1600, с ACL перед cache, limiter/singleflight/LRU/ETag/private cache. FileGridView используется Project/Product; task-dialog имеет отдельный список.
## Goals / Non-Goals
Миниатюры160 справа от filename/category, детальная cover quality90; отсутствие browser original fallback. Upload/original bytes, PDF/video/download и ACL остаются прежними.
## Decisions
Добавить thumbnail в существующий сервис. Cover90, card78, thumbnail85; withoutEnlargement/fitinside сохраняют пропорции. Общая компонента использует только preview URL и реальный FileViewer по клику, не старый hasThumb. Все FileGridView изображения показывать обычными строками с подписью и thumbnail справа; Task список аналогично. Не менять39 coverAction/43 upload.
## Risks / Trade-offs
Ошибка preview → явная иконка без скачивания original. WebP остаётся сжатым preview, субъективное качество подтверждается Root визуально; не выдавать unit tests за отсутствие визуальных потерь. Bounds/ACL/cache остаются прежними для всех вариантов.
## Migration Plan
Без миграций, Root local build и actual staging; оригинальные storage keys не изменяются.
