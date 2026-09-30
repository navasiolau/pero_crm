# Tasks

## 1. Protected sketch metadata

- [x] 1.1 Добавить минимальную проекцию `SketchFile` DTO (`id`, `fileName`, `mimeType`, `hasThumb`) для карточки изделия, списка изделий и изделий внутри карточки проекта; каждую выборку ограничить `fileVisibilityWhere(actor)` и тестом подтвердить доступные метаданные и отсутствие скрытых эскизов.
- [x] 1.2 Передать минимальный DTO в обе клиентские kanban-доски без других полей `File`; проверить типы и тесты для `/products` и вкладки `ProductsTab` проекта.

## 2. Product detail hero

- [x] 2.1 Заменить preview 128×96 и отдельную карточку описания одним адаптивным блоком: от 1024 px — равные колонки, описание слева и изображение справа; уже — изображение сверху на всю ширину. Проверить раскладку helper/component-тестами.
- [x] 2.2 Использовать миниатюру через защищённый маршрут только в kanban-preview, а в карточке и FileViewer — защищённый оригинал с `object-contain`; описание без изображения должно занимать всю ширину, ошибка загрузки показывать понятную заглушку. Тестами проверить адрес preview и смену состояния при ошибке.

## 3. Shared kanban card

- [x] 3.1 Создать одну общую карточку изделия для kanban изделий, вкладки изделий проекта и обоих DragOverlay; сохранить подписи, цену с прежним ролевым ограничением, открытие по клику и отдельную ручку перетаскивания. Проверить helper/component-тестами.
- [x] 3.2 Измерять фактическую высоту информационного блока и задавать изображению удвоенную высоту; абсолютное изображение с `object-contain` не должно влиять на intrinsic height. Тестами проверить короткий и длинный текст, отсутствие файла и ошибку загрузки.

## 4. Acceptance

- [x] 4.1 Запустить целевые регрессионные тесты, полный набор тестов приложения, lint и production build; записать фактически выполненные команды и результаты.
- [x] 4.2 Root выполнил CUA-приёмку на существующих изображениях при 360×800, 390×844 и 1440×900: desktop/mobile layout, обе доски и overlays, 2:1 высота, contain без обрезки, длинный текст, no-image и load-error fallback прошли без переполнения и status/rate/share writes. Созданная навигацией `me094/products.list` preference восстановлена утверждённым одноразовым CAS v2; full DB/schema/4726-upload baseline вернулся с `changedTables=[]`. Evidence зафиксированы в `verification.md`; новых изображений/QA-записей не создавали.
- [x] 4.3 Завершить read-only staging hero acceptance на здоровом image: detail, обе kanban-доски, overlays, пропорции и error fallback проверены; новых fixtures и financial/status/rate/share writes не было. Квалифицированный preservation receipt подтверждает schema, 41 non-ApiToken business tables, ledger и 4,738 S3 metadata rows exact; отдельно указан нормальный `ApiToken.lastUsedAt` SourceToken stamp и CAS-восстановление исходного `UserPreference`. Не трактовать это как byte-identical всех DB rows после обычного использования token; live earning не проверялся. Доказательства в `verification.md`.
