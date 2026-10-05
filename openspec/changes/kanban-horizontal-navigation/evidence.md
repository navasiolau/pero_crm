# Evidence

## Исправление по замечанию владельца — 05.10.2026

По новому прямому указанию владельца верхние range/стрелки удалены. Внизу — обычный overflow-x-auto контейнер, браузерная полоса15px, sticky bottom-0. Локальная реальная UI-проверка в CUA:9 сочетаний3 доски×3 viewport(1440×900/390×844/360×800), одна нижняя полоса без верхней панели, no horizontal page overflow, Home/End и ползунок синхронны, доступность в начале/середине/конце, resize3200 скрывает полосу. Реальный mouse drag native бегунка203/203, Shift+wheel150/150, карточка перетянута из DESIGN в PRODUCTION в fixture (7/9). Touch overflow/обработчики остаются native и не менялись; имитация touch-жеста не поддержана CUA/IAB и не выдаётся за выполненный touch runtime тест.

База текущего исправления: fresh origin/staging d146aad1a1e03e9bd4b3b6252084decf739a9b05, рабочая ветка bugfix/75. Уточнение согласовано прямым запросом владельца; прежнее разрешение на коммиты/staging сохраняется. Локально1245/1245 тестов, typecheck/lint/build PASS (существующие5 lint warnings). Протокол и PNG: D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f/correction-75-79/local-browser-receipt.json. Компоненты реальные, данные synthetic/actions mocked; фактическая staging-приёмка нового SHA выполняется отдельно.

Следующие разделы сохраняют историю прежней приёмки, superseded текущим уточнением.

## Завершённая приёмка staging — 05.10.2026

Владелец разрешил commits/staging. Ветка bugfix/75 интегрирована обычным merge; функциональная приёмка выполнена на образе ревизии fd1a371610d8aa49f370f428911254040974d71e (healthy). CI/CD #127: https://github.com/navasiolau/pero_crm/actions/runs/37334434678 — Success.

На фактическом staging проверены проекты, общий канбан изделий и изделия проекта: навигация стрелками/верхней полосой, доступ к скрытым колонкам и отсутствие горизонтального выхода страницы. Размеры 1440×900, 390×844, 360×800. Sticky, синхронизация после остановки прокрутки, Shift+wheel, touch swipe, resize и прежнее перетаскивание проверены отдельно в браузере на настоящих React-компонентах с синтетическими данными.

Объединённая локальная проверка:1245/1245 тестов, typecheck/lint/build и OpenSpec strict PASS; component browser review27/27. После миграции и UI-приёмки хеши всех45 бизнес-таблиц staging совпали с исходными, колонок не меняли; изменился только предусмотренный CHECK и запись миграции. W07 и существующий volume БД сохранены. Дампы не создавались, restic не использовался. Main/production не выпускались.

Протоколы находятся в D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f: stage-native.json, stage-before.json, stage-after.json, stage-final.json, stage-ui-receipt.json; browser review и PNG — в review/. Завершающий коммит этого change содержит только tasks/evidence; исполняемые файлы остаются принятыми на fd1a371.

## Предшествующая локальная проверка

База:8c37e5c637b6a44a14e7b529702303b8486b94bb,fresh origin/staging05.10.2026.
Ветка:bugfix/75. Scope/OpenSpec согласованы владельцем до реализации.

Full1226/1226,typecheck/lint/build/strict PASS. React/Chromium: три доски,1440/390/360, range/native scroll sync, keyboard/Shift-wheel/resize, desktop drag/sticky и mobile swipe PASS.

UI review: D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f/review/browser-review.mjs и browser-receipt.json,27 сценариев. Реальные React-компоненты/синтетические данные/mock actions; шаг/лимит композируются в review-bundle. Это component review; authenticated/staging-приёмка единого SHA после ordinary merges остаётся необходимой.

Пересечения:76/78 PercentageRateInput;76/80 step helper/tests;77/80 query/preview/direct completion. При обычном merge сохранить50сотых/max1500сотых,v4ceil,max15 guards. Выборочный перенос файлов запрещён.

Build/generated-client artifacts перенесены наD после ENOSPC; owner source/refs/файлы сохранены. Commit/merge/push/CI/staging/production не выполнялись. Restic и dumps не использовались.

Последний browser review:27/27,errors0/outside0/serverClosed true. Финальные mobile/light и desktop/dark PNG полей выплат просмотрены; суммы на телефоне одной строкой, caret в пределах input, dark значения читаемы. Remote main/staging8c37e5c подтверждены; release без разрешения не выполнялся.
