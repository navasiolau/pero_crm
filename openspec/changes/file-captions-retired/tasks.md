# Tasks

## 1. Contract и RED

- [x] 1.1 Проверить все caption references/uploader consumers и создать OpenSpec4/4 strict valid.
- [x] 1.2 Зафиксировать RED: API caption blank/nonblank/cover payload отклонён до bytes/storage/DB; historic display использует fileName.

## 2. Implementation

- [x] 2.1 Удалить file caption input/state/payload/display/mappings из общих surfaces; source/renderer checks подтверждают caption-free FileGrid и upload components.
- [x] 2.2 Закрыть caption в upload route/cover core DTO/writer; focused tests GREEN без изменения исторической строки/schema.

## 3. Verification

- [x] 3.1 Выполнить targeted regression/typecheck/scoped lint; записать фактические результаты без runtime claims.
- [ ] 3.2 Root выполнить обычный merge34 и совокупную runtime/visual33–38 на фактически развёрнутой ревизии; production исключён.
