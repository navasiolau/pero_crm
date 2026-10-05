# Evidence

## Завершённая приёмка staging — 05.10.2026

Владелец разрешил commits/staging. Ветка bugfix/76 интегрирована обычным merge; функциональная приёмка выполнена на образе ревизии fd1a371610d8aa49f370f428911254040974d71e (healthy). CI/CD #127: https://github.com/navasiolau/pero_crm/actions/runs/37334434678 — Success.

RED шага: 1/4 PASS, 3 FAIL → 4/4 PASS. Стрелки и ArrowUp/ArrowDown меняют сотые на 50, сохраняют точность ручного ввода и различие null/0. В объединённом результате верхняя граница 15% согласно задаче80. На staging во всех трёх блоках присутствуют кнопки шага0.5; сценарии изменения/сохранения/conflict/retry проверены компонентными и серверными тестами.

Объединённая локальная проверка:1245/1245 тестов, typecheck/lint/build и OpenSpec strict PASS; component browser review27/27. После миграции и UI-приёмки хеши всех45 бизнес-таблиц staging совпали с исходными, колонок не меняли; изменился только предусмотренный CHECK и запись миграции. W07 и существующий volume БД сохранены. Дампы не создавались, restic не использовался. Main/production не выпускались.

Протоколы находятся в D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f: stage-native.json, stage-before.json, stage-after.json, stage-final.json, stage-ui-receipt.json; browser review и PNG — в review/. Завершающий коммит этого change содержит только tasks/evidence; исполняемые файлы остаются принятыми на fd1a371.

## Предшествующая локальная проверка

База:8c37e5c637b6a44a14e7b529702303b8486b94bb,fresh origin/staging05.10.2026.
Ветка:bugfix/76. Scope/OpenSpec согласованы владельцем до реализации.

RED1/4,FAIL3 → GREEN4/4. Full1226/1226,typecheck/lint/build/strict PASS. Шаг50сотых в карточке, стандартные ставки сохраняют шаг0.1; max15 интегрируется отдельной80.

UI review: D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f/review/browser-review.mjs и browser-receipt.json,27 сценариев. Реальные React-компоненты/синтетические данные/mock actions; шаг/лимит композируются в review-bundle. Это component review; authenticated/staging-приёмка единого SHA после ordinary merges остаётся необходимой.

Пересечения:76/78 PercentageRateInput;76/80 step helper/tests;77/80 query/preview/direct completion. При обычном merge сохранить50сотых/max1500сотых,v4ceil,max15 guards. Выборочный перенос файлов запрещён.

Build/generated-client artifacts перенесены наD после ENOSPC; owner source/refs/файлы сохранены. Commit/merge/push/CI/staging/production не выполнялись. Restic и dumps не использовались.

Последний browser review:27/27,errors0/outside0/serverClosed true. Финальные mobile/light и desktop/dark PNG полей выплат просмотрены; суммы на телефоне одной строкой, caret в пределах input, dark значения читаемы. Remote main/staging8c37e5c подтверждены; release без разрешения не выполнялся.
