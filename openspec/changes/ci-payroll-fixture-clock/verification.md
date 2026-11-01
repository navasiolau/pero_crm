# Verification

02.11.2026 владелец согласовал 207, её коммит, полный CI/staging и завершение production-выпуска 202–206. Ветка создана от origin/staging ab57a442.

## Причина

CI №351 (41357673444) на ab57a442: три финансовых native-сценария получили paidCount=2 вместо 1. Domain real-COMMIT тест фиксировал часы на 11.10.2026 и сохранял настоящее начисление. В ноябре оно попало в getEmployeeDues соседнего finance файла как прошлый долг. Финансовый runtime-код относительно прошедших CI №349/350 не менялся.

## Локальная проверка

- Изменена только установка Date одного domain-сценария: следующий UTC-месяц, день 11, 12:00. Tick, COMMIT/peer/replay/UNKNOWN, пять rollback-проверок и все финансовые assertions сохранены.
- Семь календарных моментов: конец января, февраля, високосный февраль, декабрь/январь и московские границы месяца. Исполнялся фактический фрагмент из файла; payrollMonth фикстуры не раньше фактического месяца как в начале, так и после CI-бюджета 300 секунд. PASS.
- ESLint файла, строгая типизация извлечённого изменённого блока с настоящим Node TestContext, git diff --check — PASS.
- Полная локальная типизация упёрлась в устаревший Prisma client общих зависимостей (LogisticsTrip.deletedAt отсутствует в generated client). Общие артефакты не регенерировались. Полная типизация со свежим Prisma остаётся обязательным gate существующего CI.
- Runtime-исходники приложения, Prisma/schema/migrations, packages, lockfile и workflows совпадают с ab57a442. Локальные зависимости переиспользованы junction-ссылками только внутри worktree 207; новые зависимости не установлены. Локальный стенд и БД не запускались.

## CI и выпуск

Коммит 845f8388 слит обычным merge в staging 33911889. CI №352 (41360061368) прошёл 7/7: https://github.com/navasiolau/pero_crm/actions/runs/41360061368. Лог native job 125008586082 подтверждает PASS всех трёх исходно упавших cash-сценариев с неизменёнными assertions. Полная типизация со свежим Prisma в backend также PASS.

Фактический staging 33911889 принят: web/renderer имеют этот SHA и healthy, /api/health и /login возвращают 200. Контейнер/образ/PID/start time/mounts БД, proxy и конфигурация, включая W07, совпадают с baseline перед выпуском. Runtime-исходники приложения не изменились относительно ab57a442.

## Production

02.11.2026 принят 33911889f4ad70609db45fce38fdcd769d665a0d. Main получил весь принятый staging через merge --ff-only, remote main/staging имеют одинаковые SHA. CI №353 (41361010527) прошёл 7/7: https://github.com/navasiolau/pero_crm/actions/runs/41361010527.

Фактические production web/renderer имеют 33911889 и healthy. Их image IDs: web 6a39a59ee3ac53027f790e980eba85ed4203c01e26a1be00db2bfff2256108fa; renderer d43ec5dab12b65930b2379050de71211bdcfae032330afba1018f8332acad599. Контейнер/образ/PID/start time/mounts БД, proxy и конфигурационные файлы не изменились. Startup подтверждает No pending migrations to apply. Публичные HTTPS /api/health и /login — 200, database=ok.

Read-only API: полный справочник 180 клиентов вместо прежних 30; у КП №227 canChangeClient=true при canEdit=false и CONTRACT. Его ревизия 25, все 19 позиций и подпись сохранились. Договор остался на ревизии 1, settings и 11 ручных полей заказчика неизменны. Бизнес-записи для приёмки не создавались и не редактировались; прямых production DB-команд, миграций, дампов и действий с restic не было.

Журналы, native-regression proof, before/after metadata и итоговый release-result.json сохранены в ignored .playwright-mcp/production-202206-20261102 worktree 201. Задача 201 остаётся открытой и не является предком выпуска. Финальные отметки приёмки фиксируются отдельным документационным коммитом bugfix/207 после принятого выпуска; код 845f8388 уже включён в 33911889. Документационная фиксация не меняет принятый main/staging SHA.
