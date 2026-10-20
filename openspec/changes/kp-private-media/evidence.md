# Проверки №183

Рабочая ветка `feature/183`, worktree `D:/Projects/pero_crm_worktrees/kp-183`. Код без публичных routes и без запуска фоновой очистки; UI/API подключаются №184/187, очистка — №188. Флаг интеграции не включался.

## Проверено локально без БД и облака

- 50/50 поведенческих тестов: 19 новых media-тестов и 31 существующий сценарий файловых ACL/обложек. Команда: `pnpm --filter @pero/web exec tsx --test tests/kp-media*.test.ts tests/engineer-access.test.ts tests/engineer-access-actions.test.ts tests/product-cover-backend.test.ts tests/project-cover-core.test.ts`.
- Настоящие sharp-кодеки JPEG/PNG/WebP; оригинальные и готовые browser/import optimized байты не перекодируются. Серверный default — JPEG 82, максимум 1600 px; проверяются magic, реальное декодирование, 15 МиБ и pixel bound. Общий existing preview limiter ограничивает подготовку двумя активными и восемью ожидающими заданиями.
- DI проверяет журнал до первого Put, точные cleanup keys после частичного сбоя, readback SHA-256 после неизвестного ACK, запрет перезаписи и неправильного binding, смену этапа/ревизии/пользователя/API key до публикации. S3 SDK-порт проверен без сетевых вызовов: If-None-Match, длина, SHA, отсутствие public ACL, ограниченный Get.
- Независимый Product copy key находится вне `kp/`; тест удаляет исходные объекты в памяти и проверяет сохранность копии. Текущая уже управляемая копия переиспользуется. Приватный reader повторно проверяет право после Get; renderer получает только байты нужных owned media ID.
- Общий фильтр File скрывает retired managed copies, сохраняя доступ при живой ссылке обложки и прежний производственный ACL. Relational DI fixture дополнен SQL-семантикой nullable поля и `isNot`, без ослабления сценариев.
- После обычного FF merge основы №180 до `aff6c105bbf17c39036ff2b3d123eb5fdbba6233` в собственной схеме добавлены оба ProposalJobKind, Media uploadState/uploadJobId/optimizedMimeType и все File/Item/Media/Job relations из design. Nullable FK, unique/index имена, default и Restrict/Cascade соответствуют SQL №183. Prisma validate/generate с синтетическим DSN прошли без подключения БД; использован только generated client этой ветки. Полная strict типизация, 50/50 focused tests, ESLint затронутых TS, OpenSpec strict и git diff --check повторно прошли.
- После обычных merge №181 и №182 до HEAD `d7078cdf736f36280c513db0806b2b60264573c0` оркестратор повторил focused tests: **54/54 PASS**, полная web-типизация также PASS. Переноса features копированием файлов между ветками не было.

## Схема и формат миграции

SQL `20261018000400_kp_private_media` аддитивен: состояния/виды jobs, provenance File, owner/checksum-binding triggers. Foundation №180 пришёл обычным merge, модельные определения готовы. Фундамент не копировался из другой ветки. Миграция №183 применена координатором; native PostgreSQL media-проверка также завершена, результаты ниже.

По поручению координатора проверены raw bytes одной новой миграции после восстановления stash. Исправлены только CRLF→LF: 5818→5738 байт; прочих CR нет, семантический текст не менялся. `.gitattributes` задаёт `text eol=lf` только для `apps/web/prisma/migrations/20261018000400_kp_private_media/migration.sql`; `git check-attr` подтвердил оба атрибута. Переносимый SHA-256 LF-файла: `5166bd9aacc9da701c61c6d5034f9d574be7295e433c9e2a61bd7614c353a434`. Ранее применённые миграции не редактировались.

