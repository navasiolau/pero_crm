# Подготовка QA №10: ручной состав изделия

Этот документ и `apps/web/tests/composition-owned-fixtures.mjs` описывают **будущую** проверку. Владелец ещё не согласовал создание этой QA-фикстуры. Код инертен при импорте; БД, Docker, SSH, миграция, браузер и cleanup в рамках этой подготовки не запускались. Production/main исключены.

## Точная цель и предварительные условия

- Local: только существующий контейнер `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, `127.0.0.1:5433/pero_crm`.
- Staging: только существующий DB-контейнер `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, guest `crm-staging`, `db:5432/crm`.
- Root отдельно сверяет контейнер, web-ревизию, W07/обновление, backup, применённую миграцию `20260929120000_product_composition`, полномочия и разрешение владельца на **конкретную** цель. Helper сверяет переданный target повторно; он не открывает соединение сам и не меняет схему. Любой guard mismatch — STOP без подбора нового DSN или фикстуры.

## План до первой записи

Миграция: `apps/web/prisma/migrations/20260929120000_product_composition/migration.sql`, SHA-256 `796F32FB3ECAF89501098841A718BC598D5D90E02FEBA6BE937ED58B1D081017`. Она добавляет две таблицы и два enum без backfill. До применения к каждой разрешённой цели root сохраняет защитный `pg_dump`, checksum, TOC и полное чтение архива через `pg_restore --file` (это не тест восстановления). После миграции две новые таблицы пусты, все прежние бизнес-отпечатки неизменны; migration ledger содержит только ожидаемое добавление и не содержит failed migration. На staging используется действующий W07 lock, расписание refresh и автодеплой сохраняются. Production backup/SQL не выполняются.

После разрешённой миграции root делает read-only снимок всех текущих `public`-таблиц. Список таблиц закрепляется в плане, включая дополнительные таблицы фичи №9, если она уже интегрирована. Каждая строка хешируется из исходного `to_jsonb(t)::text`; числовые значения не проходят через JS Number, исключений для изменившихся бизнес-полей нет. План содержит UUID шести создаваемых объектов, baseline для **каждой** таблицы, точный target, marker `QA-COMP-<runId>` и SHA-256. Root сохраняет план в приватном каталоге с контрольным чтением **до** вызова `prepare`. При неизвестном результате prepare повторно исследуются ровно эти ID; второй набор не создаётся.

Предлагаемая фикстура на одну цель: три QA User (`MANAGER`, `ENGINEER`, `WORKER`, `payScheme=NONE`, `.invalid` email), один QA Project с существующим Client **только для чтения**, один QA Product `DESIGN` с QA-инженером и одна QA Task для просмотра изделия работником. Task имеет `workId=null`, `NEW`, `assigneeId=QA WORKER`, `createdById=QA MANAGER`, точные QA projectId/productId, тип «Проверка состава», срок и оценку 30 минут; она не запускается и не завершается. Номер/название включают runId. Не создаются Work, TimeEntry, PayrollEntry, материалы, платежи, касса или файлы. У пользователей нет натуральных денежных начислений. Парольные хеши нужны лишь для QA-аккаунтов и не входят в публичный manifest; там хранится digest хеша. Финансовые таблицы остаются в полном baseline, чтобы любые изменения дали STOP.

## Native/browser сценарий после отдельного разрешения

1. Пустое Product: вкладка «Состав» показывает отсутствие ревизий. QA manager создаёт черновик и три строки: MODULE `М-1` ×2, дочерняя PART `Д-1` ×3 и HARDWARE `Ф-1` ×4. Модуль и деталь могут одновременно иметь признак «поедет на монтаж». Итог детали на изделие — 6, но сохранённое количество — 3 на модуль.
2. Проверить отказ дубля обозначения после NFKC/trim/uppercase, чужого родителя, цикла, количества 0/дроби/1 000 001 и устаревшей версии. QA worker видит изделие только для чтения через ровно одну назначенную ему QA Task; engineer редактирует лишь в пределах существующего Product ACL.
3. Подтвердить ревизию 1. Клонировать её, изменить количество детали 3→4 и подтвердить ревизию 2. Прямое чтение ревизии 1 сохраняет исходные ID/числа/признаки; её UPDATE, DELETE и **INSERT новой строки** отклоняются нативным PostgreSQL guard. Повтор UUID не создаёт третью подтверждённую ревизию.
4. Создать следующий черновик из ревизии 2 и добавить ещё одну позицию. В финальном состоянии две CONFIRMED и один DRAFT, плановый пример 3+3+4=10 существующих строк. По умолчанию Product показывает подтверждённую ревизию 2, черновик выбирается явно. Проверить форму и длинные обозначения на 360×800, 390×844 и 1440×900 с личным просмотром скриншотов.

