# Design

## Context

Feature/20 создана оркестратором после fetch отfresh origin/staging7e0df2afd544e9e36cc029b4af760262b7db7b56. №19 локально завершён: full723, native43-table rollback, compiledbrowser60/actualzoom5; код committedf04e3c1 и ordinarymerged/pushed7e0, фактическая staging19 приёмка завершена на7e0: native6groups/43rollback, два UNMODIFIED APP nativeChromium прохода59checks без failures/pageErrors, zoom5 и CLEANED/RESTORED. Gate accepted19 выполнен, собственная integration/staging20 приёмка остаётся pending. Перед интеграцией сверить последующие принятые refs; main/prod исключены.

Исследовано: product page maps product.files в existing FilesTab на отдельной вкладке; FileRow уже содержит id/name/category/stage/mime/size/hasThumb/createdAt/uploader. Schema category MEASUREMENT и stages PRODUCTION/ASSEMBLY/INSTALLATION существуют. Uploader/FileGridView в projects/[id]/files-tab.tsx используют FormData /api/files/upload, FileViewer и confirm-delete. Upload route проверяет resolveUploadContext до storage, валидирует size/category/extensions и принимает явный stage даже при выключенном plugin; stage-config влияет на extensions, не на хранение enum. Original/preview GET и delete имеют existing ACL; noModel action/core уже существуют. Actual19 уже содержит normalizeProductDescription/raw exact CAS+description-only no-op, largeDescription scopedTextarea и сохранение controllers приRSC. Accepted18 file UI даёт flatProject mode, а FileViewer PDF ?view=1 наследует actualGET inlinePDF/nosniff с прежним ACL и attachment дляскачивания. Inline state/registered Flight transport №17/19 относится к scalar fields, не заменяет binary upload REST.

## Goals / Non-Goals

**Goals:** минимум reusable UI/mapping для трёх действующих blocks и самостоятельно проверяемый storage/ACL workflow.

**Non-Goals:** redesign всех product полей/tabs25, cover21, новые price/pay/percent rules, JSON/editors, File metadata/backfill/key migration, смена S3/preview infrastructure. Старую Files tab до25 не обязаны удалять; если она остаётся, использует те же IDs/data, не вторую базу.

## Decisions

### Минимальная mapping функция

Pure `productAttachmentGroups(files, coverFileId)` сначала отделяет category MEASUREMENT независимо от stage и cover selection; cover исключение применяется лишь к Production/Installation docs. Legacy measurement выбранный обложкой остаётся в measurement gallery без изменения указателя/метаданных. остальные stage PRODUCTION/ASSEMBLY объединяет Production, INSTALLATION — Installation. Не изменяет входные объекты/array, не пишет metadata. Возвращает existing typed FileRow по ID и сохраняет порядок текущего запроса. Новые measurement images отправляют category MEASUREMENT, docs stage PRODUCTION/INSTALLATION явно; categories используют existing Uploader selection/validation (B3D/DRAWING и DOCUMENT/PHOTO допустимы согласно текущим правилам), без догадок о старых metadata.

Альтернатива массовой переклассификации старых Assembly/Measurement файлов отвергнута: представление решает задачу без потери истории и keys.

### Scoped placement и контейнер

Measurement component помещается непосредственно после description area, включая null description. Документы — отдельный sibling после основного ProductCover layout, на всю рабочую ширину, а не внутри узкого details левого столбца. Это не окончательная перестановка всех fields25: имеющийся engineer control сохраняется, docs идут после main реквизитов.

Контейнер для attachments имеет inline-size query; grid minmax(0,1fr) две равные колонки только при container>=640px, иначе один столбец Production→Installation. Width/min-width0/max-width100, long-name wrapping и перенос actions, gallery внутри блока. Использовать существующие Card/buttons/thumbnail primitives без новой библиотеки/глобальной замены viewport CSS.

### Reuse файлового контура

Extract/export минимальные Uploader/FileGridView primitives из FilesTab либо общий file UI module; standalone ProductAttachments компоненты получают от серверной page ровно уже ACL-scoped product.files DTO. Measurement renders image thumbs+fullscreen и документные строки для старых nonimage. Existing PhotoUploadButton имеет task-only props, поэтому его visible dialog/drop-zone/camera/choose/paste pattern переиспользуется узко с настоящим productId/projectId; фиктивная Task ради measurement не создаётся. Production/Installation те же FileViewer/download/ConfirmDelete. PDF inline mode ?view1 и default download attachment наследуются из accepted18; не дублировать его route/security patch. Неподдерживаемый legacy MIME/file type сохраняет оригинальный download, не переписывается ради preview.

Uploads остаются FormData existing route с настоящим productId/projectId/category/stage; storage получает новый UUID key, не replace старого. Success row появляется только после подтверждения или server revalidation. Отказ оставляет confirmed rows и доступный retry; не выдавать исходный список за upload proof. Existing original/thumbnail/category/extension/source ACL остаются authoritative, client canEdit лишь representation. Никакой public presigned shortcut или storage endpoint без session.

### Scalar drafts и NoModel

Pending upload/delete/noModel отражается у блока. Повторная RSC после файлов сохраняет keyed product provider/controllers/raw drafts №19; при необходимости registerGuard связывает block pending с existing status flush, без удержания внешнего S3 запроса внутри DB lock. Scalar save transport не перезаписывается binary fetch. После подтверждённого B3D/NoModel updated eligibility отображается из authoritative current state; guard на сервере не выводится из наличия thumbnail/name в клиенте.