По отдельному согласованию координатора добавлен optimized-only архивный случай: настоящий import UPLOAD_MEDIA ledger и PENDING→READY после проверки байтов; отсутствующий original сравнивается через IS NOT DISTINCT FROM, а optimized key/hash/size/owner/binding остаются обязательными. Это SQL-условие применено вместе с миграцией №183; native PostgreSQL подтвердил положительный случай и отказ при неправильном optimized hash.

`tests/helpers/kp-private-media-native.ts` выполнен guarded координатором: открытая Prisma transaction, собственный SAVEPOINT/ROLLBACK, настоящий SQL-журнал/replay/owner read, синхронизация CurrentMedia/File, сохранность ручных файлов, точный retired intent, SQL-guards, смена этапа во время имитированного I/O и текстовое сохранение после имитации годового удаления источника. Helper не открывает соединение и использует только MemoryS3-порт.

Локальный этап не включал физическую очистку, создание контейнеров или deploy. Последующая приёмка реального staging SHA/образа и SQL-адаптера приведена ниже. Приватный пользовательский сценарий и настоящее S3-readback/versioned cleanup остаются открытыми.

## Постоянное применение local №181–183

После нового разрешения владельца на №181–183 оркестратор выполнил штатный `Prisma migrate deploy` на существующей разрешённой local5433. Источники закреплены в reviewed source plan SHA-256 `2fea3d8dff3608da329dadf57c9f56cc608bfa563a0a7f2e777ba9da6e5ac9a3`, preflight SHA-256 `f5770998037301885a522013db79a2c232ed7399f7af2b718fd1a77e71d48054`. Tracked-исходники соответствуют HEAD `d7078cdf736f36280c513db0806b2b60264573c0` после обычного merge №182 и незакоммиченным изменениям №183.

Фактическая квитанция: `.playwright-mcp/kp-183/apply-result-d52c92b7-fa72-4e39-8ff3-36cde052f31a.json`, status PASS. Применены все 83 миграции, ожидающих нет; четыре прежних checksum-исключения сохранены без изменения старых receipt. Подтверждены `existingRowsPreserved`, `oldMigrationRowsUnchanged`, `exactNotificationRewrite` и `exactCatalogChange`. Все 11 таблиц КП пусты, оба новых значения ProposalJobKind видны после commit. SHA-256 полного public-каталога после применения: `805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`.

Это подтверждает применение и сохранность прежних данных. Последующий `verifyKpPrivateMediaNative` выполнен отдельно, результат ниже. Дампы, seed/reset, новые БД, S3 и production не затрагивались этим применением.

## Native PostgreSQL + MemoryS3: PASS

Оркестратор выполнил reviewed runner после commit миграций: runId `a29d14a8-b5d6-42c4-bb3c-139cdc61f8a0`, source plan SHA-256 `554145348f1f004b6dbad7f4da66b8520fff4d0e8e20b404da80bb75fc0e8b69`. Фактический результат хранится в `.playwright-mcp/kp-183/native-media-result.jsonl`: **7/7 PASS**.

- Настоящий durable SQL-журнал до Put, повтор той же операции, конфликт операции и приватный доступ uploaded media владельца.
- Optimized-only архив с настоящим UPLOAD_MEDIA ledger, корректным nullable original и отказом при подмене optimized hash.
- Атомарные CurrentMedia/File, физически отдельные ключи Product copy в MemoryS3, сохранность ручного файла, sketch и cover.
- SQL-триггеры отклоняют подмену пути управляемого File и хэша media-варианта.
- Замена копии создаёт точный retirement intent; действующая Product copy остаётся после удаления KP-ключей в MemoryS3, ручной файл сохранён.
- Текстовое сохранение со старым удалённым источником переиспользует независимую копию; новая загрузка просроченного КП отклоняется до обращения к storage.
- Смена этапа перед публикацией оставляет PENDING media и durable ledger, не создавая готовый некорректный File.

