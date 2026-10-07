# Приёмка №96

Основа: origin/staging 8f257cba42f20df8f57d4d6cdcdc7df75f892ee5; независимая feature/96. План и staging delivery явно разрешены владельцем, main/production отдельно.

- RED: PREPARATION отсутствовал в общем списке, отрицательный производственный grant открывал бы новый статус. Новые проверки упали до реализации.
- GREEN: 1292/1292 web tests; TypeScript, lint (0 ошибок, прежние 5 предупреждений), production build PASS. Два теста настоящих React-компонентов проверяют размещение PREPARATION и его изделия в первой колонке обоих канбанов; filter component проверяет 7 статусов и полный набор.
- Существующая local БД 127.0.0.1:5433/pero_crm: применены только две миграции enum/default. Before/after всех 49 бизнес-таблиц совпали побайтово по хэшам; распределение существующих статусов сохранилось. Старые migration rows/checksums неизменны, добавлены ровно 2; default стал PREPARATION.
- Реальные createProductCore, SQL default, initial history, ролевые SQL predicates и PREPARATION ↔ DESIGN: 3 native группы PASS с полным outer rollback и совпадением всех исходных таблиц. Payroll/completion не создавались; назначенный инженер не запускает подготовку. Bundle bb717eebf7ba938cd6cc0f1acb3bbcb44ed9d94a6ce72760c7bf2a40c9483184.
- Actual local production runtime :3096: 5 browser групп PASS — статус/порядок селекта, 1440/390/360 без overflow, прямые ссылки недоступны engineer/worker/mounter. PNG просмотрены лично; CLEANED/RESTORED, receipt local-c5969201-e804-41ca-98b2-64ffe9268191.
- QA fixture замораживает подлинный исходный статус каждого своего изделия вместо hardcoded DESIGN; status не входит в список изменяемых полей.

## Staging — 08.10.2026

- После фактической приёмки №95 выполнен обычный merge №96: 170e96bda49546e04f052a704018a6fa1f0432ab. Два конфликта в реестре и QA fixture разрешены объединением требований: обе строки 95/96, mutable Client.address и immutable исходный status. Общая local версия: 1302/1302, TSC/lint/build/strict PASS.
- CI [37688678287](https://github.com/navasiolau/pero_crm/actions/runs/37688678287) полностью SUCCESS: test/build-push/build-push-bot.
- Actual web revision 170e96bda49546e04f052a704018a6fa1f0432ab; OCI sha256:76e21196557081d806787f010e0366b87785dbc8546a34b80e1d2890b3c6ad05; container healthy, HTTP200 JSON status/database ok. DB ID/StartedAt/volume/W07 сохранены.
- Before (принятый 8dd3039) / after (actual 170e96b): все 49 бизнес-таблиц и существующие status groups совпали. Только операционные ApiToken.lastUsedAt и Plugin.updatedAt не входят в межdeployment hash. Старые migration rows/checksums прежние, ровно 2 новых с SHA256 исходных SQL; default PREPARATION. Это проверка строк/миграций, не дамп и не restore.
- Native 3/3 PASS на настоящем staging PostgreSQL: create core/default/history, реальные SQL права, PREPARATION ↔ DESIGN без PayrollEntry/completion. Outer rollback и исходные таблицы MATCH, bundle bb717eebf7ba938cd6cc0f1acb3bbcb44ed9d94a6ce72760c7bf2a40c9483184.
- Actual HTTPS/browser 5 групп PASS: карточка и 7 статусов, 1440/390/360, direct URLs закрыты engineer/worker/mounter. Все PNG лично просмотрены. Receipt staging-8485c79e-b959-4bd9-b42b-ac1689434ae1: DATA CLEANED, preferences RESTORED.
- Контакты №95 повторно проверены на той же combined revision: browser 5/5 PASS, DATA CLEANED/preferences RESTORED, receipt staging-f14c2eb6-b5ac-4869-b0f0-777e7ad42c63.
- Запущенные root local web :3095/:3096 остановлены с проверкой ownership и освобождения обоих портов. Main остаётся 8f257cba42f20df8f57d4d6cdcdc7df75f892ee5; production, restic, dumps/reset/seed и refresh/W07 не менялись.
