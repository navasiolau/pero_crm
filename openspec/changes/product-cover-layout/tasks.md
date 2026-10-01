# Tasks

## 1. RED tests first

- [x] 1.1 Добавить RED UI/helper tests для desktop/mobile раскладки при 1024 px, отсутствия пустой широкой колонки без cover, ролевого набора иконок, `card/cover/original` source selection, fullscreen variant и неизменённого обычного FileViewer; только in-memory данные.
- [x] 1.2 Добавить UI/helper tests для допустимого набора уже прикреплённых изображений, успешного/ошибочного выбора без потери старой обложки, refresh только после успешного ответа, скрытых filename/captions и сохранения существующего File record.
- [x] 1.3 Sol добавляет RED API tests для `card/cover` WebP размеров/типов, ограниченного cache и singleflight, ACL-проверки до cache и conditional `304`, а также ошибки preview без возврата original; БД/QA fixtures не использовать. Backend test suite PASS 14/14 по сообщению Sol; root независимо повторил 14/14. Local native дополнительно подтвердил: manager получает пустой `304` для `If-None-Match`, worker на тёплом cache получает `404` без ETag.

## 2. Product detail layout

- [x] 2.1 Перестроить detail area в desktop 60/40 с существующим cover справа, выровненным по title row, viewport-derived высотой и компактной строкой заголовка; mobile title → optional cover → info order; без cover оставить info full-width. Helper/SSR tests проверяют размещение, пустое описание и отсутствие пустой колонки.
- [x] 2.2 Добавить image overlay только из fullscreen и разрешённого replace icon; при отсутствии cover оставить replace icon у header. Убрать видимые filename/label/open-original controls, сохранить aria labels и icon-only error state; tests проверяют visible DOM.

## 3. Preview и полноэкранный просмотр

- [x] 3.1 Переключить UI на защищённые `?preview=card|cover` source; board/picker изображения загружать lazy/async, cover — eager/high-priority, fullscreen — original; tests проверяют source selection, fallback и отсутствие original при preview failure.
- [x] 3.2 Добавить opt-in cover-fullscreen вариант FileViewer с viewport `object-contain`, без filename bar, закрытием по Esc/close; regression tests подтверждают, что обычный viewer остальных consumers не меняется.
- [x] 3.3 Sol реализует защищённый bounded-memory LRU/singleflight preview pipeline: card ≤480×480, cover ≤1280×1600 WebP; проверять file/product ACL на каждом запросе, в том числе до cache/304, и возвращать error вместо original fallback. RED→GREEN tests 14/14 подтверждены Sol и независимо root; native preview byte-size/ETag ACL сценарии выполнены только на существующих файлах.

## 4. Замена обложки

- [x] 4.1 Реализовать в UI picker с только image Files, прикреплёнными к этому изделию; management может менять cover доступных изделий, ENGINEER — только по существующей technical-edit permission на своём/участвуемом DESIGN. Offline role tests покрывают union и запрет pure ACCOUNTANT/WORKER/MOUNTER.
- [x] 4.2 Подключить существующий-file выбор к `setProductCover(productId, fileId)`, новый upload — к POST `/api/files/upload` с `assignCover=1`, PHOTO, projectId/productId и без taskId; UI меняет превью только после ok, cancel/error сохраняет старую обложку и обновляет server data после успеха. Проверка in-memory, без живой записи.
- [x] 4.3 Sol реализует серверный setter и upload assignment: предварительная image/MIME/visibility/ownership проверка, один атомарный File+cover pointer+audit commit, idempotent same-file, old blob/File сохранены, error без status/history/финансовой записи. При неизвестном commit outcome не удалять storage keys автоматически. Backend tests 14/14 PASS по сообщению Sol и независимому повтору root. Native picker проверялся только open/cancel; setter, upload и cover replacement не отправлялись.

## 5. Приёмка без QA records

- [x] 5.1 После согласования source freeze запустить focused/full offline tests, tsc, lint, production build и strict OpenSpec validation; сохранить команды и результаты. Итог после mobile fullscreen исправления: web test suite 525/525; focused cover/hero tests 20/20; tsc после build PASS; lint 0 errors (одно существующее предупреждение `existsSync` в `scripts/cleanup-uploads.ts`); production build PASS; `openspec validate product-cover-layout --strict` PASS.
- [x] 5.2 Root выполнил local CUA по уже существующим файлам на 1920×1080, 1440×900, 390×844 и 360×800: 60/40 desktop, cover справа 630×952 с верхом y=80 у title, coverless info 100% и только add icon, cover без description сохраняется большим; landscape/portrait contain, fullscreen занимает viewport после mobile fix. Cover имеет только две иконки; card/cover preview используются вместо оригинала вне fullscreen. ENGINEER на своём DESIGN видит edit/picker и может открыть/cancel; чистые WORKER/MOUNTER для DESIGN получают 404. Native preview: cover 62,490 B при 674×978 против original 773,326 B; card 23,448 B при 331×480; role-sensitive conditional-cache checks: manager `304` пустой ответ, worker с тем же тёплым ETag — `404` без ETag. Не выбирали/не загружали файлы, не меняли cover/status/payroll и не создавали QA rows/files. В ходе обычной навигации создалась одна existing `products.list` preference (`4→5`); root восстановил ровно прежнее значение (`5→4`) через CAS. Финальный local preservation receipt: schema/ledger, 42 таблицы и 4,726 upload baseline совпали, `changedTables=[]`. Live cover assignment/upload не проверены.
- [x] 5.3 Staging CUA и qualified read-only preservation review завершены root; evidence записан в `acceptance.md` и безопасный allowlisted receipt сохранён в `deploy/evidence/product-cover-layout-staging-20261001.json`. Исключение зафиксировано: у одной существующей `ApiToken` монотонно изменился только `lastUsedAt`; остальные поля и проверенные ID совпали. Остальные 41 бизнес-таблица, schema/ledger и metadata 4,738 S3 versions совпадают. QA rows/images/files не создавались, picker/upload/cover action и status/rate/share/payroll мутации не отправлялись. Live cover replacement/upload остаются непроверенными.
