# Verification

## Локальная реализация

- Branch feature/113 от origin/staging 20a049b2; isolated worktree crm-task-113/pero_crm_v2. Коммиты, push и merge не выполнены.
- RED: новые regression contracts дали 5 содержательных ошибок из 6 до implementation (неизвестный section, старые поля принимались, grouping терял sections).
- GREEN: полный существующий suite 1373/1373; targeted upload/ACL/CAS/replay/context 47/47. Добавлена реальная route-регрессия конфликта section при одинаковых bytes/clientMutationId, без второй storage записи.
- TypeScript noEmit, Prisma generate/validate, strict OpenSpec и git diff --check прошли. Prisma validate использует inert dummy URL, не выполняет SQL.
- file-stages снят из runtime registry/imports/dependencies; lockfile содержит только удаление трёх importer lines, версии не изменены. Исторические module records/package sources/migrations/ChangeLog сохранены.
- Current sketch (включая выбранный из замера) исключён из sections; previous sketch остаётся вложением. Current project cover исключён из документов проекта. ID/storage originals в implementation не менялись.

## PostgreSQL и deployment

- Новая migration 20261008173000_file_sections подготовлена; actual schema не применялась этим агентом.
- Root выполнил первый reviewed rollback rehearsal на existing local PostgreSQL: FAIL23502 на первой Client fixture (phone required), до migration. Прежний harness finally вызвал ROLLBACK, но baseline MATCH при failure не был проверен — не заявляется.
- Fixture исправлена synthetic phone QA_DISABLED_PHONE. Теперь failure path выводит только safe pg table/column/constraint и сверяет snapshot всех tables и File schema после ROLLBACK с before; MATCH только при реальном совпадении. Root повторил reviewed serial rehearsal: PASS на existing local PostgreSQL (127.0.0.1:5433/pero_crm).
- Результат actual PostgreSQL: 24 fixtures +4726 existing File rows; GENERAL150, INSTALLATION447, PRODUCTION3479, MEASUREMENT674 (counts включают fixtures). Все File fields/keys/FKs/current cover/sketch refs сохранены; остальные tables не изменены; schema enums/default verified; ROLLBACK data/schema MATCH по53 tables. Storage writes0.
- Harness проверяет 24 owned metadata fixtures всех старых category/stage/product combos (archived product включён), ALL existing File rows, exact mapping, прочие File fields/storage keys/refs/FKs, enum/default, остальные tables и rollback данных/DDL. Он не обращается к original objects, не является blob restore proof.
- pnpm build успешно завершён на inert dummy env без доступа к рабочей БД. Браузерная и deployed staging приёмка ожидают контролируемого выпуска и проверки ревизии.
- Удаление старых колонок несовместимо с old Prisma: root должен обеспечить остановку принимающего requests прежнего web до migration. Никаких watcher/infra изменений в113.
- Local/staging dumps, restic, production и удаление originals не выполнялись.

## Разрешение и следующая интеграция — 09.10.2026

- Владелец прямо разрешил коммит задачи113, обычные merge и push в staging; root координирует GitFlow. Этот агент не выполнял commit/merge/push. Production не разрешена.
- Root coordination подтвердил prior whole functional review113_files: NONE. Fresh scoped review текущего frozen diff запрошен root перед интеграцией; прежние timestamp/sourceSHA не заявляются.
- Source frozen после full1373/1373, tsc/build/OpenSpec и reviewed PostgreSQL PASS. Изменяется только эта validation note; новые stage QA helpers не добавляются до root freeze/commit.
- Перед staging113 root выполняет обычный merge принятого staging в feature/113. Сохранить112 own-storage compensation и !repeated notification guards, инженерный DESIGN participant grant и111 DRAFT. Не переносить файлы, не выполнять cherry-pick/reset. После overlap проверить затронутые права, загрузку/CAS/replay и statuses.
- Push113 удерживается до приёмки111 before/after proof и110 migration acceptance. PhaseB115 ожидает принятого113.
- Staging before/after proof должен использовать READ ONLY snapshot: все существующие File IDs/поля/FKs/storage keys и cover/sketch refs, плюс fingerprints остальных business/models; исключаются только удаляемые category/caption/stage и новый section при canonical File comparison. Expected section для каждой существующей строки сохраняется перед migration: MEASUREMENT первой; без product GENERAL; INSTALLATION изделия; ASSEMBLY/PRODUCTION изделия PRODUCTION. После сравнить exact ID→section mapping и остальные поля, finance и остальные model hashes должны MATCH. В proof только hashes/counts, без содержимого, PII, credentials или blob write.
- Ночной refresh/W07 сохраняется. Новый web не принимает запросы до согласованной migration/проверки совместимости; после nightly refresh существующий migration step должен восстановить актуальную схему. Local/staging без дампов, restic/infra не используются.
