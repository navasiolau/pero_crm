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

## Исправление по независимому review

Независимый review выявил P2 в загрузке файла общей задачи: ENGINEER+ACCOUNTANT мог передать taskId чужой общей задачи без productId, а инженерный grant ошибочно трактовал её как общий файл проекта. Добавленный regression test сначала упал (получен upload context вместо null), затем стал GREEN после разделения `taskId` и общего файла. Дополнительный тест реального POST route подтверждает 404 до storage/metadata writes. Сохранены разрешения общего файла без taskId, собственной производственной задачи и менеджмента. Повторные DB/runtime-проверки для этого исправления не выполнялись — изменённый путь проверен DI.

На этапе feature-worker staging и production этим субагентом не проверялись и не изменялись; commit/push/deploy тогда не выполнялись. Последующая приёмка интеграции root приведена ниже. Мутирующие действия на staging не выдаются за проверенные: соответствующие негативные пути покрыты локальными DI-тестами.

## Первая волна: интеграция и staging — 28.09.2026

Проверена ревизия `a1123c5f8a498dc916a67e609a4a550720367fc2`. [Staging CI #46](https://github.com/navasiolau/pero_crm/actions/runs/36422255188) завершился успешно; штатный cron развернул её в 12:40:31 UTC. Приложение healthy, DB identity сохранена. Этот раздел фиксирует уже выполненную root приёмку; новых runtime/DB операций при его подготовке не было.

- Существующая локальная БД: итоговый integration-прогон `590386f3-1802-4f76-bb81-047d76f8de1e` дал 8/8 PASS, exit 0; четыре UI-предпочтения возвращены CAS, restoreConflicts пуст, бизнес-счётчики совпали. Источник: `.playwright-mcp/local-list-acceptance/590386f3-1802-4f76-bb81-047d76f8de1e/result.json`.
- Staging read-only run `82bb11a9-73d1-4e90-aecd-7ca1d8772dce`: 13 PASS и 1 NOT_AVAILABLE на реальных 1325 изделиях/184 проектах. Проверены страницы своего DESIGN/чужого изделия и видимость менеджеру, поиск и клиентская область, structured list/client props, скрытый файл и превью с отказом до storage, разрешённое чтение существующего малого файла. Counts и hashes 13 бизнес-таблиц + ChangeLog/TimeEntry совпали до/после.
- Семь существующих чистых ролей прошли session/home checks. M+E на staging отсутствует: для неё NOT_AVAILABLE, учётки и роли не создавались/не менялись. Совмещённая роль прошла локальную матрицу восьми существующих наборов ролей.
- В браузере инженерный landing и свои DESIGN прошли на 360, 390 и 1440 px. Общие 12 сценариев первой волны завершены в двух прогонах: четыре на 360 px в `5e5af0c2-481e-4976-882a-8f4f7245288c`, затем восемь на 390/1440 в `b56c73bb-6648-4934-b4a7-0d07175ba1b2`. Первый из этих run целиком имеет FAIL из-за следующей native-session проверки на 390; после каждого run prefs восстановлены и 15 hashes совпали. Единого 12/12 run не было.
- Public HTTPS и Basic Auth прошли на отдельном браузерном этапе. Сессии подписаны для существующих пользователей; парольный вход — NOT_TESTED. Поле NOT_TESTED для public Basic Auth в read-only receipt относится к внутреннему HTTP-прогону.

Источники staging: `.playwright-mcp/staging-first-wave/<runId>/readonly-result.json`, `browser-result.json`, `restore-result.json`. Исторический `b761bc98-6e3b-4ce9-9e15-58e4703c5d31` не считается успешной QA: потерянные response bodies не позволили доказать ownership ревизии, поэтому две канонические manager-настройки `view=kanban` сохранены как принятый default baseline. Побайтовое восстановление этого первого run не утверждается; дальнейшие четыре ключа возвращались точно. Подробная disposition и исправление capture QA описаны в evidence `persistent-list-filters`.

После принятой QA root отправил a1123c5 в main. [Main CI #47](https://github.com/navasiolau/pero_crm/actions/runs/36428827890) завершился SUCCESS, все три jobs зелёные. Root подтвердил production этой ревизии: web started `2026-09-28T13:35:26.80154508Z`, scheduled watcher `13:40:05.434559 UTC` — `unchanged`/healthy, штатный HTTP health — 200. DB ID/startedAt/mount прежние; прямой production SQL не выполнялся. Снимки: [staging deployment](../../../../deploy/evidence/2026-09-28-first-wave-stage-deployment.json), [production](../../../../deploy/evidence/2026-09-28-first-wave-production.json).

Основные specs синхронизированы, change архивирован 28.09.2026. В Git включается только эта сводка, без PII, checkpoints, JWT и скриншотов.


## Завершение OpenSpec

28.09.2026 основной агент сверил все требования и сценарии с основными спецификациями, выполнил strict validation и архивировал change после принятой локальной, staging и production приёмки.
