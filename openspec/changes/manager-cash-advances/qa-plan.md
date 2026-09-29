# Cash advances QA plan — локальное выполнение и staging acceptance

Этот план описывает выполненную проверку на **существующей** локальной БД 5433 и изолированном staging. Миграция `20260929120000_manager_cash_advances`, ограниченная native/browser приёмка и exact-ID cleanup завершены на обеих целях; staging дополнительно доказал положительную USD-выдачу. SQL adapter `cash-qa-adapter.mjs`, opt-in `cash-native-acceptance.ts` и local backup/migration runner `cash-local-migrate.mjs` сохраняют точные guard. Правила остановки: `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`; при несовпадении цели, guard или снимка — STOP без исправления наугад и без автоматического повтора.

## Наблюдённое выполнение

- Local migration совпала с закреплённым ниже SQL SHA; backup `Temp/pero-cash-migration-gT2XSQ/receipt.json`, TOC и полное чтение архива прошли без restore в БД. До миграции старых Payout было 0; все девять новых nullable-полей остались `NULL`.
- Local run `a1677358-663c-4d50-8dc8-d84f3de04680` проверил 120 BYN через форму с параллельным повтором UUID `[false,true]`, 200 BYN обычную выплату, 10 BYN/удаление/отказ повтора, роли и UI. Из-за доказанного VPN/TLS-отказа USD local positive освобождён владельцем **только для local**. `PARTIAL` graph `16e94906ed5f6b7af12b262262eda52405250ac5371017c8218182515bf6e663`; 27 exact-ID строк удалены, baseline 38 таблиц восстановлен.
- Staging run `8d7055e1-560a-4c0d-969a-b2f6193deaa2` подтвердил положительные 120 BYN/200 BYN/**50 USD**, удаление и отказ повтора 10 BYN; `FINAL` graph `eecd7f7559945c2301ebe9254820589d2eedc818a09d133f0ed5cfc7d0876a8b`. Root просмотрел четыре UI PNG. 34 exact-ID строки удалены; независимый post-commit read-only snapshot имеет `changedTables=[]`.
- Native SQL `23514`, отказ неактивному/overdraft и ожидание общего advisory lock подтверждены. Mixed-writer гонки выполнены в DI на реальных денежных функциях; native смешанная гонка не заявляется. Последний полный QA-прогон: 448 web, 9 bot, 62 Python PASS + 2 Windows skip, TypeScript/lint/OpenSpec strict PASS. Build **runtime commit `3f6da0da082cc707370346c9c3a458ba24d1c189`** прошёл ранее; после QA-only helper/evidence изменений его не повторяли.

Подробные receipts и границы доказательства — в `review-evidence.md`. Приватные QA-папки содержат hashes/cookies/password hashes; не выводить их целиком. Main/production остаются HOLD.

## Закреплённые цели и SQL

| Цель | Проверяемая идентичность |
| --- | --- |
| Local | `EXISTING_LOCAL`, container `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, `127.0.0.1:5433/pero_crm` |
| Staging | `EXISTING_STAGING`, container `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, guest `crm-staging`, `db:5432/crm` |

SQL-файл: `apps/web/prisma/migrations/20260929120000_manager_cash_advances/migration.sql`; SHA-256 **`BFA8D8A59B67EC027E67602A824A71EB98E473B57AAD35E181EEAA1F852870DD`**. Перед любым применением сверить байты файла и checksum миграции с этим значением; при изменении файла план перестаёт быть действительным. Ни main, ни production в эту проверку не входят.

До подготовки для каждой цели отдельно получить read-only снимок схемы и `to_jsonb(t)::text` **всех** бизнес-таблиц, сохранить SHA-256 отсортированного сырого JSON каждой таблицы. Текущий список — 38 моделей Prisma. Если уже присутствуют таблицы состава, можно явно включить только `ProductCompositionRevision` и `ProductCompositionItem`; любое другое имя, лишний столбец или изменение schema hash останавливает работу до пересмотра плана. `ApiToken`, `OrgSetting`, уведомления и журналы также входят в полный снимок: никаких исключений по возрасту, названию или времени. `payrollCurrency` должен быть BYN (или отсутствовать, что в CRM означает BYN); менять настройку нельзя. Проверить выбранного существующего клиента, действующих менеджера и финансового исполнителя, активные плагины с `payroll.payout` hooks и получателей `payroll.orgPayout` с предпочтениями. Если plugin side effects невозможно точно приписать прогону, GUI-сценарий не запускать.

## Зарезервированные ID

Перед миграцией каждой разрешённой цели root сохраняет защитный `pg_dump` существующей БД, checksum, TOC и результат полного чтения архива через `pg_restore --file`. Это проверка читаемости архива, не тест восстановления. Backup не означает разрешение на restore/reset. На staging backup, миграция и QA согласуются с действующим W07 lock; расписание refresh и автодеплой не выключаются. После добавления девяти nullable-полей проверяются прежние Payout по всем исходным полям (новые поля исключаются из сравнения и обязаны быть NULL), суммы по месяцам/сотрудникам и полные отпечатки остальных таблиц. Разрешено лишь добавление одной записи в migration ledger, без failed migrations. Несоответствие прекращает выпуск; production backup не выполняется.

ID выделены только для этого плана, не означают существование строк. Для каждой цели после read-only baseline записать отдельный приватный durable plan с этими ID, выбранными существующими actor/client IDs, schema hash, всеми table fingerprints, Argon2-хешами тестовых пользователей и `cashPlanSha256(plan)`. Сверить записанный файл повторным чтением перед `prepare`; пароли в публичные отчёты не включать. `Project.numberInt`: local `-2147483001`, staging `-2147483002`; перед подготовкой проверить отсутствие совпадений `id`, email и номера проекта.

| Назначение | Local | Staging |
| --- | --- | --- |
| runId | `a1677358-663c-4d50-8dc8-d84f3de04680` | `8d7055e1-560a-4c0d-969a-b2f6193deaa2` |
| Project | `f7b48bfc-08de-4740-90ec-3cf209038525` | `eac09ada-aecc-44be-b159-1cf7de2cf00e` |
| active NONE User | `96a0aa21-25aa-4b8a-adc8-1af2e3c5813b` | `f7f65efa-8c95-42da-b5d7-6f878b68affc` |
| inactive NONE User | `9088c3a2-7071-4eb3-9268-e29b93d69993` | `722556c6-5784-4008-bfe0-ac0cfab5d777` |
| BYN CashAccount | `ffd0e2c3-0815-4d85-84a3-a0eb1ff1244d` | `994f8cb7-601c-48c3-8334-534ee859c0cf` |
| USD CashAccount | `8ce42d32-321c-4398-8b52-042b5a438c97` | `fc94ed3f-5fa6-4068-b291-6ab22b722be9` |
| BYN Payment | `54d42f90-8fcc-49c8-8337-1d8d6c2fc4c1` | `8fe27073-70a1-4e90-a3d8-23a92de81f2d` |
| second Payment | `546cb409-d9b6-492e-aa37-e6ed224787f0` | `79d01c1c-e1b0-4c81-a473-c1b10038a565` |
| prior PayrollEntry | `f442aee5-1112-43ac-a4b2-9f6a87f5f145` | `a44affe7-80ee-4e41-8320-6a2fdb46bb86` |
| 120 BYN advance request | `75f151d3-8df6-405c-a4df-98b000ec3049` | `70d35482-e2c9-4429-b352-f85bd351a82b` |
| 200 BYN salary request | `f1b70254-6da7-4c33-9d6d-35e4a03a4adc` | `e4f0897b-8b90-42a8-b929-b91062188cf5` |
| 50 USD advance request | `fac0a6de-9ba9-4889-a76f-9d7f7ddc427a` | `d4b34f62-5db9-47e0-96f2-b482a8407d02` |
| 10 BYN/delete request | `79ebd916-4de4-49e6-b8af-2929e4038d1c` | `25d5e1ad-101c-405d-8f94-5dd6876c8c3b` |

## Подготовка и сценарии

`prepare` создаёт ровно **8 строк**: один проект без изделий на существующего клиента, двух пользователей `WORKER`/`payScheme=NONE` (один активный, один неактивный), две активные кассы BYN/USD, два `INCOME` по 1000 единиц и одно начисление **500 BYN за прошлый расчётный месяц** неактивному пользователю (`taskId/productId/settlementShareId=NULL`, `scheme=PIECE`). Все имена, email, номер проекта и комментарии содержат `QA-CASH` + runId. Действующих пользователей, клиента и `OrgSetting` не менять. Никаких инженерных settlement и отключений триггеров.

Первый приход — 1000 BYN в BYN-кассу. Второй — **1000 USD** в USD-кассу только при полученном на дату операции реальном курсе НБ РБ; план сохраняет курс, дату и SHA-256 ответа, а `Payment.rate`, `bynAmount`, `projectAmount` должны им соответствовать. При недоступном курсе выбрать режим `BYN_FALLBACK`: второй приход 1000 BYN в BYN-кассу, `rate=1`; USD-касса остаётся пустой, валютный GUI-сценарий выполняется только в DI. Подставной USD-курс запрещён.

После `INITIAL` снимка провести максимум четыре операции GUI в порядке: менеджер выдаёт активному пользователю аванс **120 BYN** с описанием работы; финансовая роль выплачивает неактивному пользователю **200 BYN** из его долга 500 BYN; при режиме USD менеджер выдаёт активному пользователю **50 USD**; затем аванс **10 BYN** активному пользователю повторить тем же UUID (без новой записи), удалить финансовой ролью и повторить тот же UUID ещё раз (ответ «Операция отменена»). Описания **каждого** аванса и комментарий зарплатной выплаты обязательно содержат `QA-CASH` и runId; этот маркер проверяется в теле уведомлений наряду с типом и получателем. Полученный из action `payoutId` записывать в durable capture вместе с соответствующим заранее известным UUID; receipt обязан подтверждать ожидаемых actor, kind и payee, без подбора по имени, сумме или времени. Текущий месяц допустим как метка зарплатной выплаты, но долг берётся только из прошлого начисления.

Массовое «Рассчитать всех» на настоящей базе разрешено только если read-only список всех имеющих положительный долг содержит **ровно ID неактивного QA-пользователя**. При наличии любого реального должника — только DI-проверка, без массовой записи. Такой GUI-сценарий не входит в указанные выше 4 выплаты и расчёт итогов.

| Состояние | USD mode | BYN fallback |
| --- | ---: | ---: |
| После `prepare` | Project 1, User 2, CashAccount 2, Payment 2, PayrollEntry 1; Payout 0 | те же 8 строк |
| Создано Payout за весь сценарий | 4 | 3 |
| Payout осталось после удаления | 3 | 2 |
| `ChangeLog` issue receipts / delete audit | 4 / 1 | 3 / 1 |
| `DomainEvent payroll.payout` | 4 | 3 |
| Личных `Notification payroll.payout` активному QA-получателю | 3 | 2 |
| Организационных `Notification payroll.orgPayout` | сумма разрешённых финансовых получателей по каждой операции, кроме автора | та же формула |
| Остаток BYN-кассы / USD-кассы | 680 BYN / 950 USD | 1680 BYN / 0 USD |
| Долг неактивному QA-пользователю | 300 BYN | 300 BYN |
| Дельта общего BYN-сальдо | `1000 + round2(1000×USD rate) − 320 − round2(50×USD rate)` | 1680 BYN |

Повтор и удаление не добавляют `PayrollEntry`; у двух QA-пользователей остаётся только исходная запись на 500 BYN. Любое отличие суммы, snapshot курса, валюты, числа событий, состава адресатов или чужого бизнес-хеша — FAIL, а не частичная приёмка.

## Захват, adapter и очистка

`ABSENT` снимок фиксируется до fixtures, `INITIAL` — сразу после 8 строк, `PARTIAL` — после каждого подтверждённого действия или сбоя, `FINAL` — после всех применимых сценариев. Helper отдельно проверяет QA-only кассы, долг, дельту BYN, отсутствие нового начисления, receipt `payout-issue:<known-request-UUID>` даже для удалённой выплаты, один event на создание и точные ID уведомлений. `FINAL` требует отдельные read-only измерения `bynCash`, `usdCash`, `inactiveDue`, `orgDeltaByn`; проверка owned-graph hash и всех foreign raw-JSON fingerprints повторяется перед cleanup. Если действия или доставка событий ещё идут, cleanup закрыт.

**Контракт подготовленного SQL adapter:** до любого чтения и записи проверить live target/container/guest, БД, checksum миграции и schema hash. `prepare` и `cleanup` выполняются в одной транзакции `ReadCommitted`: сначала `pg_advisory_xact_lock(18435,55001)`, затем `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` **всех закреплённых бизнес-таблиц** в фиксированном порядке, затем все проверки и записи. `baseline`/`capture` — только read-only snapshot; никаких скрытых записей. Каждый `INSERT`/`DELETE` использует параметры и точные ID из durable plan/capture, сверяет фактический SQL rowcount с ожидаемым и прекращает транзакцию при расхождении. `cleanup` удаляет Notification, ChangeLog, DomainEvent, Payout, PayrollEntry, Payment, CashAccount, Project, User только по доказанным ID; чужие строки и настройки не затрагиваются. После commit повторный read-only снимок обязан совпасть с baseline по всем таблицам. Никаких auto retries, broad delete, seed/reset, SSH/Docker-команд или переключений production.

SQL adapter и native entrypoint проверены на закреплённых целях. Смешанная гонка разных writers подтверждена DI, native доказано ожидание общего `pg_locks` lock и параллельный повтор одного UUID, но не реальная mixed-writer гонка. Staging подтвердил полный USD/`FINAL` сценарий; чистые тесты guards сами по себе не считались native/UI доказательством.

## Текущий checkpoint выполнения — 29.09.2026

Плановая таблица выше по-прежнему задаёт **полный USD-сценарий для staging**. Локальный plan остался в режиме USD: 8 исходных QA-строк включают реальный USD-приход 1000 по курсу НБ РБ `3.025700`, план SHA `028aadb1b0ef01cbf272729c4adb7734f9a48e5fbed020ff2166025e6623e37c`. После успешных 120 BYN аванса и 200 BYN зарплатной выплаты локальный 50 USD аванс получил явный отказ от внешнего FX; read-only receipt/graph proof показал **нулевой write set**. Node HTTPS и Windows Schannel к НБ РБ одновременно дали TLS-сбой, staging Linux GET дал HTTP 200. Владелец уточнил: «локально не работает из-за включенного VPN, теста только на staging для этого достаточно». Это **только исключение локальной позитивной USD-выдачи**, без подмены курса, переключения mode и повтора того же UUID; staging должен выполнить положительные 50 USD и полный `FINAL`.

Для локального варианта с явным `local-usd-exception.json` разрешён следующий порядок: после зафиксированного USD-отказа — 10 BYN аванс, удаление финансовой ролью и отказ повтора после удаления; финальный локальный снимок остаётся `PARTIAL`, а не `FINAL`. Плановые независимые суммы: **680 BYN / 1000 USD** по QA-кассам, долг **300 BYN**, дельта организации `1000 + round2(1000×3.025700) − 320 = 3705,70 BYN`. Фактический graph hash после этих действий — `16e94906ed5f6b7af12b262262eda52405250ac5371017c8218182515bf6e663`; чужие raw-JSON fingerprints совпали с baseline. После пяти read-only UI-попыток последняя проверила M/WORKER/ACCOUNTANT права и суммы без денежных POST, root осмотрел экран и убедился в совпадении графа до/после. Foreground-приложение остановлено с проверкой PID/порта. Cleanup по этому owned graph выполнен под общим lock и удалил точно 27 QA-строк (10 Notification, 4 ChangeLog, 3 DomainEvent, 2 Payout, 1 PayrollEntry, 2 Payment, 2 CashAccount, 1 Project, 2 User); после commit подтверждён исходный baseline всех 38 таблиц. Это завершает **локальный ограниченный вариант**, не заменяет полный USD `FINAL` на staging.

На staging защитный backup под W07: run `667367d7-83e5-40f1-b06b-b57889170685`, receipt SHA `ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e`, TOC и полное чтение архива PASS; restore в БД не делали. Root отправил commit `3f6da0da082cc707370346c9c3a458ba24d1c189` в staging; после зелёного [CI #57](https://github.com/navasiolau/pero_crm/actions/runs/36538955309) штатный watcher автоматически развернул образ и additive миграцию, без ручного deploy. Сохранены 37 иных таблиц, доказано только служебное изменение `OrgSetting.updatedAt` и девять `NULL` полей старых Payout. Первый QA run `0d4bc0e8-b3e1-46fa-809a-6e7051391e5c` остановился на `ApiToken.lastUsedAt`; read-only forensic доказал отсутствие восьми QA-строк/четырёх receipt, старый run остался неизменным. Новый plan SHA `4433895a161bdca118946ca942563f92f6b3193a474903bb11979d01c261c8cf`, runId указан выше; только аттестованный staging QA fingerprint исключает этот service timestamp, local и остальные поля строги. Первая форма в сохранённом state `Dea82Y` с одной test-cookie получила HTTP 200 JSON без пользователя и оставила `INITIAL` graph неизменным, денег не записала. Test-only переход на две точные stage cookie и новый seal/state `zFOTng` с byte-identical семью файлами (без нового `prepare`) прошёл read-only GET exact MANAGER/`PAGE_VISIBLE`; CRM-auth runtime не меняли. Затем 120 BYN (параллельный UUID `[false,true]`), 200 BYN, 50 USD при сохранённом курсе 3.025700 и 10 BYN/удаление/отказ повтора подтверждены отдельными captures. `FINAL`: 680 BYN / 950 USD, долг 300 BYN, дельта организации 3554.41 BYN, graph `eecd7f7559945c2301ebe9254820589d2eedc818a09d133f0ed5cfc7d0876a8b`. После 34 exact-ID удалений root независимо подтвердил post-commit read-only `changedTables=[]` для всех 38 baseline fingerprint (`postcleanup-verified.json`, `2026-09-29T09:32:58.914Z`). Main/production HOLD; rollback на старый код после cash-linked выплат запрещён.
