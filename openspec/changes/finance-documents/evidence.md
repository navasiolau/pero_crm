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

Ожидаются CI, фактический образ и runtime-проверки. Push не является приёмкой.