Перенести единственный visible «Модели нет» control из percentage panel в Production, вызвать existing setProductNoModelAction/Core, сохранить manager gate/no-op/audit/status guard. Не добавлять новый free generic boolean setter/новую percentage оплату; readonly роли не получают checkbox write. Duplicate control после переноса убрать, не удаляя остальные panels/tabs раньше25.

## Risks / Trade-offs

- [Measurement stageInstallation попал бы в wrong column] → category-first pure classification tests всех enum сочетаний.
- [Sidebar narrowing не совпадает с viewport] → container640 tests и screenshots при одном viewport/open/closedsidebar.
- [Legacy nonimage исчезает из фото галереи] → icon/download rows, byte/ID/key preservation cases.
- [Files refresh теряет rawdescription] → compiled slow scalar request+file upload/delete, provider persists draft/baseline; никакого fake saved state.
- [New UI расширяет upload/delete rights] → direct original/preview/stale engineer tests existing resolveUploadContext/fileVisibility, no storage before denied context.
- [Storage/database отказ оставляет orphan нового upload] → не удалять прежние keys; failure evidence выделяет только новый own request/key, cleanup только в разрешённом root QA контуре с exact IDs. Не превращать №20 в business cleanup.

## Migration Plan

Без миграции/переноса данных. Feature20 уже создана на fresh7e0 иlocalstart разрешён; integration20 только после actual accepted19 оркестратором; RED→GREEN mapping/roles/new real UI, local guarded existing-runtime/compiled browser/storage checks, owned fixtures+HMAC/CAS exact cleanup, no dump/reset/seed/restic. Одна атомарная задача20 commit, обычный merge staging, CI и actual SHA/image/health/gallery/ACL cases. Сохраняются night refresh/W07; main/prod не входят.

## Open Questions

Перед apply сверить final19 description component и final18 FileGridView/flatProject exports. Это уточнение reuse API/line numbers, scope и правила уже определены.

## Prestage Verification State

Read-only source/evidence verification: full local751/buildPASS/lint0errors1oldwarning, nativeFINAL5groups+5actualStatus cases/43tablesrollbackPASS. B3D native case — только DB metadata/status guard, не CAD/storage proof. Отдельный compiled functional run84checks/8realuploads/actualstorage hashes+exactkeys cleanup/prefsPASS/truezoom4 принят функционально; root personalvisual выявил titlecollapse1440/840. Minimal pageheader prerequisite изменён после этого run и rebuiltPASS, новый geometry/visual повтор pending. Task4.3 FINAL visual QA отложена по новому указанию; task4.4 относится к safety cleanup фактически выполненных smoke. Замечания MEASUREMENT-cover и visible photo modality исправлены в коде: category-first mapper и typed product/task PhotoUploadButton с реальным productId; RED1→GREEN mapper3/context2=5. Новый compiled gallery/9uploads и geometry/visual повтор ещё pending, поэтому исправления имеют статус FIXED CODE / RUNTIME PENDING. Gate19 выполнен фактической приёмкой7e0 двумя UNMODIFIED APP nativeChromium59checks/zeroerrors/zoom5/CLEANED/RESTORED; прежние React418 failures и modified-JS diagnostics сохранены как история, их точная причина не доказана. Main/prod исключены.

## Updated Acceptance Priority

Прямое новое указание владельца02.10 переносит all6sizes/pixel и полную visual/resize/zoom приёмку до завершения№20–26. Текущий perfeature gate — essential logic/build/functional smoke и actual staging image/health. Прежние visual failures и исправления сохранены как история; новый comprehensive geometry/pixel rerun не обязательная предпосылка интеграции20. Task4.3 остаётся unchecked DEFERRED FINAL QA; точные cleanup/prefs безопасности4.4 остаются необходимыми для реально выполненных smoke, не подменяются visual defer. №19 accepted7e, root QA/docs ordinarymerge7bcef04f28f1be2f6fb686e17cd6f3334960ddb0 имеет appsdiff7e→7bEMPTY; feature20 root ff до fresh7b с сохранением edits.

## Final Local Essential Smoke

Root final local smoke: `.playwright-mcp/modernization/local-attachments-smoke-20d78a58-13f3-471d-959e-5df2039608df` — PASS13checks/9files, VISUAL_DEFERRED, dataCLEANED/originalsMATCH/exactOWNkeysABSENT/prefsRESTORED. Оба прежних P2 теперь runtime подтверждены: MEASUREMENT-файл выбранный cover остаётся в галерее замеров; видимый photo dialog и DOM ClipboardEvent выполняют реальную загрузку. Это не доказательство работы OS clipboard. Title markup исправлен, comprehensive visual/pixel приёмка остаётся DEFERRED по прямому новому указанию владельца.

Root20-release buildPASS включая optional paste guard; full757PASS до добавления helper recovery tests. Existing native5groups/actualstatus5/43table rollbackPASS при неизменном domain source; более поздний fullsuite результат не выдумывается.

Старый recovery STOP2ce5 сохранён. По точному checkpoint/sourceSS после узкого MEASUREMENT guard fix завершена recovery только5ownfiles: CLEANED и prefsRESTORED; исходный STOP не стирается, это не dump/restore БД. Source verifier не выполнял runtime/storage/DB. Staging20 commit/merge/image/health/smoke пока pending, finalvisual4.3 unchecked.
