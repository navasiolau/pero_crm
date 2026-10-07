# Приёмка №95

Основа: origin/staging 8f257cba42f20df8f57d4d6cdcdc7df75f892ee5; отдельная feature/95. Владелец согласовал план и явно разрешил коммиты, merge/push staging и его тестирование. Main не разрешён.

- RED: новые проверки адреса Client и реальных React inputs падали до реализации; прежние сценарии телефона сохранялись.
- GREEN: полный набор web 1296/1296; TypeScript, lint (0 ошибок, прежние 5 предупреждений), production build PASS. Дополнительные проверки QA helpers 9/9.
- Реальный PostgreSQL 127.0.0.1:5433/pero_crm: 8 групп project/contact/stage core PASS, включая общий адрес двух заказов, null, CAS, replay, исходного клиента, роли и транзакционность. Безусловный outer rollback проверен хэшами исходных таблиц. Запрос контакта не читает историю/экономику и не вызывает fetch.
- Локальный production runtime 127.0.0.1:3095: 5 групп browser PASS (Enter/blur, пустой телефон, задержанный ACK со сменой клиента, инженер readonly, desktop 1440 и mobile 390/360 без overflow). Все три PNG лично просмотрены.
- Первый browser STOP был ошибкой тестового селектора option вместо button. Только собственные bounded fixtures очищены подписанным checkpoint; preferences не менялись. Исправленный повтор PASS, данные CLEANED, preferences RESTORED; приватный receipt local-90a3c868-c632-4c8b-ab1b-121a8ef6bfe8.
- Подготовка QA и очистка используют существующий строгий transport и подписанные before/after observations; поддержка нового client.address добавлена в whitelist сопоставляемого аудита, не в общий обход guards.

Staging-приёмка ещё выполняется. Здесь не заявляются production, Telegram delivery или завершённый выпуск.
