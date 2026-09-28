# Интеграция инженерного фонда — checkpoint 29.09.2026

## Текущий статус QA

Код готов; предыдущий полный прогон дал **346/346 CRM + 9/9 bot PASS**. Продолжаются приёмочные исправления, поэтому этот результат не является финальным повторным suite после последних изменений. Полная GUI/визуальная приёмка пока **не принята**. Root обнаружил mobile overflow у сетки фонда/кнопок и исправил его (visual RED→fix); для ошибки, где активный таймер инженера ошибочно открывал ручной ввод времени, добавлены три содержательных теста RED→GREEN. Production build для последнего исправления ещё выполняется.

Local migration №6 применена через `engineering-local-migrate.py`, SQL SHA256 `0749de41ad5bc66075084d57440e4acb027b20739492ae8f87552f18f2335266`. Protective backup receipt: `C:/Users/admin/AppData/Local/Temp/pero-engineering-migration-XAREGF/receipt.json`, 1,315,598 bytes. Архив целиком прочитан через `pg_restore --file` и проверен через TOC; восстановление не выполнялось. Проверка подтвердила неизменность 34 прежних table hashes и пустое начальное состояние четырёх новых таблиц.

На реальном PostgreSQL локально прошли 11 native checks, каждый с безусловным rollback: отрицательные/incomplete/unique guards; append-only для conversion, settlement и payroll; неполное закрытие без записей; 500 BYN без PIECE; UUID replay после DELIVERY без отката статуса; точный каталог четырёх triggers; и одинаковый полный snapshot до/после транзакции. Native proof: `.../pero-engineering-qa-local-xJSe6v/native-proof.json`. Четыре QA-прогона `xJSe6v`, `e1aWKb`, `AA3cpz`, `EAxD9J` завершены и очищены exact-owned-ID helper'ом; foreign-data fingerprints сохранены. Последний прогон включал изменение цены и таймер.

В ходе QA найден и исправлен false guard на unzoned PostgreSQL timestamps: фактическое время трактовалось как UTC вместо локального Moscow. Сохранён raw-hash без ослабления guard; корректные CLI-вызовы используют `node --import tsx`, не `NODE_PATH` override.

Staging protective backup завершён: receipt `8f1fc4d0-6200-4800-ae49-e3e50a4e57c6`, `/var/lib/pero-engineering-qa/<run>/receipt.json`, SHA256 `5315f4dafbdae1bfd1983e8723c5bcd9f7ebb48cfe35659794c27e205c17cc7f`, 1,328,081 bytes; dump SHA256 `14d483b85be2f6faddea138713a3bf87816f4ce4ad67d5f8061e1249aa58b349`, 35 tables including ledger. Dump полностью прочитан через `pg_restore --file` и сверён по TOC; restore не выполнялся. Первый backup probe остановился read-only на отсутствующей public-schema колонке запроса; dump/DDL не было. После исправления и review запроса backup завершился штатно.

Staging остаётся на app `13732b6` и schema №5; migration №6 и deploy на staging **не выполнялись**. Main/production остаются HOLD. Полный GUI sign-off и новый полный тестовый прогон после последних изменений ещё нужны.

---

## Исторический integration evidence — 28.09.2026

База ветки: `13732b696cd8928d25fb895e527c8162b679aae8`, принятый функциональный код разделения работ `614ec23128de83f16833a56443354c2707e87c60`. Владелец оставил зависимость только на staging; production backup/main/DDL не выполняются.

По уточнению владельца остановлены пять прежних дорогих субагентов. Узкие schema/split задачи переданы двум GPT-6 Luna с краткими брифами; root отвечает за решения и проверку. Рабочая ветка `codex/product-engineering-pay`, собственного подключения к БД и runtime ещё нет.

## Запрет двойной оплаты при выполнении

`product-engineering-completion.test.ts`: исходный core дал содержательный RED — три ошибки, два контрольных сценария прошли. Он начислял 1000 BYN PIECE для ENGINEERING и падал на новой работе без прежнего денежного снимка. После проверки `Work.paymentKind` до сдельных вычислений — 5/5 GREEN: семь ролей получателя, отсутствие старой цены, требования фото/факта у нулевой работы, сохранение LEGACY по классификации и повтор завершения без PIECE. После генерации Prisma-клиента также прошли все девять прежних settlement/transaction DI-сценариев: 14/14 вместе. Это DI, не проверка PostgreSQL.

## Строгий валютный снимок

`product-engineering-quote.test.ts`: новый API сначала был явной нереализованной заглушкой (7 ошибок, один проверочный сценарий), затем 8/8 GREEN. Подтверждены 1000 USD × 5% × 3 = 150 BYN, один запрос для одинаковых валют, BYN без сети, отказ неизвестной валюты, нулевого/нечислового/неточного/переполненного курса, некорректной даты и timeout. При смене валюты или дня расчёта снимок отвергается. Сумма другой валюты не подставляется. Источник подменён в unit-тестах; живой НБ РБ и финансовые записи не затрагивались.

Совместно чистая арифметика (28), quote (8) и completion (5): 41/41 PASS. Полная интеграция конфигурации/закрытия/UI ещё не выполнена; эти результаты не являются приёмкой фичи.

