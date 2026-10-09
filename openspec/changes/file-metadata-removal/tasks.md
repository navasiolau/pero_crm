# Tasks

## 1. Регрессии и модель

- [x] 1.1 Добавить регрессии sections/старых форм/replay и получить содержательный RED.
- [x] 1.2 Заменить File enum/поля и создать транзакционную migration; проверить Prisma validate/generate и mapping tests.

## 2. Загрузки и интерфейс

- [x] 2.1 Перевести upload route, ordinary/cover cores и клиенты на section с сохранением ACL/CAS/replay/batching; проверить targeted upload tests.
- [x] 2.2 Убрать категориальные формы/отображение и группировать документы по section без дублирования эскиза; проверить UI/grouping tests.
- [x] 2.3 Снять file-stages runtime registry/settings/dependency и обновить obsolete тестовые контракты; проверить registry/tsc/full tests.

## 3. Приёмка

- [x] 3.1 Подготовить и выполнить через root последовательную PostgreSQL rollback проверку DDL/mapping/File/FK/storage invariants на существующей разрешённой БД.
- [x] 3.2 Пройти локальные typecheck/test/build/OpenSpec validation, записать честные результаты в verification.md.
- [x] 3.3 Принят фактически развёрнутый staging37f882f: sections/uploads/replay/сохранность старого эскиза и ссылок; Parentff30 PASS/CLOSED с сохранением всех54 исходных таблиц, схемы, финансов, preferences и originalS3.
