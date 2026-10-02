# Evidence — №42, стандартные проценты новых изделий

## Scope

Ветка feature/42 создана от свежего staging02d7db1. Прямое разрешение владельца получено. Настройка хранится в одном OrgSetting `productPercentageDefaults` с JSON/revision; схема БД, миграции и зависимости не добавлены.

До настройки ставки ENGINEERING/ASSEMBLY/INSTALLATION равны NULL: это сохраняет наблюдавшуюся семантику создания. Явный 0 отличается от NULL, допустимы значения 0–100 с точностью 0.1. Новый Product читает один snapshot внутри существующей транзакции и создаёт все три configs revision1, даже без назначенных сотрудников. Audit создания содержит revision/rates. Изменение defaults не обновляет существующие изделия, configs или финансовую историю. Настройки доступны менеджменту только по точному `/settings/product-percentages`; остальные settings/finance права сохранены.

## Local Verification

Meaningful RED: прежний create core не создавал три configs; manager navigation не содержал нового scoped route. После реализации focused/settings/create/auth и старые create regressions прошли 28/28. Проверены NULL/0/границы/точность, role union, запрет nonmanager, CAS/no-op/replay/foreign actor, отказ повреждённых settings и выход audit-error из callback для rollback. Прежние DI fixtures исправлены по точному OrgSetting key, без production fallback. TypeScript и scoped ESLint прошли с 0 errors/0 warnings.

Root затем подтвердил полный интегрированный web suite 952/952, fail0/skip0, после исправления только устаревшего SSR-layout теста. Полный TypeScript PASS. Compiled local app6b22 соответствует app source pushed `a160b5bdf9ebbbec1fd06248bc0026e073cf12c5`; различия относятся к scripts/tests/docs.

Actual local native №42: 5 групп PASS, все 43 таблицы совпали после outer ROLLBACK, externalFetch0. Receipt: `correction-41/.playwright-mcp/round2/local-defaults-native.private.json`. Это реальный settings/create SQL/ACL proof, включая копирование ставок только новым изделиям и сохранение старых данных, а не hosted-concurrency или browser proof.

## Browser и staging: текущий статус

Actual local browser `8bdf3fd1-3505-4021-86f7-6c46fad068ab`: PASS62checks/7files, protocolStopped=false, CLEANED, original MATCH. Настройки восстановлены: prefs RESTORED26, из них25 unchanged и1 restored. Receipt: `correction-41/.playwright-mcp/corrections/local-corrections-8bdf3fd1-3505-4021-86f7-6c46fad068ab/final-receipt.json`.

Предыдущие helper FAIL сохранены с таким же успешным cleanup: 1aee0f14 остановился на48 checks из-за Node, не переданного в browser callback; 30acb2dd — на52 checks из-за чтения контактов в неправильной вкладке. Исправлен только helper: overview → readonly contacts → products/card navigation. Assertions не ослаблялись, app source не менялся. Личный просмотр новых local screenshots root ещё выполняет; stage browser PASS пока не заявляется.

CI93 SUCCESS: run37063222232, test4m6/build3m29/bot1m12. Actual staging `a160b5bdf9ebbbec1fd06248bc0026e073cf12c5` healthy, image `e01c37d1b51604257d5baec6022cd8d6ce2742223a325ae41a0361dfedef1dc7`. Staging native42: 5 групп PASS, all43-table rollback verified, externalFetch0; root evidence44-delivered-metadata и staging-defaults-native. Это фактический SQL/ACL/deployment proof, отдельно от будущей hosted browser приёмки.

Task3.2 остаётся unchecked до root final staging browser confirmation. Mainf036 не изменён, production release не разрешён. Runtime, данные и deployment проверяет root. Эта актуализация меняет только документы; restic/дампы/seed/reset/production DB не использовались.
