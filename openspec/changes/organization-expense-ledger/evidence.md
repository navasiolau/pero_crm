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

- CI/CD165 SUCCESS: https://github.com/navasiolau/pero_crm/actions/runs/37721156806.
- Фактически развёрнут staging6281d811d46672d2a332011998101854594c0d60, образ sha256:f965ba63cf2c44c815ba60eed1e26bbe6bc51d3c4986c8832418bb02cd18eb23, health healthy.
- Native в этом контейнере: проектный и общий расход100BYN, exact retry, документ, единичный audit/event, rollback и новый CHECK прошли. Реальный bot multipart endpoint/S3: bearer/scope/role, подтверждённая загрузка, retry, обязательность документа PASS.
- bundle SHA25612e5b970afff382c65545505b723c03c95d074922c338194da08f4130f8b7ad0, exitCode0; исходные digest MATCH, QA rows/objects0, providerMessages0. Receipt: ignored .playwright-mcp/finance100/staging-receipt.json.
- БД27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a, started2026-09-23T11:42:14.649193151Z, volumecrm-staging_pgdata сохранены. W07 lock/idle/identity guards выполнены, watcher SHA27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139 не изменён.
- Main/production не изменялись. Restic и дампы не использовались.
