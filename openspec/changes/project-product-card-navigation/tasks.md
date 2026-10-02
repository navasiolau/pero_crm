# Tasks

## 1. Implementation

- [x] 1.1 Focused RED: policy callbacks/default fullscreen, SSR navigation/drag and isolated number styles.
- [x] 1.2 Контекстная cover policy в shared card и Projects ProductsTab; существующий onOpen/drag остаётся прежним, тесты GREEN.
- [x] 1.3 Только number typography для kanban/recent/mobile card spans; labels/title не растут, targeted SSR tests GREEN.

## 2. Verification

- [x] 2.1 Focused/type/lint PASS и strict OpenSpec validate; источник заморожен для root. 13/13 targeted tests, TypeScript PASS, lint 0 errors/0 warnings.
- [ ] 2.2 Root выполняет общий actual browser/staging точной ревизии после интеграции round2; pixel/runtime не проверялись субагентом.
