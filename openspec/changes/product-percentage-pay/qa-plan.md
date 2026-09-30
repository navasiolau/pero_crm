# QA Plan: product percentage pay

**Статус:** локальная реализация, проверка сохранности миграций и read-only native UI завершены; staging browser acceptance не запускалась. Новые QA users, projects, products, works, tasks, files, percentage configs, shares или accruals не создавались. Живые status, rate, share, role и earning state не менялись. Положительное live earning остаётся **NOT VERIFIED**. Production и main — **HOLD**.

## Local evidence

- После review и backup к существующей локальной БД применены две аддитивные миграции. Приватная native-приёмка: `C:/Users/admin/AppData/Local/Temp/pero-percentage-readonly-recheck-a327eb7f-b4df-4523-afc5-9ce88ff44ae1/local-browser-acceptance.json`; backup и receipts сохранности: `C:/Users/admin/AppData/Local/Temp/pero-percentage-readonly-oKJS75/`.
- Read-only сверка обнаружила 2 433 ожидаемых маркера `LEGACY_PROTECTED`. Данные всех 40 прежних business tables сохранили fingerprints; метаданные 4 726 существующих файлов сохранили размер и время изменения. Полное чтение содержимого file store не выполнялось и не заявляется.
- Native browser-проверка использовала только существующих акторов и изделия. Management показывал все шесть вариантов статуса изделия. Чистый инженер видел назначенное изделие DESIGN с B3D и ручной переход, но не редактор ставки/модели для management; прямой маршрут готового изделия и маршруты DESIGN для чистых WORKER/MOUNTER вернули 404, их список DESIGN был пуст. Совмещённый MANAGER+ENGINEER мог использовать статусное управление менеджмента. Данные статусов, ролей, ставок, долей, задач и зарплаты не менялись.
- Визуальная проверка CUA на 360, 390 и 1440 px не обнаружила горизонтального переполнения. Скриншоты существующего UI просмотрены приватно; новые image/file records не создавались.
- Read-only навигация автоматически создала одну строку `products.view`. Root восстановил исходное отсутствие строки узким compare-and-set delete и повторно сверил полный baseline. Первый запуск Next изменил только два прежних `Plugin.updatedAt`; root восстановил точные исходные значения через CAS. После исправления no-op plugin sync повторный локальный запуск не оставил дрейфа business data; созданный процесс был остановлен.
- Приватный каталог существующих данных: `C:/Users/admin/AppData/Local/Temp/pero-percentage-readonly-oKJS75/existing-catalog.json`; он содержит actor и sample IDs. В нём нет существующего изделия DESIGN с `noModel=true` и нет пользователя с совмещёнными field-ролями, поэтому эти live UI сценарии не показаны.
- Для staging сохранён только предмиграционный backup/TOC и preservation baseline (receipt `e29ab845-4fc9-4d36-8a5e-ce379034cac5`): проверены 38 старых таблиц и 4 738 версий S3 keys с полным чтением объектов; restore не выполнялся. Это не staging deploy или native acceptance, они остаются **NOT RUN**.

## Automated evidence and limits

- Полный release test sweep прошёл 491/491 тестов; lint завершился с 0 errors и одним прежним предупреждением `existsSync`, production build прошёл после исправления plugin sync. Целевые plugin-sync тесты прошли 3/3; TypeScript-проверка тоже прошла.
- Offline DI-тесты покрывают frozen FX retry, null/0, идемпотентность, доли, отказ старого ENGINEERING split и позднюю настройку `SKIPPED_ONCE`. Они не подтверждают создание PayrollEntry в живой БД.
- Положительное live earning/accrual **NOT VERIFIED**: владелец запретил создавать тестовые записи, а существующие бизнес-записи не менялись ради этого сценария. Нельзя выводить live начисление из offline-тестов или прежних receipts #6/#9.
- Прежнее синтетическое предложение (шесть test users, два products, три works, до пяти tasks, загрузка B3D, новые ставки/доли и ожидаемые PayrollEntry) не запускалось и не является разрешённым fixture pipeline.
- Проверка staging, включая actor/session, browser и сверку сохранности, остаётся **NOT RUN**. Production и main остаются **HOLD**.

## Safety boundary

Следовать [SAFETY-RULES](D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md). Несовпадение target, guard, database/container identity, revision, storage binding или baseline fingerprint означает **STOP**. Существующая UI-навигация может автоматически создать preference metadata: зафиксировать исходные key/value либо отсутствие строки, восстановить только узким CAS и повторно проверить baseline. Скриншоты хранить приватно и обрезать PII. Fixtures, uploads, изменения business state, cleanup pipeline, disposable/copy database, restore-test и DDL rollback не входят в этот QA.