Лимиты разрешаемого **одного** прогона предлагаются отдельно от текущего состояния БД: не более трёх одновременно существующих ревизий и 12 существующих строк, не более четырёх созданных ревизий **за весь прогон** (четвёртая допускается лишь как один отменённый черновик) и 12 созданных строк за весь прогон. Captured ownership включает журналы уже удалённых позиций и отменённого черновика; их actor, действие, productId, revisionId и счётчики проверяются до cleanup. Это верхний предел предложения владельцу, а не уже полученное разрешение.

`capture` допускает начальную, неполную и финальную фазу, но `expectFinal` проверяет две подтверждённые ревизии плюс один черновик. Любая незапланированная дочерняя таблица/ссылка, лишняя ревизия/строка, чужой ChangeLog, изменение QA User/Project/Product/Task или разница baseline — STOP. Сбор доказательств и browser-drained proof выполняет root, прежде чем просить cleanup. Pure guard/static SQL тесты не являются доказательством native FK, rollback, конкурентного подтверждения или визуальной приёмки.

## Точный cleanup после capture и drained proof

`cleanupCompositionQa` получает только уже предоставленный `PrismaClient`, public manifest и capture с exact owned IDs. В одной `ReadCommitted` транзакции он берёт общий advisory lock `(18435,55001)`, `SHARE ROW EXCLUSIVE` всех закреплённых таблиц и `ACCESS EXCLUSIVE` только `ProductCompositionRevision`/`ProductCompositionItem`. До удаления под lock повторяются полный raw fingerprint, owned graph/hash и каталог пользовательских triggers. Должны существовать ровно `ProductCompositionRevision_guard` и `ProductCompositionItem_guard`, включённые (`tgtype=31`, без WHEN/аргументов), с ожидаемыми `prosrc` из reviewed migration. Затем **только эти два** trigger временно отключаются и восстанавливаются до COMMIT. FK никогда не отключаются.

```sql
BEGIN;
SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001);
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE <точный список public-таблиц из manifest> IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public."ProductCompositionRevision",public."ProductCompositionItem" IN ACCESS EXCLUSIVE MODE;
-- Verify target, table list, raw foreign fingerprints, exact owned graph and two trigger definitions/state.
ALTER TABLE public."ProductCompositionRevision" DISABLE TRIGGER "ProductCompositionRevision_guard";
ALTER TABLE public."ProductCompositionItem" DISABLE TRIGGER "ProductCompositionItem_guard";
DELETE FROM public."ChangeLog" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM public."UserPreference" WHERE ("userId"||'|'||"key")=ANY($1::text[]) RETURNING "userId";
-- ProductCompositionItem: один параметризованный DELETE на каждый уровень глубины 16→1,
-- только captured row IDs; RETURNING count должен совпасть.
DELETE FROM public."ProductCompositionItem" WHERE "id"=ANY($1::text[]) RETURNING "id";
-- ProductCompositionRevision: черновик, подтверждённая №2, затем №1 (FK RESTRICT на baseRevisionId).
DELETE FROM public."ProductCompositionRevision" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM public."Task" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM public."Product" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM public."Project" WHERE "id"=ANY($1::text[]) RETURNING "id";
DELETE FROM public."User" WHERE "id"=ANY($1::text[]) RETURNING "id";
ALTER TABLE public."ProductCompositionRevision" ENABLE TRIGGER "ProductCompositionRevision_guard";
ALTER TABLE public."ProductCompositionItem" ENABLE TRIGGER "ProductCompositionItem_guard";
-- Verify trigger hash unchanged and every full raw table fingerprint equals the pre-fixture baseline.
COMMIT;
```

На каждой строке проверяется точное количество `RETURNING`. Неизвестная ссылка, несовпадение графа, trigger definition/state, число удалений, изменение другой таблицы или ошибка SQL вызывают ROLLBACK — вместе с временным `DISABLE TRIGGER`. Никаких `TRUNCATE`, `session_replication_role`, age/name cleanup, удаления существующего Client или пересоздания БД. Если фича №9 успеет изменить схему после сохранения плана, pinned список таблиц разойдётся и QA прекращается до нового отдельно проверенного плана.
