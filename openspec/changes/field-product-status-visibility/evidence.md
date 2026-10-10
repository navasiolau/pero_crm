# Локальная проверка №119

Дата: 10.10.2026. Ветка `feature/119`, исходный staging `ab1c77f3`.

## Выполнено

- Целевой `tests/field-product-status-visibility.test.ts` дал RED на реальной функции `listProducts` с in-memory relational adapter: WORKER получал PRODUCTION/STORAGE/INSTALLATION/DONE/RECLAMATION вместо PRODUCTION/STORAGE.
- После изменения общей матрицы тот же сценарий дал GREEN: 1 тест, 1 успешно. Включены WORKER/MOUNTER/обе роли, assigned/task/assembler/mounter/participant shortcuts, текущий статус, запрещённый status/ID, вложенные изделия и их счётчик, options, Work, оригинал и thumbnail закрытого файла. HTTP route вызывается напрямую; до storage закрытый файл не доходит.
- Обновлены прежние конкретные CI-ожидания широкого производственного grant. Существующий workflow не изменён.
- `git diff --check` прошёл. Prisma Client сгенерирован локально; миграций и обращения к БД этим действием нет.

## Оставшиеся этапы

- Подготовлен `tests/field-product-status-visibility-native.ts`: один READ ONLY сценарий существующей local CRM, guard контейнера/порта/имени БД, три policy profiles с существующим user ID без изменения его ролей. Проверяет native SQL матрицы, Task/Work/File shortcuts и прямой Worker → INSTALLATION. Запуск и результат пока не зафиксированы.
- Native/stale Work mutation проверка координируется с задачей №120. Личные зарплатные запросы не менялись; подтверждение исторических строк остаётся приёмкой.
- Typecheck/lint/build и полный обязательный suite выполняются существующим CI после разрешённой интеграции. Повторный полный ручной suite не запускался.
- Коммит/push/merge и фактическая staging-приёмка ещё не выполнялись этим агентом; ими управляет оркестратор.

Дампы, seed/reset, restic, production и инфраструктура не затрагивались.
