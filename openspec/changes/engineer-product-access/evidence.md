# Проверки engineer-product-access

## RED — 28.09.2026

`pnpm exec tsx --test tests/engineer-access-db.test.ts`, отдельная loopback БД `pero_crm_test_engineer`, предварительно проверены имя и COMMENT `PERO_CRM_TEST_DISPOSABLE`.

До правок реализации: 7 tests, 1 pass, 6 fail. Фактические ошибки: инженер получает 5 изделий вместо 1; фильтр чужого инженера возвращает 3 вместо 0; прямой запрос чужого изделия возвращает объект вместо null; смешанный проект содержит скрытые изделия; 3 проекта вместо 1; совмещённый ENGINEER+WORKER получает посторонний проект.

Схема подготовлена `prisma db push --skip-generate` после guard; seed и legacy migrations не запускались. Fixtures имеют UUID-префикс и очищаются по точным созданным ID.

## Исторический SQL/HTTP GREEN до уточнения владельца

Первоначальные 7 SQL-сценариев стали GREEN. Затем 10/10 tests подтвердили реальные Prisma-запросы и HTTP routes локального Next `127.0.0.1:3101`: чужие/PRODUCTION/task-only скрытые файлы и превью — 404; свой и общий файл — 200 с `private, no-store`; omnisearch возвращает только видимые сущности; подмена taskId при upload — 404, число файлов не меняется.

После указания владельца использовать существующую локальную БД этот сервер сразу остановлен; проверка порта 3101 не обнаружила listener. На момент уточнения последний прогон уже завершился вместе со своим teardown. После него SQL/fixture/cleanup-команды этим субагентом не выполнялись. Одноразовые DB/runtime harness-файлы удалены из change и заменены DI-тестами; историческая команда выше больше не является текущим способом запуска.

## Текущий GREEN без БД

`pnpm exec tsx --test tests/auth-security.test.ts tests/engineer-access.test.ts tests/engineer-access-actions.test.ts`: 19 существующих auth tests + 15 tests политики/запросов/уведомлений/расчётника + 7 tests реальных server actions/routes. In-memory adapter не создаёт PrismaClient, не открывает сокет и не пишет в БД. Подменены только auth/storage/audit boundaries; проверяемые actions/routes и query functions — из исходников CRM.

`pnpm exec tsc --noEmit --incremental false` проходит. ESLint затронутых файлов проходит. `openspec validate engineer-product-access --strict` проходит.

## Существующая локальная CRM — текущая приёмка

После подготовки существующей БД основным агентом выполнены проверки на `127.0.0.1:5433/pero_crm`. Helper сверяет явно заданный `CRM_LOCAL_CONTAINER_ID`, имя контейнера `pero_crm_pg`, локальный port binding, имя БД и пользователя. Пароль берётся из runtime env этого локального контейнера только в память и не выводится.

- `pnpm exec tsx tests/engineer-access-readonly.ts`: `transactionReadOnly=true`; роли всех 17 активных пользователей проверены на 174 проектах, 1305 изделиях, 4726 файлах. Проверены два чистых инженера, 44 их изделия DESIGN и 6 подробных карточек проекта. Пользовательские фильтры, подсказки, доступ по прямому номеру, счётчики и отсутствие общих денежных полей прошли проверки. Все Prisma-запросы выполнялись в `REPEATABLE READ` + `SET TRANSACTION READ ONLY`.
- `pnpm exec tsx tests/engineer-access-runtime.ts --serve`, затем `--check`: локальный Next на `127.0.0.1:3101`, отдельный тестовый AUTH_SECRET, S3 явно выключен. Создана подписанная изолированная тестовая сессия существующего активного инженера; вход по паролю не проверялся, роли/пароль/sessionVersion в БД не менялись.
- HTTP: два поиска не вернули скрытые сущности; оригинал и превью скрытого существующего файла вернули 404 именно на policy-проверке («Файл не найден», до проверки диска); своё DESIGN открылось с 200, чужое изделие — 404. Counts User/Project/Product/File/Task/Work/TimeEntry до и после совпали. Мутирующие actions на реальных данных не вызывались.
- Штатный bootstrap `syncPlugins` был отдельно разрешён root: обновляет только metadata двух Plugin, без enabled/settings. Код обхода bootstrap не добавлялся. После проверки runtime остановлен; listener 3101 отсутствует.

## Оставшаяся приёмка

Независимый review выявил P2 в загрузке файла общей задачи: ENGINEER+ACCOUNTANT мог передать taskId чужой общей задачи без productId, а инженерный grant ошибочно трактовал её как общий файл проекта. Добавленный regression test сначала упал (получен upload context вместо null), затем стал GREEN после разделения `taskId` и общего файла. Дополнительный тест реального POST route подтверждает 404 до storage/metadata writes. Сохранены разрешения общего файла без taskId, собственной производственной задачи и менеджмента. Повторные DB/runtime-проверки для этого исправления не выполнялись — изменённый путь проверен DI.

Независимый review и проверка точной выпускаемой ревизии на staging остаются у root. Повторная локальная проверка необходима при изменениях после review. Staging и production не проверялись и не изменялись данным субагентом. Commit/push/deploy не выполнялись; change не архивирован.