Runner удерживал общий advisory mutex, блокировал fetch/HTTP(S) и глобальный Prisma singleton вне переданной транзакции. Приватный sentinel гарантировал внешний ROLLBACK; все fixtures откатились. Полные снимки **76 таблиц и каталога совпали точно**: baseline SHA-256 `afd3a5a3feb4e6029c8ca298804d713f6b778b05da403194380adee268ee9bec`; полный public-каталог SHA-256 `805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`. Все 83 успешных receipt и четыре прежних checksum-исключения сохранены; постоянных записей native QA нет.

Пункт 2.2 завершён фактической проверкой атомарных DB-связей, копий, ручных файлов и retirement intents. Native DB часть 3.2 выполнена. **Настоящий S3 не вызывался**: private Put/Get/readback, versioning и физическая очистка остаются незавершённой частью 3.2; пользовательский API/browser-сценарий остаётся в 3.3.

## Staging: SQL-адаптер и фактический image — PASS

Оркестратор принял ревизию `2ff9e871baac6d2fcb0a974bc83883a0595bc631` на `crm-staging`, image `sha256:52b342cf8b8832f5b5757dfb8e661b9d26b94168b9bea0b4b01d1a50fdc4cf10`. По подтверждению оркестратора CI run `39142975226` завершил все шесть jobs с SUCCESS. Ignored `http.json` в каталоге прогона подтвердил HTTP 200 для `/api/health` и `/login` этой ревизии; это проверка доступности, пользовательский сценарий КП в браузере ещё предстоит.

Guarded runner выполнен оркестратором после проверки CI и фактического image: runId `7209c1d1-d9d2-4302-83aa-e1af342a1a2e`, **7/7 PASS**, `preservation=EXACT`, длительность 2323 мс. Квитанция: `.playwright-mcp/kp-183/stage-27d86f6b-ddf4-4233-8394-cb7fe38668a2/capture-receipt-b01cd28c-faf5-4b83-9986-2ccf271d8215.json`, SHA-256 `0cf0c7bd54cf8df20e6dc03d895e0a327ed7e074a588a0f4bd9b0e2f6c9f70fd`.

