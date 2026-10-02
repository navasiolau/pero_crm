# Proposal

## Why

Описание изделия уже текстовое, но клиент и сервер выполняют trim, теряя ведущие отступы и завершающие переводы строк. №19 делает существующее поле заметно большим и сохраняет непустой текст точно, оставляя надёжный inline/CAS механизм №17.

## What Changes

- Обычная большая Textarea, начальная высота около 20rem, изменение только по вертикали внутри доступной ширины; null/пустое поле всегда видно.
- Для description отдельная канонизация: непустой непробельный текст сохраняется как получен, включая пробелы/табуляции/пустые строки/завершающие переводы; только полностью whitespace/пустое значение превращается в null.
- Единые правила создания, inline и legacy update; expectedValue/CAS сохраняет точный raw baseline. Неизменённое описание не отправляется и не нормализуется от просмотра/focus/blur.
- Enter вставляет перевод строки; blur/Ctrl+Enter сохраняют, Tab перемещает фокус. Сохраняются role/DESIGN guards, retry/conflict drafts и compact Server Action без полной карточки.

## Capabilities

### New Capabilities

- `product-description-textarea`: простое большое описание и точное сохранение текстового содержания.

### Modified Capabilities

Нет; описательный serializer №17 уточняется без изменения общей очереди, прав и денежного поведения.

## Impact

ProductInlineProvider.parse, scoped InlineTextField/Textarea presentation, Product.description create/patch/legacy core и add-product consumer; small pure description helper и targeted tests. Только существующий Product.description String?, без JSON, editor library или миграции.

Вне объёма: итоговый layout №25, файлы/эскиз №20–21, зарплата/проценты/initialPrice №22–26, проектные поля/FX, production/main. Feature/19 начата отfresh24bdc21494a57877b23f64c803152b619146b360 и обновлена оркестратором ff-only до f2f529137ce8a799a7c554941591b0ed6851a1d6 с сохранением19правок. №18 принят на24bd, app diff доf2 пуст; local19 и actualstaging19 приняты на7e0df2afd544e9e36cc029b4af760262b7db7b56; nativeChromium unmodifiedapp receipts/evidence отдельно от diagnostics. Делегированное разрешение до tested staging сохраняется, main/prod исключены.
