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

Staging-приёмка ещё открыта. Без дампов/seed/reset/newDB/restic; main/production исключены. Build-only DSN и сборка не являются доказательством работы БД; такой proof получен отдельно выше.
