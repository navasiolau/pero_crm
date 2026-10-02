# Proposal

## Why

Задача №21 реализует §3.2 плана: постоянная область эскиза заменяет выбор обложки из галереи простым циклом загрузка → просмотр → подтверждаемое удаление. Существующие storage/preview/ACL и sketchFileId позволяют сделать это независимо от итоговой компоновки №25.

## What Changes

- Одинаковая область в пустом и заполненном состоянии; «Добавьте эскиз» и «Добавить изображение» до загрузки.
- Реальная загрузка изображения, fullscreen по нажатию изображения, единственный крестик удаления с подтверждением; убрать галерею, карандаш и отдельную кнопку увеличения.
- Подтверждённые server state/error/ACL и exact-file delete сохраняют другие вложения и raw inline drafts.
- Минимальные самостоятельные logic/build/smoke/staging-image-health проверки сейчас; полная визуальная приёмка всех шести размеров и pixel проверка отложены до завершения №20–26 прямым указанием владельца.

## Capabilities

### New Capabilities

- `product-cover-upload-delete`: цикл эскиза с сохранением существующих прав и файлов.

### Modified Capabilities

Нет: существующие engineer-product-access и mobile-crm-usability используются как ограничения; права не расширяются. Срок финальной визуальной QA изменён прямым указанием владельца, её выполнение не заявляется.

## Impact

Product card cover UI, существующие product-hero-image/product-cover helpers, server/products/cover-core и cover-actions, api/files/upload, server/files/actions, FileViewer/ConfirmDelete. Нет schema/dependencies/финансовых изменений или миграции старых файлов.

## Non-goals

№22–26, итоговый single-page layout, CAD/PDF extraction, переименование категорий/keys, automatic storage cleanup и production исключены.

## Delivery Context

Первоначальная planning-only база7b обновлена: root после fresh fetch создал feature/21 от origin/stagingeaa6d077631f8130542de61374657b1e9ec2992d. №20 committed06d706a и ordinarymerged/pushedeaa; local13smoke/9files, native5groups+status5/43rollback завершены, actualstage20 image/health/smoke pending. Локальная21 разрешена; интеграция21 требует basic actualstaging20 acceptance. TypedPhotoUploadButton/mapper/currentfile primitives №20 теперь доступны в свежей базе без копирования source. Владелец делегировал план через staging, main/prod исключены.