## Проверка схемы root

При чтении подготовленной SQL root обнаружил индексы до добавления их колонок и ошибочную нижнюю границу 1 вместо 0 у финансовой доли settlement. Также потребовал проверки валют/неотрицательного PayrollEntry и исключения PostgreSQL NUMERIC NaN. Субагент добавил три падающих проверки (4/7 до правок), исправил SQL и получил 7/7. Root повторно сверил порядок колонок/индексов, финансовый ноль и monetary guards. Prisma validate/generate прошли с фиктивным DSN без соединения; native SQL ещё не проверен. Схема не применялась ни к одной БД.

Промежуточный TypeScript обнаружил восемь мест, требующих source-aware интеграции nullable snapshots: страницы изделия/проекта, share actions/core и удаление Work. Полный typecheck/build пока не принят. Это ожидающая работа фичи, не разрешение заменить неизвестную инженерную оплату нулём.

## Разделение двух долей

Root прочитал diff ENGINEERING split и потребовал исключить даже промежуточные денежные вычисления по старым снимкам, проверить контекст остальных задач Work и допустимую роль получателя. Дополнительно проверены rollback после ошибок receipt/event и два конкурентных запроса одной ревизии. Исправления приняты; подробности в split-evidence.md. Участие нового инженера в ACL и source-aware DTO/UI ещё требуют интеграции, поэтому задача 3.3 целиком не закрыта.

Root повторил общий затронутый набор: **78/78 PASS** (28 math, 7 schema, 8 quote, 5 completion, 9 ENGINEERING split, 12 LEGACY split, 9 settlement). Ошибок TypeScript в изменённом share-core больше нет; nullable snapshots в страницах/share-actions/works-actions остаются частью следующей интеграции. Эта ветка не закоммичена как завершённая фича и не опубликована.

## Завершение интеграции кода (срез 28.09.2026)

После уточнения владельца сложные подзадачи выполняли два GPT-6 Sol; Astra использовалась только root. Фонд, конфигурация работ и задач, явная конвертация, закрытие со снимками, доступ участников, финансовые сводки и UI связаны между собой. Разделы 1–5 tasks относятся к source/unit/DI/component acceptance; native SQL и визуальная приёмка остаются отдельно в разделе 6.

Root добавил содержательные RED → GREEN для семи финансовых сценариев (валюта строки, NONE/деактивация/долг и замороженная экономика), пяти legacy-сценариев (включая конкурентное начисление и rollback), пяти действий изделия и пяти валютных guards. Исправлены прежние частичные записи статуса без начисления и включение новых фондов в старую проектную ветку.

Независимое review выявило несоответствие ledger scheme ограничению DDL, первый configure без `works` в Prisma create result, отсутствие обязательного типа новой задачи и неканонический UUID replay конвертации. Root/автор исправили их и повторили затронутые проверки. Реалистичный DI-адаптер учитывает явно запрошенные Prisma relations; сценарий сохранения 2/3, групп, снимков, времени, файлов и DAG — отдельный тест.

Root отдельно подтвердил и исправил раннее чтение чужого изделия/FX до manager-gate server action, чрезмерный запрет изменения незавершённой инженерной задачи, отображение старого piece-снимка в ENGINEERING DTO и отображение текущих имён вместо immutable settlement snapshots. Менеджер может исправить поля/назначение в DRAFT/DESIGN; смена исполнителя останавливает прежний таймер и переводит задачу в NEW, а выполненные/оплаченные данные и контекст фонда защищены. Отдельный тест проверяет точный предпросмотр копеек по всему Work budget после split.

Настройка и создание журналируются в транзакции. Стандартные task/product/payroll events и новый engineering settlement outbox сохраняются атомарно; обычные уведомления отправляются после commit. Ошибка доставки не отменяет начисление, replay не рассылает повторные уведомления. Сохраняются принятые ограничения ENGINEER+ACCOUNTANT для исполнения старых задач и независимые read grants.

Финальный прогон root: **333/333 CRM + 9/9 bot PASS**, TypeScript CRM/bot PASS, `pnpm lint` без ошибок (единственное прежнее предупреждение — неиспользуемый existsSync в scripts/cleanup-uploads.ts). Production build Next 15.5.20 PASS с `DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/not_used` и фиктивным AUTH_SECRET; БД при сборке не использовалась. OpenSpec strict validation PASS. Это ещё не native/browser/staging приёмка №6.

## Read-only инвентаризация перед разрешением QA

Скрипт deploy/acceptance/engineering-preflight.py допускает только закреплённые existing Docker IDs local/staging и выполняет BEGIN READ ONLY. Первый staging вызов остановился до SQL на DATABASE_NAME_MISMATCH: исходное предположение `pero_crm/pero` подходило только local. Отдельный Docker-only engineering-stage-metadata.py подтвердил на staging `crm/crm`, host db:5432, прежние DB ID/volume и app13732b6/S3 pero-crm-staging. Allowlist исправлен строго по этому факту, не расширен до произвольных баз.

