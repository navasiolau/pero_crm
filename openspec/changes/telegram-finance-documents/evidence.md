# Приёмка №98 — документы расходов Telegram

Дата: 08.10.2026. feature/98 от origin/staging a24b879065c7f743bffefe07949efc5e5809b45d. Владелец разрешил staging после локальной приёмки; main/production не разрешены до его проверки.

## Реализация и архитектура

- Bot adapter вызывает общий finance-documents HTTP/core, сохраняет source=telegram. Отдельного файлового backend нет.
- Общий actor вынесен из project CRUD с совместимым реэкспортом. payments/transaction содержит единственное ядро записи денег/документа/audit/outbox/receipt; core подготавливает курс и выполняет эффекты после commit.
- Повтор с прежним UUID/fingerprint возвращает прежний результат, удалённый платёж не воссоздаётся. Документ проверяется по READY, владельцу и свободной привязке.
- Telegram: document/photo, ограниченное скачивание до20МБ с контролем действительных bytes/размеров/origin/path/redirect; исходные имя/MIME сохраняются. Ошибки не раскрывают download token.
- Диалог сохраняет UUID после ошибки; подтверждение связано с UUID, старые/чужие callback не меняют другую операцию. Финансовые callback обновляют роли; документы и денежные подтверждения разрешены в личном чате.
- Прямые импорты используемых Zod-фабрик сохраняют валидаторы и позволяют исключить неиспользуемые локали. Native QA bundle99КБ укладывается в прежний лимит256КБ; guard не ослаблялся. Старый build-only QA facade обновлён для named exports/uuid/coerce без замены валидации.

## Local

- RED: три сценария документа/retry сначала не проходили на прежнем ядре.
- Telegram28/28 PASS: реальные engine/long-polling handlers через изолированный транспорт, PDF/фото, caption, потерянный upload ACK, потерянный payment ACK, старые кнопки, MANAGER/отозванная роль/группа, лимит/путь/редиректы/секреты.
- Настоящий PostgreSQL: расход100BYN с документом, один платёж/outbox, точный replay, чужой/PENDING/повторно занятый документ, изменённый UUID payload и повтор удалённого платежа. Искусственный сбой записи receipt откатил всю транзакцию. Полные digest семи таблиц MATCH, фикстуры ROLLED_BACK; рассылки не вызывались.
- Настоящий web127.0.0.1:3098: POST bot/documents/upload проверил Bearer, write scope, роли, multipart, точный повтор, source=telegram и оригинальные bytes. Собственные тестовые users/tokens/documents/audit/files удалены, исходные digest MATCH.
- Финальный полный web1317/1317 PASS, bot28/28 PASS, TypeScript/build PASS, lint0ошибок (5 прежних предупреждений), openspec strict PASS. Один прогон встретил прежний timing-flake product-filter-component (две кнопки «Сброс» при закрытии popup); файл/компонент не менялись, отдельный6/6 и следующий полный1317/1317 прошли.

## Staging

Ожидаются обычный merge, CI, точная ревизия и приёмка. Запуск production Telegram-бота и реальные сообщения сотрудникам не выполняются: этап проверяется на staging API и настоящем PostgreSQL, транспорт Telegram изолирован.
