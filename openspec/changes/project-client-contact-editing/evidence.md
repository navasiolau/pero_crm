# Приёмка №95

Основа: origin/staging 8f257cba42f20df8f57d4d6cdcdc7df75f892ee5; отдельная feature/95. Владелец согласовал план и явно разрешил коммиты, merge/push staging и его тестирование. Main не разрешён.

- RED: новые проверки адреса Client и реальных React inputs падали до реализации; прежние сценарии телефона сохранялись.
- GREEN: полный набор web 1296/1296; TypeScript, lint (0 ошибок, прежние 5 предупреждений), production build PASS. Дополнительные проверки QA helpers 9/9.
- Реальный PostgreSQL 127.0.0.1:5433/pero_crm: 8 групп project/contact/stage core PASS, включая общий адрес двух заказов, null, CAS, replay, исходного клиента, роли и транзакционность. Безусловный outer rollback проверен хэшами исходных таблиц. Запрос контакта не читает историю/экономику и не вызывает fetch.
- Локальный production runtime 127.0.0.1:3095: 5 групп browser PASS (Enter/blur, пустой телефон, задержанный ACK со сменой клиента, инженер readonly, desktop 1440 и mobile 390/360 без overflow). Все три PNG лично просмотрены.
- Первый browser STOP был ошибкой тестового селектора option вместо button. Только собственные bounded fixtures очищены подписанным checkpoint; preferences не менялись. Исправленный повтор PASS, данные CLEANED, preferences RESTORED; приватный receipt local-90a3c868-c632-4c8b-ab1b-121a8ef6bfe8.
- Подготовка QA и очистка используют существующий строгий transport и подписанные before/after observations; поддержка нового client.address добавлена в whitelist сопоставляемого аудита, не в общий обход guards.

## Staging — 08.10.2026

- Функциональный commit af61c74004727cc6b7827f61478a190768755481 слит обычным merge в 8dd3039f828b1a88272f7349acf6ea39831d35af.
- CI [37682909416](https://github.com/navasiolau/pero_crm/actions/runs/37682909416): test, build-push и build-push-bot SUCCESS.
- Actual web revision 8dd3039f828b1a88272f7349acf6ea39831d35af, OCI sha256:3292ed27a0e2dbdbb37f84a5ac3c7ee2104266f8138697ce830e25c553e3717e; container healthy, HTTP health 200 JSON status/database ok.
- Исходный DB ID 27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a, StartedAt, crm-staging_pgdata и W07 SHA совпали. В первом отдельном metadata helper был неполный литерал ID; read-only сверка выявила ошибку helper, действующий guard не менялся. Временный REFRESH_OR_DEPLOY_BUSY дождались без обхода блокировки.
- Native PostgreSQL 8 групп PASS с подтверждённым rollback и исходными хэшами; bundle eb8fdc3272c37fd08f83f4597b3727850cdef59e017779832aac6b15ba67be56.
- Actual HTTPS/browser 5 групп PASS на manager и engineer; desktop 1440, mobile 390/360 просмотрены лично. Receipt staging-1ce4418a-0b03-4e3a-9c01-dbccfda4781a: DATA CLEANED, preferences RESTORED.
- Main остался 8f257cba42f20df8f57d4d6cdcdc7df75f892ee5. Production и его БД не менялись.
