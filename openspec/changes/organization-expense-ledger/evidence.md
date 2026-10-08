# Приёмка №100 — общие расходы

08.10.2026, feature/100 от e335146f26aea80c88540ef3ef23ecc1b26081ff. Staging разрешён владельцем, main/production ожидают его проверки.

## Local

- RED общего EXPENSE подтверждён на прежнем contract. Миграция20261008120000_organization_expenses применена только к существующему loopback5433/pero_crm: заменён CHECK, строки не обновлялись, dump/reset/seed не выполнялись.
- Fullweb1328/1328 PASS, bot29/29 PASS, TypeScript/build PASS, lint0ошибок (прежние предупреждения), strict PASS.
- Настоящий PostgreSQL: общий расход100BYN с документом уменьшил cash/org на100, projectId/projectAmount NULL, число проектных платежей не изменилось; общий reader вернул документ/контекст. Проверены receipt, rollback, неизвестные/занятые документы, запрет непарныхNULL на уровне БД. Исходные digest MATCH, QA ROLLED_BACK.
- Общий reader/OrganizationPaymentsView переиспользуются приходами/расходами; PaymentDialog одна. Проект выбирается SearchableSelect по номеру; отсутствующая статья/документ блокируют расход. Архивные проектные платежи читаются, удаление закрыто и в UI, и в delete-core.
- Исполняемый Telegram engine: явный paygeneral:UUID, отдельно projectSelected; общий приход и расход с документом сохранены с projectId:null, старый callback не меняет контекст. Внешние Telegram сообщения не отправлялись.
- Реальный localhost3098: форма общего расхода, загрузка, мобильный scroll/footer, фильтр журнала, открытие деталей мобильной карточки и оригинального файла PASS. Desktop1440×900/mobile390×844 screenshots просмотрены. Точные собственные user/cash/article/document/нулевая read-фикстура/bytes удалены; исходные счётчики MATCH, денежных UI submit/рассылок0.
- Runtime выявил общий дефект DataTable: onRowClick отсутствовал у mobile cards. Подключён в общем компоненте с keyboard и защитой собственных действий внутренних links/buttons; следующий полный набор1328/1328 и runtime прошли.
- Native bundle103761bytes, сохранены старые W07/256KiB ограничения. Локальные артефакты в ignored .playwright-mcp/finance100 и local100-*.log.

## Staging

Ожидаются CI, фактический образ, миграция и runtime-приёмка; push не считается приёмкой.
