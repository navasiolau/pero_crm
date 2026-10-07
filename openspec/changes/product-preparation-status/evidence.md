# Приёмка №96

Основа: origin/staging 8f257cba42f20df8f57d4d6cdcdc7df75f892ee5; независимая feature/96. План и staging delivery явно разрешены владельцем, main/production отдельно.

- RED: PREPARATION отсутствовал в общем списке, отрицательный производственный grant открывал бы новый статус. Новые проверки упали до реализации.
- GREEN: 1292/1292 web tests; TypeScript, lint (0 ошибок, прежние 5 предупреждений), production build PASS. Два теста настоящих React-компонентов проверяют размещение PREPARATION и его изделия в первой колонке обоих канбанов; filter component проверяет 7 статусов и полный набор.
- Существующая local БД 127.0.0.1:5433/pero_crm: применены только две миграции enum/default. Before/after всех 49 бизнес-таблиц совпали побайтово по хэшам; распределение существующих статусов сохранилось. Старые migration rows/checksums неизменны, добавлены ровно 2; default стал PREPARATION.
- Реальные createProductCore, SQL default, initial history, ролевые SQL predicates и PREPARATION ↔ DESIGN: 3 native группы PASS с полным outer rollback и совпадением всех исходных таблиц. Payroll/completion не создавались; назначенный инженер не запускает подготовку. Bundle bb717eebf7ba938cd6cc0f1acb3bbcb44ed9d94a6ce72760c7bf2a40c9483184.
- Actual local production runtime :3096: 5 browser групп PASS — статус/порядок селекта, 1440/390/360 без overflow, прямые ссылки недоступны engineer/worker/mounter. PNG просмотрены лично; CLEANED/RESTORED, receipt local-c5969201-e804-41ca-98b2-64ffe9268191.
- QA fixture замораживает подлинный исходный статус каждого своего изделия вместо hardcoded DESIGN; status не входит в список изменяемых полей.

Staging ещё не заявляется принятым. Restic, local/staging dumps, reset и seed не использовались; production не менялась.
