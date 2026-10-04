# Приёмка исправления процентной оплаты23

## Source и scope

- Основа fresh origin/staging `d9aefd70a0bee8ebeb6d1ad68e843b7289aaf091`, отдельная ветка `bugfix/23`.
- Одобренный владельцем план04.10.2026: без классификации Work/Task; ENGINEERING от1шт, ASSEMBLY/INSTALLATION отпартии; прошлые начисления неизменны, без денежного backfill.
- Новая миграция `20261004120000_simplify_product_percentage_accrual`: BEGIN/COMMIT, совместимая ветвь CHECK версии3, старые ветви1/2 сохранены.

## Локальные проверки source

- Domain meaningful RED:14 tests,8 PASS/6 FAIL → GREEN14/14. Итоговый domain/regression набор54/54 PASS.
- UI behavioral RED:2 FAIL → GREEN36/36, включая настоящий SSR отсутствия старой классификации, инженерную сумму50 при цене1000/количестве3/ставке5%, ordinary save/ACK safeguards.
- Первый общий запуск1175/1182 PASS; после завершения нового query fixture следующий1176/1182 PASS. Оставшиеся6 ошибок — старые test doubles без ProductStatusHistory и ожидание старой инженерной формулы. Production guard не ослаблялся; faithful fixtures исправлены, focused16/16 PASS.
- Финальный общий набор **1182/1182 PASS**, TypeScript PASS. ESLint0 errors/1 прежний unused assertManager warning; diff check PASS; strict OpenSpec PASS.
- Независимый source review: конкретных P0/P1/P2 замечаний нет. Проверены domain/query/live preview, frozenv1/v2, removedclassification/coverage, no-retro и SQL CHECK.
- Source-only SQL/schema проверки9/9 PASS после добавления явной транзакции. Это не заменяет настоящий native/DB proof.
- Production build PASS с build-only DSN. Первый запуск упал в неизменном next/font/google parser на URL шрифта; свежая загрузка обычного Roboto вернула реальные WOFF2 URL и данные, повторный стандартный build прошёл. Font/layout/dependencies и mock responses не менялись.

## Runtime и выпуск

Existing local `pero_crm` проверена: атомарно применена только task23 CHECK migration, exact ledger SHA `a8250b813ce60d5c3f4e93e9fc60c1223ff8494b925f6c515a4500a32708aed6`. Прежние48 business tables не изменились; unrelated finish-removal migration не применялась. Native receipt `c30c8bf6` PASS7: полный цикл без Work/Task50/120/210; незакрытая NEW Task остаётся NEW без таймера/TaskPayroll; Engineer quantity1/7 даёт50; v3 replay frozen; прежний v2 инженер150 и Payroll, а также v1 сохранены; prior status/history исключает retro; настоящий SQL CHECK принимает/отклоняет формы3. Forced OUTERROLLBACK: persisted0/outbound0, все49 таблиц и схема после миграции MATCH. Первый native helper имел private fixture typo changedAt вместо фактического createdAt; исправлен только fixture, старый результат не выдаётся за PASS.

## Staging

- Implementation commit `412b09e0737afc0c4e927df0056833e7c18c3366`; обычный merge/push staging `9b5ac3127bfc152ccbad33dee782e4623ddc6252`. CI115 SUCCESS: https://github.com/navasiolau/pero_crm/actions/runs/37191411612.
- Actual deployment receipt `task23-stage-deployment-2c1d67a2-76c0-4176-a334-f505e35219ab/receipt.private.json`, SHA `8f7bb958b179f9a0dfd57815be5cf9cb39ecea754c5b0a5b398068a734beb13d`: source9b5, web10173bd7/OCI3941921b, public health200, прежний DB/volume/W07. Canonical Git migration checksum `d1b18fa0f960e811eda26fb8ecf5ef5034514672a5d45bdeb606c4954b1d6137`; local raw Windows checksum выше не подменяет canonical staging proof.
- Stage native receipt `task23-stage-native-cc78feec-755e-49cc-a9d0-290d23c75c2e/receipt.private.json`, SHA `2258eb76a732eba8f4543b28ac255ebb621192c09074249a218cd02e8c996396`: настоящие7 сценариев PASS, original46 tables/schema MATCH после forced OUTERROLLBACK, persisted0/outbound0.
- Первый hosted UI attempt остановлен до браузера на private MODULE_NOT_FOUND; fixture полностью очищен. Следующий `4c0436b3` STOP/protocolStop:5 rejected same-origin GET receipts, aborted before upstream. Cleanup SHA `be238abbce27f240a1dc85c69dc039213814c8d76e0a67413847d3dfc436bcfc` подтверждает original data/schema/actors/preferences MATCH и ownRowsAbsent. Эти STOP не являются whole-wrapper PASS.
- Независимое чтение подтвердило deployment/native/cleanup и Manager auth, но прежний STOP не содержит stack/line или отдельных DOM results. Поэтому DOM-значения/отсутствие классификатора по этому JSON не заявляются. Выполнен один короткий Manager-only повтор с записью реальных locator observations, без расширения сетевых разрешений.
- Actual Manager milestones сохранены в `task23-hosted-ui-e8deb92c-0cee-4691-9dce-8d5ed68f48f3/manager-observations.private.json`, SHA `84b1fbee7a775f133d24eec0adb2cea7ae63770b99304f4a1a3b7beac9ca5dc8`: actual auth200/id/roles, три видимые rows count1, фактические предварительные50/120/210 BYN, literal «Проверка прежних работ» и проверенные признаки классификации отсутствуют, обычная Work видна.
- Новый whole hosted wrapper честно остаётся STOP из-за aborted unknown same-origin GET; он не заявляется PASS. Engineer-only browser pass не выполнялся. Эти ограничения не препятствуют подтверждённым отдельным Manager milestones, покрывающим focused UI критерий задачи. Provider sends0, save/status/payroll actions в browser не выполнялись.
- Exact fixture cleanup нового прогона: `failed-attempt-cleanup.private.json`, SHA `be238abbce27f240a1dc85c69dc039213814c8d76e0a67413847d3dfc436bcfc`; original data/schema/actors/preferences MATCH, ownRowsAbsent. Независимый file reviewer подтвердил SHA, размещение recorder ПОСЛЕ настоящих auth/DOM assertions и очистку на той же9b5 ревизии.
- Все10 пунктов change выполнены. Функционально принят staging SHA `9b5ac3127bfc152ccbad33dee782e4623ddc6252`; дальнейшая фиксация этого отчёта меняет только документацию, не executable source/migrations.

Без дампов/seed/reset/newDB/restic; main/production исключены. Build-only DSN и сборка не являются доказательством работы БД; настоящий proof получен отдельно выше.
