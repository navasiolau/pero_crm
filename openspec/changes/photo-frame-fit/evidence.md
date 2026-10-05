# Evidence

## Исправление по замечанию владельца — 05.10.2026

Функциональная приёмка исправления завершена на фактическом staging d1fbf5011a45fc476ab370b5c52017c29542fe2d: образ/healthy совпали; CI/CD#129 Success,10m4s — https://github.com/navasiolau/pero_crm/actions/runs/37345854334. В авторизованном интерфейсе9 проверок нижней полосы(3 доски×3 viewport) и12 фото-проверок(2 карточки×3 viewport×2 темы), native бегунок синхронен, fullscreen обоих фото сохранён. Рамки/overlay0, static border/bg прозрачны.

До UI-приёмки все45 таблиц совпали с baseline. После UI-приёмки44 таблицы совпали, а UserPreference сохранил параметры списков через прежний ListStateController.start()/saveListPreference; число строк осталось12. Это штатное сохранение UI-параметров, полное совпадение этой таблицы не заявляется. Constraints/columns, существующий volume/DB/W07 сохранены. Новых миграций нет. Временная auth session/file удалены. Дампы/restic/production не затрагивались. Реальные receipts: correction-before/after/final.json в D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f; stage-ui-receipt.json/PNG и acceptance.json — correction-75-79/. Следующий коммит меняет только task/evidence; исполняемые файлы совпадают с принятой функциональной ревизией.

По новому прямому указанию владельца рамка удалена полностью: hostdiv имеет статический прозрачный border/bg с первого render, измерений/overlay/load/error/ResizeObserver рамки больше нет. Невидимая1px граница сохраняет прежние размеры. CUA-проверка: задержка image response10s — обе фото ещё loading, но border/bg уже прозрачны, overlay0; после load неизменны.9 сочетанийportrait/square/landscape×1440/390/360: img/host bounds совпадают с исходной реализацией, object-contain сохранён. Empty/broken6 сценариев без декоративной рамки; fullscreen обоих компонентов открывается/закрывается. Upload/replace/delete/ACK/права не изменялись.

База текущего исправления: fresh origin/staging d146aad1a1e03e9bd4b3b6252084decf739a9b05, рабочая ветка bugfix/79. Уточнение согласовано прямым запросом владельца; прежнее разрешение на коммиты/staging сохраняется. Локально1245/1245 тестов, typecheck/lint/build PASS (существующие5 lint warnings). Протокол и PNG: D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f/correction-75-79/local-browser-receipt.json. Компоненты реальные, данные synthetic/actions mocked; фактическая staging-приёмка нового SHA выполняется отдельно.

Следующие разделы сохраняют историю прежней приёмки, superseded текущим уточнением.

## Завершённая приёмка staging — 05.10.2026

Владелец разрешил commits/staging. Ветка bugfix/79 интегрирована обычным merge; функциональная приёмка выполнена на образе ревизии fd1a371610d8aa49f370f428911254040974d71e (healthy). CI/CD #127: https://github.com/navasiolau/pero_crm/actions/runs/37334434678 — Success.

Реальные фотографии изделия и проекта проверены в авторизованном staging при 1440×900, 390×844 и 360×800: рамка прилегает к object-contain изображению, фон вокруг прозрачен, ошибка границ после стабилизации менее0.4px. Открытие полноэкранного просмотра работает. В отдельной React-проверке landscape/portrait/square размер и положение img совпали с исходной реализацией; cachedload/error/resize и пустой блок сохранены.

Объединённая локальная проверка:1245/1245 тестов, typecheck/lint/build и OpenSpec strict PASS; component browser review27/27. После миграции и UI-приёмки хеши всех45 бизнес-таблиц staging совпали с исходными, колонок не меняли; изменился только предусмотренный CHECK и запись миграции. W07 и существующий volume БД сохранены. Дампы не создавались, restic не использовался. Main/production не выпускались.

Протоколы находятся в D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f: stage-native.json, stage-before.json, stage-after.json, stage-final.json, stage-ui-receipt.json; browser review и PNG — в review/. Завершающий коммит этого change содержит только tasks/evidence; исполняемые файлы остаются принятыми на fd1a371.

## Предшествующая локальная проверка

База:8c37e5c637b6a44a14e7b529702303b8486b94bb,fresh origin/staging05.10.2026.
Ветка:bugfix/79. Scope/OpenSpec согласованы владельцем до реализации.

Full1226/1226,typecheck/lint/build/strict PASS. React baseline/current: portrait/square/landscape ×1440/390/360,img/host geometry EXACT,frame fit<=1.01px,bg alpha0,fullscreen/cache/empty/broken PASS. Лично просмотрены desktop landscape/mobile portrait/square PNG. Файлы/права/upload/delete/fullscreen и канбан-фото не менялись.

UI review: D:/Projects/pero_crm_task_runtime/20261005-75-80-01a10c1f/review/browser-review.mjs и browser-receipt.json,27 сценариев. Реальные React-компоненты/синтетические данные/mock actions; шаг/лимит композируются в review-bundle. Это component review; authenticated/staging-приёмка единого SHA после ordinary merges остаётся необходимой.

Пересечения:76/78 PercentageRateInput;76/80 step helper/tests;77/80 query/preview/direct completion. При обычном merge сохранить50сотых/max1500сотых,v4ceil,max15 guards. Выборочный перенос файлов запрещён.

Build/generated-client artifacts перенесены наD после ENOSPC; owner source/refs/файлы сохранены. Commit/merge/push/CI/staging/production не выполнялись. Restic и dumps не использовались.

Последний browser review:27/27,errors0/outside0/serverClosed true. Финальные mobile/light и desktop/dark PNG полей выплат просмотрены; суммы на телефоне одной строкой, caret в пределах input, dark значения читаемы. Remote main/staging8c37e5c подтверждены; release без разрешения не выполнялся.
