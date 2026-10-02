# Tasks

## 1. Реализация

- [x] 1.1 RED: meaningful тесты anchored zoom/fit/clamp/pinch/reset и центрального image dispatch при сохранении PDF/video/download.
- [x] 1.2 Единый полноэкранный FileViewer изображений с прежним cover marker, защищёнными оригиналами, крестиком/Escape и Base UI modality; dispatch и lifecycle tests проходят.
- [x] 1.3 Добавить локальные wheel/doubleclick/buttons/drag/pinch, fit initial, лимиты/keyboard, сброс при смене файла/контекста и cleanup listeners; чистая математика/gesture tests проходят.

## 2. Проверки

- [x] 2.1 Focused GREEN, typecheck и lint; OpenSpec validate. Итог: 29/29 image transform/dispatch/cover/hero tests, TypeScript PASS, ESLint 0 errors/0 warnings; strict OpenSpec VALID.
- [x] 2.2 Root после интеграции №33–38 подтвердил actualwheel/drag/X fullscreenzoom иmobilelayout всех6размеров наstaging495. Pinchimplemented/gesturemathunitPASS; physicaltwofinger runtime не требование владельца и не заявляется. Bodylock/focus/Escape совместимость сохранена/covered существующими tests; exactreceipt inevidence.
