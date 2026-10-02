# Proposal

## Why

Пустой эскиз должен принимать изображение выбором или drag/drop, а диалог и кнопки должны быть понятными. Владелец сообщил об отказе загрузки; требуется проверить настоящий request/ACK path, сохраняя original bytes и защиту текущего файла.

## What Changes

- Пустая область эскиза целиком доступна для выбора изображения и drag/drop; крупная чёрная кнопка с белым текстом открывает sketch dialog.
- В sketch dialog убрать описательную фразу и «Снять фото»; общие task/measurement photo controls сохраняются.
- Красная корзина вместо X; эскиз не follows-scroll: удалить только sticky/top.
- Проверить flush/null/read-only baselines, original File multipart и ACK/error handling; backend менять только при доказанном дефекте, без MIME/defaults догадок.

## Capabilities

### New Capabilities

- `product-sketch-upload-interaction`: доступная загрузка эскиза через всю пустую область и подтверждённые transitions без потери файла.

### Modified Capabilities

Нет изменений прав, MIME/CAS/file storage контрактов.

## Impact

Product sketch layout/wrapper, sketch-contextual PhotoUploadButton props и scoped tests/helpers. Preview engine44/global dialog45/header quantity41 не затрагиваются. Root выполняет actual runtime reproduction.
