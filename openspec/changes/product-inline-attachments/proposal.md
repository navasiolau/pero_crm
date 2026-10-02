# Proposal

## Why

Замеры и документы изделия находятся в общей файловой вкладке и не следуют рабочему порядку карточки. №20 создаёт самостоятельные реальные inline-блоки поверх существующих файловых операций, сохраняя старые вложения и права.

## What Changes

- Галерея «Замер» непосредственно под technical description: фото upload, thumbnails/fullscreen, существующие не-image замерные файлы остаются доступными для просмотра/скачивания.
- Полноширинные «Производство»/«Монтаж» после основных реквизитов: две равные колонки при рабочей ширине >=640px, иначе два последовательных полноширинных блока. Не помещать в узкую левую колонку у эскиза.
- Mapping только представления: MEASUREMENT первым независимо от old stage; остальные PRODUCTION/ASSEMBLY → «Производство», INSTALLATION → «Монтаж». ID/category/stage/storage keys/привязки существующих файлов не переписываются.
- Реальные upload/view/download/подтверждаемое delete по existing ACL; ошибки не показывают неподтверждённый файл и не теряют описание/черновики. Менеджерская «Модели нет» в Production reuse existing action/guards, B3D правило инженера сохраняется.

## Capabilities

### New Capabilities

- `product-inline-attachments`: независимые замеры и адаптивные документы изделия на существующем файловом контуре.

### Modified Capabilities

Нет; existing engineer/file access ограничения сохраняются.

## Impact

Product page/inline fields placement, небольшой ProductAttachments component и mapping helper, переиспользуемые FileGridView/Uploader/FileViewer/ConfirmDelete из file UI. Existing upload/download/preview/delete/stage-config и setProductNoModelCore не заменяются новой системой. Без dependencies/schema/data migration.

Вне №20: final single-page layout/removal всех tabs №25, cover21, новое percentage/pay/shares22–24, initialPrice26, PDF extraction/FX/переименование media или storage cleanup. Existing Files tab может сохраняться до25, обращаясь к тем же IDs, без второго data source/новых копий.

Feature/20 создана оркестратором отfreshorigin/staging7e0df2afd544e9e36cc029b4af760262b7db7b56 послеfetch. №19 локально завершён/committedf04e3c1/ordinarymerged7e0; Actual staging19 принят на7e0: два UNMODIFIED APP nativeChromium прохода59checks без failures/pageErrors, zoom5, CLEANED/RESTORED. Gate accepted19 выполнен; собственная staging20 приёмка остаётся pending. Владелец делегировал работу до tested staging, main/prod исключены.
