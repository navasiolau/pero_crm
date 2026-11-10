# Проверка №213 — 10.11.2026

- Владелец поручил после production-выпуска №212 заняться подготовленным механизмом уборки. №212 выпущен штатно на `efe1607f`; реализация №213 начинается после подтверждения production health.
- План «текущая + две предыдущие успешные версии», защита всех ссылок контейнеров и запас 3 GiB до pull принят как рабочая область.
- Дополнительное прямое ограничение: стандартный production CI, команда запуска web и предусмотренные им миграции не меняются. Уборка относится только к подтверждённым старым Docker-образам; БД, контейнер/том БД, S3, restic и пользовательские данные не меняются.
- Ветка `feature/213` создана от свежего origin/staging `efe1607ffa14384d07ea8638222c6eee3d66dfda`. Применяется существующий контур watcher/W07; новый cron не нужен.

## Выполненные проверки

- RED: прежний watcher начинал pull при нехватке места и не выполнял housekeeping в unchanged-проходе; новые поведенческие тесты упали до реализации.
- Локальный deploy suite: **83 случая, 81 PASS / 2 Linux-only SKIP** на Windows. Linux process-group проверки остаются в CI. Подтверждены обе схемы web/paired, ограниченный проход и продолжение, pre-pull отказ при нехватке места, dry-run без мутаций, stopped-container references, immutable refs в RepoTags и сохранение штатной команды с мигратором. `py_compile`, OpenSpec strict и `git diff --check` PASS.
- Настоящий staging dry-run: текущий `efe1607f` и предыдущие `f5c0cdb1` / `38899d64` защищены, найдено 173 кандидата и 41 защищённый image ID; 4 контейнера, их образы/тома/StartedAt совпали до/после. Свободно 1 895 694 336 bytes, меньше выбранного pre-pull порога 3 GiB.
- Dry-run исполнял только metadata/space операции, без pull/up/rm, SQL и записи журнала. Evidence: `.playwright-mcp/retention213/preview.json`, `preview-reviewed.py`; baseline-кандидат SHA `7e1afb933fd216c26e0a00bf0a596a0601191d543e2c960d89ffb6dfc1be1671`.

## Фактическая приёмка

Автоматический helper установлен и проверен на staging, включая штатный проход cron/W07: 32 старых образа удалены без изменения БД. Полные CI, SHA, metadata и ограничения — в [staging-acceptance.md](staging-acceptance.md).

Production №212 продолжает работать штатно. Для №213 на production выполнен только read-only dry-run; сам helper не установлен, отдельное решение владельца запрошено. CI, startup command, миграции и файлы production не менялись.
