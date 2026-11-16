# Tasks

## 1. Покрытие и RED

- [x] 1.1 Зафиксировать матрицу reachable operations и RED tests новых callback/core paths; проверить конкретные пропуски.

## 2. Реализация

- [x] 2.1 Users/counterparties: полные snapshots и одна транзакция; tests проверяют поля, no-op и rollback при отказе аудита.
- [x] 2.2 Auth events: успешный login/logout, dedupe, отсутствие refresh/секретов; actual core signOut очищает cookie при audit failure.
- [x] 2.3 Telegram web/API/register: текущие guards, полный безопасный audit и no-op/retry; core/route tests проходят.
- [x] 2.4 Plugins/API tokens/notification preferences: полные snapshots и atomic writes; tests проверяют safe data и исключения.

## 3. Приёмка

- [x] 3.1 Добавить bounded rollback-only native helper для root, пройти целевые тесты/typecheck/lint/OpenSpec; evidence содержит точные результаты.
- [x] 3.2 Root принимает actual staging SHA/image/health и сценарии после обычного merge/CI; evidence фиксирует native/browser proof.
