# План локальной и staging-приёмки инженерного фонда

Авторизация владельца от 29.09.2026 разрешила local/staging приёмку по этому плану на существующих целях. Защитная local и staging копии уже созданы, local migration №6 применена; точные receipts и подтверждённые пределы указаны в integration-evidence.md. Local native rollback-проверки выполнены, четыре local QA-прогона очищены exact-owned-ID helper'ом с сохранением foreign-data fingerprints. Полная GUI/визуальная приёмка ещё не принята, staging migration/deploy и fixture не выполнялись. Код helper'а не запускается при импорте и не открывает соединение. Production и продвижение в main исключены.

## Конкретный объём разрешения от 29.09.2026

На каждой из существующих local/staging целей разрешено использовать ровно одну Project, один Product, две Work, не более четырёх Task и три QA User. Это включает дополнительное изделие, вторую работу и третьего сотрудника относительно прежнего QA набора. Разрешены защитные backup существующих local/staging БД, применение только указанной ниже миграции после guards, native/browser-приёмка и точная очистка owned строк. Код №6 прошёл 333 теста CRM, 9 тестов бота, TypeScript, lint и production build с фиктивным DSN; native/visual/staging acceptance этим не заменяется.

Защитные pg_dump только существующих local/staging БД созданы. Локальный backup `C:/Users/admin/AppData/Local/Temp/pero-engineering-migration-XAREGF/receipt.json` имеет 1,315,598 bytes; архив целиком прочитан `pg_restore --file` и проверен по TOC, но не восстановлен. Исходные 34 table hashes не изменились; четыре новые таблицы пустовали после миграции. Staging receipt `8f1fc4d0-6200-4800-ae49-e3e50a4e57c6` находится в `/var/lib/pero-engineering-qa/<run>/receipt.json`, размер 1,328,081 bytes, SHA256 `5315f4dafbdae1bfd1983e8723c5bcd9f7ebb48cfe35659794c27e205c17cc7f`; dump SHA256 `14d483b85be2f6faddea138713a3bf87816f4ce4ad67d5f8061e1249aa58b349`, 35 tables включая ledger. Архив целиком прочитан `pg_restore --file` и сверён по TOC, restore не выполнялся. Локально применена только [20260928220000_product_engineering_pay](../../../apps/web/prisma/migrations/20260928220000_product_engineering_pay/migration.sql), SHA256 `0749de41ad5bc66075084d57440e4acb027b20739492ae8f87552f18f2335266`: четыре enum, четыре новые таблицы, дополнительные поля/constraints и INSERT legacy-защиты. Старые деньги, количества и роли не пересчитывались. Staging остаётся на schema №5; migration №6 ещё не применена.

Применение требует отсутствия старого writer: локальный порт3000 на момент проверки не слушается, непосредственно перед DDL root проверит процессы/соединения снова; при обнаружении старой версии её приём запросов прекращается и запросы завершаются до миграции. На staging штатная замена web-контейнера должна остановить старый процесс до entrypoint/migration нового; root принимает этот порядок и точную ревизию, сохраняет W07-защиту пересечения с refresh. Новая схема и экземпляр с ENGINEERING данными не откатываются на старый несовместимый образ.

Local native checks выполнены: 11 проверок с безусловным rollback подтвердили ограничения, append-only triggers, incomplete close без записей, 500 BYN без PIECE, replay после DELIVERY, точный trigger catalog и неизменность полного snapshot. На local выполнены четыре разрешённых QA-прогона (`xJSe6v`, `e1aWKb`, `AA3cpz`, `EAxD9J`); каждый очищен по captured IDs exact helper'ом, foreign-data fingerprints совпали. Cleanup отключает ровно четыре именованных user trigger только внутри одной транзакции, с блокировками; FK остаются включены, определения и enabled state проверяются и восстанавливаются до COMMIT. Ошибка приводит к ROLLBACK. После очистки read-only проверка подтверждает отсутствие QA-строк и сохранность остальных данных. Полная GUI/визуальная приёмка ещё не PASS; staging fixture, migration и deploy ещё не выполнялись.

