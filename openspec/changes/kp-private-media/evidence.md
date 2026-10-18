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

Субагент не выполнял DB/S3 writes, физическую очистку, создание контейнеров, commit/push/merge или deploy. Реальный staging SHA/образ, приватный маршрут в браузере и настоящее S3-readback/versioned cleanup не проверены и не заявляются.

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

Пункт 2.2 завершён фактической проверкой атомарных DB-связей, копий, ручных файлов и retirement intents. Native DB часть 3.2 выполнена. **Настоящий S3 не вызывался**: private Put/Get/readback, versioning и физическая очистка остаются незавершённой частью 3.2; staging/браузер остаются в 3.3.