Local: 174 Project, 1305 Product, 6449 Work, 1131 Task, 18 User, 4726 File. Staging: 184 Project, 1325 Product, 6449 Work, 1131 Task, 18 User, 4736 File. Обе БД на миграции universal_work_shares, без незавершённых миграций, PayrollEntry0/legacy coverage0, BYN. На staging потенциальных старых PERCENT_PROJECT-получателей0 и других активных транзакций0 в момент чтения. Найдены17 старых Work с неположительным количеством; они сохраняются: новый DDL не вводит запрета на количество старой LEGACY Work и ничего не пересчитывает. Контекст Task/Work согласован, старые money fields не NULL/NaN. Локальный порт3000 на момент read-only проверки не прослушивался.

Миграция №6 **не применялась** ни к одной БД. Проверенный SQL SHA256: `0749de41ad5bc66075084d57440e4acb027b20739492ae8f87552f18f2335266`. Новые QA-записи **не создавались**. План временных записей и точной транзакционной очистки с восстановлением append-only guards — qa-plan.md; предыдущего разрешения на набор №5 недостаточно для нового Product/второй Work/третьего QA User. Production и продвижение main остаются отложенными по решению владельца.

## Локальная приёмка завершена — 29.09.2026

Финальный run `38fb29ba-18bb-4389-84f4-49e2c6138a23`, private evidence `C:/Users/admin/AppData/Local/Temp/pero-engineering-qa-local-jceBX4`: полный browser PASS, 13 проверок, 15 действий, 39 снимков на 360×800 / 390×844 / 1440×900. Параллельные одинаковые запросы конвертации, split и закрытия возвращают один и тот же результат. После DELIVERY повтор исходного close UUID не меняет статус; E1 и E2 получают 404 без данных изделия, собственные расчётники доступны.

Native capture подтверждает один settlement, четыре shares/PayrollEntry и суммы E1/E2/W = 372/180/48 BYN; PIECE отсутствует. Exact cleanup удалил только 3 User, Project, Product, 2 Work, 4 Task, pool/group, conversion, settlement, 4 shares/payroll/time, dependency, 2 истории, 16 журналов, 16 events и 45 уведомлений. Повторный read-only baseline подтвердил совпадение всех 38 таблиц. Предыдущий полный run VDQzjY и все промежуточные наборы также очищены; артефакты сохранены отдельно, без переписывания результатов.

Root просмотрел основные мобильные и настольные состояния: пустая ставка, ошибка 101%, явный 0%, draft, split, инженер-участник, завершённые задачи, settled и расчётники. Суммы в таблицах зарплаты доступны через существующую горизонтальную прокрутку. Это проверка живого интерфейса с короткими подписанными QA-сессиями, не парольного входа или offline/PWA.

Обнаружены и исправлены два UI-дефекта: min-content ширина формы/длинные кнопки, а также запрос ручного времени при активном таймере инженера. Для второго сохранён meaningful RED (true вместо false) → GREEN (3/3); одна функция используется кнопкой и drag-and-drop. Итоговые CRM unit/DI — 352/352, bot — 9/9, production build и lint/typecheck PASS (прежний warning existsSync остаётся). Python guards — 39 проверок, 37 PASS / 2 platform skips на Windows; Linux CI выполнит весь набор.

Staging получает отдельную проверку точной ревизии: protective backup принят, но schema6/deploy/browser QA ещё не выполнены на момент этого коммита. Main/production остаются на owner hold. Независимое Sol-review staging транспорта нашло отсутствие связи packet.runId с plan/manifest: исправлено до внешнего запуска, 3 pure Python теста PASS. Browser window держит существующий W07 lock, прекращает новые запросы через 600 секунд, guest предел — 900 секунд; штатные cron/config не меняются. Basic Auth берётся только в память из сохранённого handover, его bytes/SHA не изменяются.

CI #52 (9b69ec8) воспроизвёл Linux-only RED в pure source-guard test: Windows cwd сравнивался с фактическим Linux путём модуля. Исправлено явным path.win32 для закреплённых Windows root/cwd; реальный Linux запуск локального QA по-прежнему запрещён platform guard. Пять профильных тестов PASS локально. Оба image publish jobs были skipped — автодеплой корректно не получил непрошедший образ. Следующий CI проверит исправление на Linux.

CI #53 (a1a74fa) остановился на прежнем Linux timeout-тесте watcher: /proc/<pid>/stat исчез во время чтения, ProcessLookupError. Исправлен только тестовый probe: отсутствие процесса и zombie считаются остановкой, PermissionError и прочие ошибки не скрываются. Local Python: 42 tests, 40 PASS / 2 platform skips; watcher runtime/config не изменены. Образы снова не публиковались. GitHub evidence: https://github.com/navasiolau/pero_crm/actions/runs/36493137796 .

Read-only probe прежнего staging image подтвердил отсутствие внешнего @auth/core/jwt в standalone runtime. До создания staging-фикстуры JWT включён в reviewed QA bundle (как в принятом runner №5), external оставлены только Prisma/Argon2. Новый regression сначала RED, затем 3/3 профильных теста GREEN; CRM runtime dependencies и авторизация не менялись.