До SQL проверены точные DB container `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, volume `crm-staging_pgdata`, StartedAt `2026-09-23T11:42:14.649193151Z`, W07 outer SHA-256 `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139`, DB `db:5432/crm/public` и staging S3 binding. Четыре receipt миграций №180–183 совпали с закреплёнными checksum, незавершённых миграций нет; оба новых ProposalJobKind видны после commit. Все 11 таблиц КП пусты до и после проверки, флаг КП остаётся OFF.

Выполнен тот же неизменённый `verifyKpPrivateMediaNative`: семь SQL-сценариев журнала/replay/владельца, optimized-only архива, CurrentMedia/File и независимых копий, нативных owner/hash guards, retirement intent, старого удалённого источника и отзыва этапа перед публикацией. Настоящие кодеки выполнены в целевом image: Linux x64, sharp `0.35.3`, libvips `8.18.3`; Prisma `6.19.3`, Zod `4.4.3`. Хранилище этого прогона — только MemoryS3.

Одна внешняя транзакция с advisory mutex и обязательным ROLLBACK не оставила постоянных fixtures. Полные fingerprints **76 таблиц совпали точно**, baseline SHA-256 `8135309dddff9d172be4fde7a8061babbe8d28d29ebae10f3a78867bc3462c65`; полный public-каталог до/после также совпал, SHA-256 `f28160d116d333d1ba0251bbd90ed7719393e7cbd2281ba758eeeac05f5e2c74`. Каталог включает колонки, enum, права, sequences, политики и rules. Tripwires глобального Prisma вне переданной транзакции, fetch/HTTP(S)/HTTP2, S3 SDK, уведомлений и post-commit effects не сработали; данные не исключались из сравнения, baseline не заменялся.

Сборка runner — 69 031 байт, bundle SHA-256 `9505fb6299222a86384e81a6ad1bbdb32fe128e629e2b8590cb395a1394867bc`. Все 34 production/helper/config/schema/SQL входа проверены против точных Git blobs принятой ревизии; source proof SHA-256 `28673ad68f8edb45cd5483f53cac170f262467b4331c00a4ebccedb1bfd0a577`. Ignored исходники runner заморожены; их общий proof SHA-256 `a1d3bfaee157b7dea23080d3e3709401e54c20e8a7baec85942572d18714b962`. Отдельно прошли 7/7 локальных guards/diagnostic tests и scoped strict типизация; локальный default инертен, target guard отклоняет запуск bundle вне staging-контейнера до загрузки Prisma.

Эта квитанция принимает staging SQL-адаптер №183 и фактический image. **Пункты 3.2 и 3.3 остаются открытыми:** настоящее private S3 Put/Get/readback/versioning, физическая очистка и пользовательские API/browser-сценарии КП выполняются после подключения №187/188. Прогон с MemoryS3 не подтверждает эти части; orchestration №181, отдельная API idempotency и concurrency данным runner не проверялись.

## Частичная staging-приёмка на 20.10.2026 и открытые physical-проверки

Ранее принятая часть сохраняется: CORE4/media с настоящим private immutable Put/Get/readback, Lead23 и desktop/mobile Locked UI34 (8/8), два native VERIFIED contract-сценария и Manager composition 5+1. Runtime: staging `acbd164cb6e79194b7fe87a0469d60d745dead1a`, web image `sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`, renderer `sha256:ec35d0956e41d55f7d21cac46c5ea07430bde99d920a9538791899cc75dac5a8`. Подробности уже находятся в verification.md; классификация UI34: SHA-256 `33147ab14ee7c19b0344f799002224c42f1bee32b61b5f42581e37cd599b5ac0`. Это принятая часть пункта 3.3; прежние HOLD не переименованы в PASS.

FULL43 выполнил настоящий **readonly** S3 capture: 11 объектов / 2 jobs, по 11 LIST/HEAD/GET, RR READ ONLY, `writeCommands:0`, все семь tripwires равны нулю. [Фактический result](D:/Projects/pero_crm_worktrees/kp-180/.playwright-mcp/kp-integration/physical43-0cb36e93-c99a-41ea-9730-a15dc2510163/initial-capture-result-8ab07c93-8ae0-47c1-a04f-f032fa3d5708.private.json): SHA-256 `c0459ef6e5122c78a9caf0ceb5f5df1e7a381d898c69a5a7dd72375a58303385`; полный RAW transport: `052d3d78efd92bdadfc80a877783a6a780ecbda19eb3a33059197a8dcbdac992`.

После capture локальный QA-селектор ошибочно требовал MEDIA_ORIGINAL и у secondary, чей фактический target — PDF. До истечения исходного допуска 405s физический producer не был отправлен. **Все десять физических команд, after-annual retained SDK contract и LEAD/restore410 в FULL43 — NOT RUN.** Readonly capture не подтверждает versioning/COPY/Delete, lost-ACK retry, отмену, годовую очистку или сохранность Product copy после реального удаления. Пункт 3.2 остаётся `[ ]`; обязательная физическая приёмка не отменена.

FULL43 безопасно закрыт: тот же q100 journal RESTORED; OFF 000, owned renderer STOPPED; original finish PASSED (11 пользователей неактивны / 22 ключа отозваны), keeper ORIGINAL_FINISH_OBSERVED и `alive:false`. Закрытый context: `0aa61d40171d87c89c6d517ec74fde17f5e54d44a8629da6b7bce5d194747b74`; finish RAW: `88a09d3f3ec715261d03eceda3b0acc5e20eae81b3696afd578f16f79e62411b`; keeper: `790775854b4a012e58062d45de18340e74841084f837a22551429108a004963c`. Полные ссылки closure и границы сохранности приведены в [evidence №188](D:/Projects/pero_crm_worktrees/kp-188/openspec/changes/kp-retention-cleanup/evidence.md). Оставшиеся pending jobs сохранены; global-zero не заявляется. Main/production и финальный cutover этим результатом не приняты.
