# Приёмка №97 — финансовые документы

Дата: 08.10.2026. База ветки feature/97: origin/staging ac394f1fc27856a5b183526152e7a6bec0dec2c6.

Владелец разрешил после локальных проверок коммиты, перенос изменений в staging и тестирование там. Main/production ожидают его проверки staging и отдельного указания на выпуск.

## Local

- RED: новый тест не находил finance-documents/core до реализации.
- Unit/HTTP/viewer: 18/18 PASS. Полный web: 1313/1313 PASS. Бот: 22/22 PASS.
- TypeScript PASS; lint 0 ошибок, 5 прежних предупреждений в незатронутых файлах. Next production build PASS. OpenSpec strict PASS.
- Prisma validate/generate PASS; применена только 20261008100000_finance_documents к существующему loopback:5433/pero_crm. Seed/reset/dump не запускались.
- Реальный PostgreSQL: четыре конкурентные одинаковые загрузки создают один документ и один audit; несовпадающий повтор, MANAGER, чужой draft и отозванная роль отклоняются; привязанный документ доступен финансовой роли, FK запрещает его удаление; PENDING восстанавливается повтором.
- После native QA точная очистка своих строк; полные digest User/Payment/File/FinanceDocument совпали с исходными.
- Реальный production web localhost:3097: multipart upload, чтение оригинальных PNG bytes, просмотрщик с naturalWidth=640, повтор PDF upload, старый JWT после изменения роли отозван, новая сессия MANAGER получает 403.
- Desktop 1440x900 и mobile 390x844 без горизонтального переполнения. Скриншоты просмотрены; подтверждена загрузка изображения до capture. После browser QA собственные строки/bytes удалены, исходные счётчики User/FinanceDocument/File совпали.
- Артефакты локально в ignored .playwright-mcp/finance97 и local97-*.log.

## Обнаруженные условия

- Старый engineering-local-runner unit намеренно требует отсутствие ambient .env. Полный набор повторён с временным перемещением только созданного этой задачей локального env и восстановлением в finally; проверки безопасности не менялись.
- PostgreSQL дополнительно запрещает общий EXPENSE через Payment_project_direction_check. Его изменение относится к №100; №97 правило сохраняет. Native FK-тест использует нулевой общий INCOME и удаляет его по точному ID.
- Старые URL FileViewer сохранены; source=finance выбирает только защищённый финансовый route.
- Обязательность документа расхода и Telegram attachment adapter относятся к №99/98 и здесь не заявляются готовыми.

## Staging

- Принят SHA a24b879065c7f743bffefe07949efc5e5809b45d, обычный merge feature/97 (3ec382b).
- [CI/CD #162](https://github.com/navasiolau/pero_crm/actions/runs/37704781362) — Success, test/build-push/build-push-bot завершены успешно. Статус подтверждён в авторизованном GitHub UI; API token реестра не давал доступа к private Actions, результат 404 не считался состоянием CI.
- Фактический web healthy, OCI revision совпадает; image sha256:07063703789439f5933c06d84786308cb6e1d240d2e490a8c0a0e74e87073102. FinanceDocument/миграция работают в настоящем PostgreSQL.
- Под существующим W07 workflow.lock и проверками hostname/compose/DB id/startedAt/volume/network/staging bucket выполнены настоящие HTTP multipart upload, MinIO original read, private draft/manager deny, точный повтор (один документ/audit), финансовая страница и отзыв роли.
- До/после web image/DB/W07 идентичны. Полные digest User/Payment/File/FinanceDocument/ChangeLog MATCH; собственных QA rows и S3 objects осталось 0. Чужие данные не менялись, фоновые provider-вызовы не запускались.
- Receipt: ignored .playwright-mcp/finance97/staging-receipt.json; проверенный bundle SHA256 c462d86b60055f4b75fbb6953dac03ff030c8b572332f823dc8191dfabad2a26.
- Main остаётся ac394f1fc27856a5b183526152e7a6bec0dec2c6; production не изменялся. Следующие действия — #98, затем общая обязательность документа #99.