Новых БД/контейнеров, reset/seed, production backup/SQL, production deployment, commit/push в main и продвижения main это разрешение не охватывает. По завершении локальной и staging приёмки остановиться перед commit/push/deploy beyond staging и получить отдельное решение владельца. Продвижение в main остаётся HOLD.

## Цели и границы

Разрешаемые цели после согласования: существующая локальная БД `pero_crm` в Docker-контейнере `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5` через `127.0.0.1:5433`; либо существующая staging-БД **`crm`** контейнера `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, гостевой сервис `crm-staging`, `db:5432` (volume `crm-staging_pgdata`). Staging DB/user=`crm`/`crm` подтверждены root read-only metadata probe; первоначальный guard корректно остановился до SQL из-за ошибочного имени `pero_crm`. Root-runner отдельно проверяет host/container/DSN, текущую миграцию, backup, read-only inventory и сохранение приватного плана с контрольной суммой. Helper повторно сверяет точные идентификаторы цели. Любое несовпадение — STOP без создания данных. Сам fixture-helper не применяет schema SQL: миграция принимается root отдельным шагом выше. Пересоздание БД, seed/reset и replica mode запрещены.

План с UUID всех исходных строк, точным контейнером и исходным бизнес-снимком каждой таблицы должен быть сериализован канонически, его SHA-256 вычислен, а сам план и digest надёжно сохранены с обязательным readback **до первой вставки**. Подпись/HMAC не заявляется: данный план не задаёт реализованный ключевой механизм. Digest сверяется перед использованием. Это позволяет найти owned rows даже при неизвестном результате `prepare`. При `prepare` повторно проверяется fingerprint до вставки и после неё (исключая только явные owned IDs). `ApiToken.lastUsedAt` — единственное допустимое исключение из бизнес-fingerprint, как в принятой предыдущей QA. Значения `numeric(18,2)` хешируются из `jsonb::text`, без преобразования в JS Number. Пароли и их хеши не попадают в manifest; там хранится лишь digest хеша для проверки неизменности QA-пользователей.

Порядок root-runner: вызвать только read-only `baselineEngineeringOwned(db,target)`, составить план с этим baseline и всеми UUID, вычислить `engineeringPlanSha256(plan)`, надёжно сохранить план и digest, выполнить readback и пересчитать digest; затем вызвать `prepareEngineeringOwned({db,plan,durablePlanSha256})`. Полученный manifest также надёжно сохранить до открытия браузера и проверить readback. При неизвестном результате `prepare` повторно читать только запланированные ID и применять guard; не создавать второй набор.

`prepare` и `cleanup` начинают write-транзакцию с общего CRM advisory lock `(18435,55001)`, затем берут `SHARE ROW EXCLUSIVE` на все fingerprint-таблицы: записи блокируются, чтение остаётся доступным. Для смены четырёх trigger states `cleanup` повышает блокировку только их таблиц до `ACCESS EXCLUSIVE` до первого снимка. Используется `ReadCommitted` после получения блокировок, `lock_timeout=5s`, `statement_timeout=30s`, общий timeout транзакции 60s. Timeout или ожидание — STOP/rollback.

Нужен согласованный тихий интервал для выбранной БД: любые реальные бизнес-изменения между baseline, capture и cleanup приведут к STOP по fingerprint, а не будут списаны на QA. При невозможности обеспечить этот интервал приёмка на этой цели не стартует.

Baseline read-only inventory staging до QA: 184 Project, 1325 Product, 6449 Work, 1131 Task, 18 User, 4736 File; PayrollEntry — 0, старых процентных writer-записей — 0, failed migrations — 0, несовпадающих Product/Work/Task контекстов — 0. Найдены 17 старых Work с quantity ≤ 0; их не изменять и не удалять, новая DDL не вводит количественное ограничение на LEGACY. Эти данные — исходный baseline; текущее разрешение указано выше.

## Добавляемая фикстура на одну цель

- Один Project с номером/именем `QA-ENG-<runId>` и один Product `DESIGN`, цена 10 000 BYN; Client выбирается существующий и остаётся read-only. Основной инженер — QA E1.
- Три новых QA User с `.invalid` email и маркером runId: E1 `ENGINEER/PIECE`, E2 `ENGINEER/PIECE`, W `WORKER/PIECE`. Пароли хранятся только в защищённом состоянии root-runner. Никакие существующие учётки не изменяются.
- Одна LEGACY Work на изделии: quantity 5, priceSnapshot 100, total 500. Две задачи с quantity 2 и 3, обе первоначально E1, без PayrollEntry. Первая может быть заранее DONE с одной явно помеченной TimeEntry; вторая NEW. Одна TaskDependency связывает их. Данные времени, объёма, старых денежных снимков и DAG фиксируются в manifest и сверяются после сценария.
- Один DRAFT ENGINEERING pool без ставки. Новая ENGINEERING Work quantity **10,30** и её задача создаются через GUI после `prepare`; к концу сценария Work всего две, Task четыре. План заранее фиксирует точный заголовок новой работы. Новая физическая группа `STAGE_PREVIEW` имеет quantity 10,30 и NULL budget/currency; после split обе Task хранят group quantity 10,30, сумма физических units — 1 000 000, денежные `shareAmount` остаются NULL. Динамические Work/Task принимаются в owned graph только при точной связи с QA Product/Project, ожидаемом акторе, названии, значениях и проверенном split receipt. Посторонний дочерний объект даёт STOP.

## Разрешённый сценарий

Менеджер включает ставку 5%, конвертирует LEGACY Work с сохранением физического 2/3 и финансовым mapping 80/20. Вес новой ENGINEERING Work — 60%, LEGACY Work — 40%. Исполнитель делит новую задачу пополам E2. Preview при цене 10 000 BYN даёт E1/E2 350/150. Затем менеджер назначает 20% LEGACY Work W: 310/150/40. После изменения цены изделия на 12 000 BYN preview должен стать 372/180/48. Все четыре задачи завершаются по правилам времени/фото; переход DESIGN→PRODUCTION выполняет одно начисление. Повтор того же UUID возвращает прежний settlement, второй UUID не начисляет ещё раз. История, ChangeLog, outbox, валюты и финальные 372/180/48 сверяются. Ни у одного QA User не появляется `PIECE` по этим работам.

`capture` допускает исходную, прерванную частичную и финальную фазы для безопасного cleanup. Только отдельный `assertFinalEngineeringScenario` отмечает функциональную приёмку. В каждой фазе проверяется граф owned IDs и неизменность остальных строк; неизвестная ссылка, уведомление, event, receipt, изменение QA-идентичности или исходных legacy-снимков вызывает STOP. Root сохраняет capture и proof, что браузерные действия завершились, до cleanup.

## Reviewed SQL cleanup внутри **одной** транзакции

Реализация — `apps/web/tests/engineering-owned-fixtures.mjs`; вызов возможен только с уже предоставленным `PrismaClient`, точным target, сохранёнными manifest/capture и `actionsDrained=true`. Здесь указан SQL-контракт, который root сверяет с кодом перед каждым запуском:

```sql
BEGIN;
SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001);
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE "User","Client","Project","Product","ProductStatusHistory","ProjectStageHistory","Task","TaskAllocationGroup","TaskDependency","PriceItem","Work","TimeEntry","PayrollEntry","Payout","CashAccount","ExpenseArticle","Payment","OrgSetting","MaterialCategory","Material","ProjectMaterial","StockMovement","File","Communication","Notification","NotificationPreference","UserPreference","Plugin","PluginSetting","PluginRunLog","DomainEvent","ApiToken","ChangeLog","TelegramLink","ProductStagePayPool","WorkPaymentConversion","ProductStageSettlement","ProductStageSettlementShare" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "WorkPaymentConversion","ProductStageSettlement","ProductStageSettlementShare","PayrollEntry" IN ACCESS EXCLUSIVE MODE;
-- Повторить owned graph, foreign fingerprint и exact capture сравнение под lock.
SELECT c.relname AS table_name,t.tgname,t.tgenabled,t.tgisinternal,t.tgtype,t.tgnargs,t.tgqual::text AS tgqual,
       nf.nspname AS fnnamespace,p.proname,p.prosrc,p.prosecdef,
       pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace
WHERE n.nspname='public' AND c.relname IN ('WorkPaymentConversion','ProductStageSettlement','ProductStageSettlementShare','PayrollEntry')
  AND NOT t.tgisinternal;
-- Должны существовать ровно четыре перечисленных ниже enabled user trigger: tgtype=27,
-- tgnargs=0, tgqual IS NULL, fnnamespace=public, prosecdef=false, prosrc точно как в миграции.
ALTER TABLE "WorkPaymentConversion" DISABLE TRIGGER "WorkPaymentConversion_append_only";
ALTER TABLE "ProductStageSettlement" DISABLE TRIGGER "ProductStageSettlement_append_only";
ALTER TABLE "ProductStageSettlementShare" DISABLE TRIGGER "ProductStageSettlementShare_append_only";
ALTER TABLE "PayrollEntry" DISABLE TRIGGER "PayrollEntry_product_settlement_append_only";
-- Каждое DELETE ниже параметризовано точным массивом captured owned IDs; RETURNING count обязан совпасть.
DELETE FROM "Notification" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "UserPreference" WHERE ("userId"||'|'||"key")=ANY($1::text[]) RETURNING "userId";
DELETE FROM "ChangeLog" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "DomainEvent" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "PayrollEntry" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "ProductStageSettlementShare" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "ProductStageSettlement" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "WorkPaymentConversion" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "TimeEntry" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "TaskDependency" WHERE ("taskId"||'|'||"dependsOnId")=ANY($1::text[]) RETURNING "taskId";
DELETE FROM "ProductStatusHistory" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "ProjectStageHistory" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "Task" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "TaskAllocationGroup" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "Work" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "ProductStagePayPool" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "Product" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "Project" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM "User" WHERE "id"=ANY($1::text[]) RETURNING "id";
ALTER TABLE "WorkPaymentConversion" ENABLE TRIGGER "WorkPaymentConversion_append_only";
ALTER TABLE "ProductStageSettlement" ENABLE TRIGGER "ProductStageSettlement_append_only";
ALTER TABLE "ProductStageSettlementShare" ENABLE TRIGGER "ProductStageSettlementShare_append_only";
ALTER TABLE "PayrollEntry" ENABLE TRIGGER "PayrollEntry_product_settlement_append_only";
-- Повторить запрос trigger definitions/state: hash обязан совпасть с начальным.
-- Повторить fingerprint всех бизнес-таблиц: каждый hash обязан равняться baseline.
COMMIT;
```

FK не отключаются. Только четыре перечисленных user trigger временно меняют состояние, и они восстанавливаются до COMMIT. Любая ошибка, неизвестная ссылка, лишний user trigger, несовпадение количества DELETE, definition/state или business fingerprint приводит к ROLLBACK, включая откат `ALTER TABLE`. Удаление по возрасту, имени без manifest, `session_replication_role`, `TRUNCATE` и очистка чужих данных запрещены.

Перед любым реальным вызовом root сверит этот SQL с актуальной миграцией и реальным каталогом PostgreSQL, включая FK и определения триггеров. Локальные pure/DI тесты являются проверкой логики guard и не заменяют native SQL, rollback, concurrency или браузерную приёмку.
