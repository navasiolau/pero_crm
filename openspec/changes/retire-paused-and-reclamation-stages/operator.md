# Операторский перенос №193

По умолчанию `pnpm --filter @pero/web exec tsx scripts/retire-stages.ts` только выводит `INERT` и не создаёт PrismaClient. Нет web/API/cron-входа и нет обхода через флаг подтверждения. Production запускается только после отдельного согласования владельца, через проверенный production transport; staging proof для него недопустим.

Root импортирует `planStageRetirement`, затем `applyStageRetirement` из `apps/web/scripts/retire-stages.ts` через существующий reviewed transport7a84. Экспорты не подключаются к БД самостоятельно. Требуемые ports:

- `transaction(run)`: одна настоящая Prisma mutation-транзакция на существующей разрешённой БД; rollback при любой ошибке. Использовать один connection, достаточный transaction timeout, без reset/seed/дампа.
- `verifyTargetAndNoOldWriters(expected)`: реальная повторная проверка нового SHA, образа, идентичности target и отсутствия старых web/source writers, Telegram и workers в reviewed Root-контуре. Вернуть фактически проверенную identity. Нельзя возвращать аргумент как подтверждение либо подменять проверку флагом. Штатные соединения нового web/бота допустимы; их наличие не доказывает работу старых writers.

Target: `{kind:'local5433'|'staging'|'production', revision:SHA40, imageDigest:'sha256:…'|null, database:{name,schema:'public',systemIdentifier}}`. Только local5433/pero_crm допускает `imageDigest:null` при проверенном исходном SHA и отсутствии старых source writers; staging/production с БД crm требуют фактический image digest. Root дополнительно связывает local endpoint строго с127.0.0.1:5433 либо разрешённую deployment DB/container/volume и новый образ. `systemIdentifier` сверяется самой утилитой через `pg_control_system()`. Production proof должен происходить из отдельно согласованного production выпуска, включая проверенное восстановление временного дампа при миграции №195; расширение типа не является разрешением на исполнение. Старый5432/legacy не является допустимой целью. У роли соединения должно быть право читать system identifier.

Порядок:

1. Root подтверждает новую развёрнутую ревизию и отсутствие старых процессов/писателей живыми точными SHA/image/process proof. Новый web/бот и их idle pool connections сохраняются. От конкурентных новых записей защищают snapshot/CAS, общий advisory lock и SHARE ROW EXCLUSIVE NOWAIT; останавливать новый web или перезапускать БД для переноса не требуется.
2. `planStageRetirement(ports,{operationId:UUID,actorId:ACTIVE_ADMIN_ID,target})` возвращает `{schema:1,request,snapshot,fingerprint}` без бизнес-записей. Сохранять точный JSON приватно и рассмотреть перечень строк. Plan включает soft-deleted текущие записи, отсортированную историю для выбора предыдущего обычного этапа, затрагиваемые КП и незавершённые prune jobs.
3. После рассмотрения Root вызывает `applyStageRetirement(ports,plan,plan.fingerprint)`. Внутри повторяются live guards, общий mutex КП, блокировки таблиц и точная сверка снимка. Отличие останавливает операцию; старый план не исправляется автоматически.
4. Сохранить результат и сверку данных. Повтор того же operationId с тем же исходным планом возвращает `replayed:true`; передача другого плана отвергается.

Записи: только `Project.stage/stageChangedAt`, `Product.status/statusChangedAt`, добавление соответствующей истории и ChangeLog. Для PAUSED→LEAD дополнительно сбрасываются acceptance КП, увеличивается retentionEpoch, незавершённые PRUNE_VERSIONS получают CANCELLED. Причины рекламаций и старые события не удаляются; версии/байты/ключи/файлы/начисления не меняются. Новые DomainEvent, exports и prune jobs не создаются. Уже удалённые данные не восстанавливаются.

Алгоритм PAUSED: просмотреть stageHistory от свежих записей (`createdAt DESC,id DESC`), взять первый обычный этап из `toStage`, затем `fromStage`; обычные — LEAD/ESTIMATE/CONTRACT/IN_WORK/DONE. При отсутствии — IN_WORK. RECLAMATION проекта всегда IN_WORK; RECLAMATION изделия всегда PRODUCTION. Все преобразования согласованы владельцем; обычные app status actions для переноса не использовать.

Фактический plan/apply на local/staging агентом не запускался. Runtime-приёмка, guard adapter и запуск принадлежат Root.
