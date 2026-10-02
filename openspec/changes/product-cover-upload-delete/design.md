# Design

## Context

Первоначальная provisional planning7b заменена реальной feature/21 baseeaa6d077631f8130542de61374657b1e9ec2992d после root fresh fetch. №20 committed06d706a/ordinarymergedeaa и локально завершён13smoke/9files/native5groups+status5/43rollback; текущая база содержит accepted-local20 typed PhotoUploadButton/mapper/file primitives. Локальная реализация21 разрешена, интеграция21 ждёт actual20 staging image/health/smoke. Прямое новое указание владельца откладывает all6sizes/pixel QA до завершения20–26.

Существуют Product.sketchFileId и File; product-hero-image.tsx использует product-hero preview helper. server/products/cover-core.ts authorizeProductCoverUpload/persistUploadedProductCover/setProductCoverCore проверяют реальные project/product и MIME; upload route assignCover=1 выполняет права до bytes/storage и повторно при сохранении, транзакционно пишет file/pointer/audit. persistUploadedProductCover сейчас допускает замену непустого указателя: для нового цикла это конкретный stale-state seam. files/actions.ts deleteFile проверяет fileVisibility, uploader или MANAGER_ROLES, инженерный current context; storage cleanup best-effort, audit сейчас после удаления. cover-actions.ts/revalidateProductPaths обновляют существующие consumers. Новый20 PhotoUploadButton имеет task/product typed target и видимый dialog/dropzone/CtrlV; использовать актуальную принятую версию после refresh, не копировать ветку20.

## Goals / Non-Goals

**Goals:** одно локальное управление эскизом, безопасный цикл через существующие файловые primitives и серверные ACL.

**Non-Goals:** итоговая компоновка25, стоимость/initial26/начисления, metadata/schema migration, новый storage backend, общая переработка удаления всех файлов, CAD/PDF extraction.

## Decisions

1. Отдельный scoped cover component в существующем card slot; одна размерная оболочка для обоих состояний, object-contain preview. Desktop сохраняет правый slot, mobile после контактов; окончательные пропорции/style25 позже. Изображение само открывает FileViewer; ConfirmDeleteDialog для X. После загрузки удалить текущую gallery-picker/pencil/expand UI, не удаляя совместимый серверный setProductCover API без необходимости.
2. Загрузка через existing visible PhotoUploadButton или узкий reuse его pattern, настоящий productId/projectId и assignCover=1. Не применять generic task-ID surrogate. Непустой sketchFileId в cover-upload authoritative tx — конфликт; CAS пустого указателя под existing shared transaction lock. Generic вложения и старый setProductCover сохраняют свои контракты. При DB отказе существующая компенсация route должна удалить только собственные newly-uploaded keys; чужой cover остаётся нетронут.
3. Узкий cover-delete adapter/core принимает productId+expectedFileId из подтверждения, повторяет visibility/currenttechnical и существующее file-delete право, проверяет текущий pointer и принадлежность exact файла под lock. Устаревшее подтверждение не превращать в удаление актуального файла. File/pointer/audit atomic в scoped transaction; storage cleanup после commit только exact keys, существующий best-effort не объявляется строгим доказательством физического удаления. Generic deleteFile semantics и другие callers не расширять.
4. Existing typed server ACK управляет UI. Пока операция pending, повторные действия отключены, status flush/barrier учитывает file operation; не терять keyed description/inline controllers при файловом refresh. Failed upload/delete показывает ошибку без optimistic смены pointer. Cancel не отправляет delete. Table/kanban invalidation через existing revalidateProductPaths после успешного commit; scalar field transport остаётся компактным.
5. Management и unionroles сохраняются; pureEngineer technical permission только текущего назначенного DESIGN. Read-only preview разрешён по existing file ACL; direct URL ACL до storage. Existing uploader/delete право может запрещать инженеру удалять чужой legacy cover: кнопка/ошибка должны соответствовать серверу, нового права нет.
6. Сохранять legacy selected image irrespective category; measurement-first №20 остаётся. Новые cover uploads categoryPHOTO по текущему backend. Не переносить старые файлы, не менять stage/category/storedName, не создавать второй sketch источник.

## Risks / Trade-offs

- [Storage и DB не единая транзакция] → retain existing scoped upload compensation / best-effort deletion, точные own keys, не обещать distributed atomicity.
- [Lost ACK / parallel uploads] → re-read authoritative pointer/conflict; не автоматическая замена или повторное удаление нового файла.
- [Visual QA deferred] → basic functional smoke сейчас; отдельный unchecked FINAL QA после26, никакого pixel-ready заявления.

## Migration Plan

Без DB миграции. Root уже создал feature/21 от fresh stagingeaa после completed20 local code/checks; essential local checks, атомарный commit, ordinary merge только после basic accepted20, actual21 image/health/smoke. Main/prod исключены. Restic/dumps/newDB/reset/seed запрещены; guard mismatch STOP. Finalvisual всех6sizes/resize/zoom/pixel после20–26 остаётся отдельным pending acceptance.
