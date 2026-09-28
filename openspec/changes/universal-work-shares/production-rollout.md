# Production rollout — отложен владельцем, только staging

Функциональный код `614ec23128de83f16833a56443354c2707e87c60` принят локально и на staging. Полный staging browser run: 12/12, native capture/cleanup/inspect — PASS; [evidence](evidence.md), [receipt](staging-acceptance.json). Последующие правки относятся к QA и документации; product/src и Prisma не меняются.

28.09.2026 владелец ответил на конкретное предложение production backup и выпуска через main: «Пока оставить только на staging». Решение принято: backup production, push в main и миграция production не выполняются. Автодеплой остаётся штатным; ограничение относится к продвижению этой фичи. Нижеследующий порядок сохранён для будущего явного решения владельца и сейчас не исполняется.

## Конкретная миграция

[20260928140000_universal_work_shares/migration.sql](../../../apps/web/prisma/migrations/20260928140000_universal_work_shares/migration.sql), SHA256 `65058910bdeec05482a9881c4f83a015cd1e86c32e0ffc352278ac3aa378f0a6`.

- Создаёт TaskAllocationGroup для исходного количества, бюджета, валюты и автора разделения.
- Добавляет Task.allocationGroupId/shareUnits/shareAmount с NULL для прежних задач и splitRevision с default0.
- Добавляет два индекса, проверки допустимых значений и связи с Work/Task.
- Все DDL внутри BEGIN/COMMIT. UPDATE/DELETE/backfill зарплаты, выплат, работ или старых задач отсутствуют. Seed/reset/новой БД нет.

## Действия после разрешения

1. На существующем production Docker/volume сверить identity и единственную ожидающую миграцию; создать приватный read-only pg_dump со snapshot/counts/hashes. Проверить bytes/SHA/TOC. Не выдавать TOC за проверенное восстановление; архив не восстанавливать и не публиковать.
2. Продвинуть принятый код и его QA-документацию в main. Существующий CI должен снова пройти; только зелёный job публикует образ, который подхватывает обычный watcher.
3. Штатный entrypoint применяет только указанную миграцию. Проверить deployed revision, healthy/HTTP200, прежние DB ID/start/volume и результат миграции. Проверки production только read-only, никаких QA-пользователей/проектов/работ/начислений.
4. При неожиданной миграции, identity mismatch или ошибке остановиться и сохранить evidence, без reset, автоматического restore и ручного пересчёта данных. После реального разделения нельзя возвращаться к старому коду, который не понимает группы долей.

Разрешение на production сейчас не выдано; повторный запрос не требуется до нового решения владельца. Прежний запрет на произвольные production SQL, тестовые записи и очистки сохраняется.
