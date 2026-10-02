# Design

## Context

Единственный общий caption writer найден в upload route; Project FilesTab хранит caption state/input/FormData и использует caption вместо fileName. Product/project pages проецируют caption в этот общий FileGrid. PhotoUploadButton и прочие task/communication uploader/viewer поверхности уже не используют caption. Cover upload core принимает optional caption и сохраняет его.

## Goals / Non-Goals

**Goals:** единое прекращение новых caption writes и отображения во всех общих файловых surfaces.

**Non-Goals:** изменение File schema/исторических данных, комментариев и описаний сущностей, FileViewer interaction/zoom/fullscreen, NoModel и layout соседних задач33/35/37.

## Decisions

1. Удалить caption state/input/FormData и page mapping/consumer поле; изображения/строки показывают fileName. Общие FileGrid consumers получают изменение без копирования UI. Альтернатива скрыть input оставляет старые captions в display и не закрывает writes.
2. Проверять наличие multipart caption через get()!==null до чтения bytes/context/storage. Любое значение запрещено, а не молча игнорируется; это закрывает stale формы. Cover core удаляет поле из DTO/writer и отклоняет runtime extra caption.
3. Не менять Prisma schema/историю и не выполнять backfill. Старые данные остаются доступными через существующие исторические записи, отдельный UI-подпись файла отсутствует.

## Risks / Trade-offs

- [Общие поверхности] → инвентаризировать все FileGrid/uploader consumers и проверить caption-free payload/display.
- [Пересечение соседних веток] → ProductPage менять только file caption mapping, FileViewer/NoModel interaction не редактировать.

## Migration Plan

Миграция отсутствует. Root выполняет обычный GitFlow merge и runtime/visual после33–38; агент выполняет focused RED→GREEN/typecheck/lint без DB/runtime.
