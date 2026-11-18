# Staging acceptance

## Authorization and scope

19.11.2026 владелец поручил довести задачу №235 до staging и уточнил постоянный порядок: согласованные изменения завершаются реальной staging-приёмкой. Коммит, push, обычный merge и штатная staging-миграция входят в поручение. Main/production не входят.

## Integration history

- Функциональный коммит: `0b233df0`, обычный merge в staging: `665d6bcbeb4c1c8019d852698f0fede77dd87550`.
- Первый [CI №400](https://github.com/navasiolau/pero_crm/actions/runs/44421428864) остановил публикацию: новый native-сценарий контактного лица PASS, но ранний import его helper затронул обвязку пяти существующих проверок транзакций. Обе component-когорты, backend и renderer прошли; publisher jobs были skipped, staging сохранил прежний образ.
- Исправление `ffb56352` в той же ветке задачи: helper загружается через существующий `guardedModuleCache` после установки тестового контекста. Прикладной код поля и миграция не меняются. Обычный повторный merge — `cbf498ec5586b847563a6fffd125e95b295a432a`.

## Guard verification

Первый вызов общего исторического wrapper остановлен до выполнения тела с `DATABASE_IDENTITY_CHANGED`: он ожидал сентябрьский StartedAt. Read-only metadata подтвердили прежний DB ID `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, время старта `2026-11-10T18:42:15.758341834Z`, прежний volume `crm-staging_pgdata` и SHA W07 `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139`. Это совпадает с принятыми receipts задач №222 и №234.

Для дальнейшей приёмки выбран существующий актуальный reviewed transport этих выпусков: он проверяет точные DB ID/StartedAt/volume, staging host/compose/networks, приватную web/renderer-пару, revision и W07. Guards не отключались; конфигурация сервера, cron и БД не исправлялись вручную.

## Preservation baseline

До миграции: 307 клиентов, 302 проекта, 5529 записей ChangeLog. Снимки данных клиента и проекта исключают лишь два новых поля, чтобы сравнивать сохранность прежних значений после добавочной миграции. Новых полей/миграции на исходном staging ещё не было.

Функциональные изменения данных проверяются только собственными синтетическими записями внутри rollback-транзакции. В реальном браузере проверяются интерфейс, отмена несохранённого переключения и настоящие Server Actions с неизменными значениями (no-op); существующие бизнес-записи намеренно не редактируются.

## Result

**ACCEPTED** на фактическом staging `cbf498ec5586b847563a6fffd125e95b295a432a` после [CI №401](https://github.com/navasiolau/pero_crm/actions/runs/44422704220), **7/7 SUCCESS**. Штатный watcher выполнил выпуск; entrypoint применил `20261118090000_project_contact_person`. Проверены две новые колонки, boolean default false и nullable text, завершённая миграция без rollback marker. HTTP health — 200.

Web image: `sha256:660bdcc1bb19c4b52f22007e27fa90ec6eef947e8cdb34184867279b4fa81f37`; renderer: `sha256:89dd1ee6e714f492f7c677009a3b13b888de8f48495c5ff3024c21105fcd0559`. Оба healthy, revision и CI run labels совпадают. DB ID/StartedAt/image/volume и W07 сохранились.

Native-проверка в реальном staging-контейнере: **12/12 групп PASS**, создание из проекта и КП, заполнение пустого/сохранение ручного и удалённого, ФИО/очистка/снятие, смена клиента, no-op, CAS/replay, права, старый input и SQL rollback при отказе аудита. Полный snapshot строк и каталога совпал до и после rollback. Для DB-only probes использована прежняя fail-closed граница Next cache: попытка входа в HTTP cache прекращает probe. Пакеты plugin-sdk/demo включены в проверочный bundle из тех же исходников; образ или зависимости staging вручную не менялись.

Настоящий HTTPS-браузер staging: **1440 и 390 px PASS**, поле editable и расположено рядом с телефоном/под телефоном, галочка editable, несохранённое переключение отменяется. Server Actions `patchProject` и `updateClient` прошли с явным no-op; чистый ENGINEER получает forbidden. Ошибок браузера и заблокированных неожиданных POST нет. Лично просмотрены актуальные PNG строки проекта и мобильной галочки. Это адаптивный Chromium, не физический телефон.

После всех проверок прежние данные полностью совпали с baseline: **307 клиентов, 302 проекта, 5529 записей ChangeLog**, hashes сохранены. Флаг у прежних клиентов выключен, контактное лицо прежних проектов пусто; тестовые записи не остались. Секреты, JWT, PII и PNG хранятся только в ignored `.playwright-mcp/task-235`; сводка без них — [staging-acceptance.json](staging-acceptance.json).

Main остаётся `81ec6e8589a057afd00e8bf076fdd332ee7cc5e1`. Production, restic, дампы, seed/reset и внешние коммуникации не использовались. Последующий документационный SHA не подменяет этот принятый функциональный runtime SHA.
