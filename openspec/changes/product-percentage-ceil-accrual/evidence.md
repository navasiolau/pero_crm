# Evidence

## Завершённая приёмка staging — 05.10.2026

Владелец разрешил commits/staging. Ветка bugfix/77 интегрирована обычным merge; функциональная приёмка выполнена на образе ревизии fd1a371610d8aa49f370f428911254040974d71e (healthy). CI/CD #127: https://github.com/navasiolau/pero_crm/actions/runs/37334434678 — Success.

На фактически развёрнутой БД применена миграция 20261005120000_product_percentage_ceil_accrual. Нативная проверка actual core/query/preview/payroll для всех трёх ролей PASS: ceil без промежуточного округления, количество, tiny/zero, overflow, replay, исторические версии1–3 и immutable/SQL CHECK. Тест прошёл внутри outerROLLBACK: persistedRows0, outbound0, allOriginalRowsMatch=true, schemaRestored=true. Отдельный ранее выполненный тест существующей local БД также PASS; local/staging dumps отсутствуют.

Объединённая локальная проверка:1245/1245 тестов, typecheck/lint/build и OpenSpec strict PASS; component browser review27/27. После миграции и UI-приёмки хеши всех45 бизнес-таблиц staging совпали с исходными, колонок не меняли; изменился только предусмотренный CHECK и запись миграции. W07 и существующий volume БД сохранены. Дампы не создавались, restic не использовался. Main/production не выпускались.

Протоколы находятся в D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f: stage-native.json, stage-before.json, stage-after.json, stage-final.json, stage-ui-receipt.json; browser review и PNG — в review/. Завершающий коммит этого change содержит только tasks/evidence; исполняемые файлы остаются принятыми на fd1a371.

## Предшествующая локальная проверка

База:8c37e5c637b6a44a14e7b529702303b8486b94bb,fresh origin/staging05.10.2026.
Ветка:bugfix/77. Scope/OpenSpec согласованы владельцем до реализации.

RED12/23,FAIL11 → full1239/1239,typecheck/lint/build/strict PASS. Native existing local pero_crm5433 PASS: actual status/core/query/preview/payroll для трёх ролей, дробные/субкопеечные/нулевые суммы, количество, replay/overflow, SQL4/immutable и old1–3. Только новая DDL внутри outerROLLBACK; все исходные строки/constraint hash MATCH,persistedRows0,outbound0. Остальные pending migrations не применялись, постоянной миграции/дампов не было. Поздний повтор остановлен guard: local контейнер штатно stopped; нового SQL не выполнялось. Ранний успешный native PASS фиксируется отдельно от текущей доступности БД.

UI review: D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f/review/browser-review.mjs и browser-receipt.json,27 сценариев. Реальные React-компоненты/синтетические данные/mock actions; шаг/лимит композируются в review-bundle. Это component review; authenticated/staging-приёмка единого SHA после ordinary merges остаётся необходимой.

Пересечения:76/78 PercentageRateInput;76/80 step helper/tests;77/80 query/preview/direct completion. При обычном merge сохранить50сотых/max1500сотых,v4ceil,max15 guards. Выборочный перенос файлов запрещён.

Build/generated-client artifacts перенесены наD после ENOSPC; owner source/refs/файлы сохранены. Commit/merge/push/CI/staging/production не выполнялись. Restic и dumps не использовались.

Последний browser review:27/27,errors0/outside0/serverClosed true. Финальные mobile/light и desktop/dark PNG полей выплат просмотрены; суммы на телефоне одной строкой, caret в пределах input, dark значения читаемы. Remote main/staging8c37e5c подтверждены; release без разрешения не выполнялся.
