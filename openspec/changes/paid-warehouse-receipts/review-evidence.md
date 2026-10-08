# Необязательный документ оплаченного прихода — 08.10.2026

Уточнение владельца: приход разрешён без файла. feature/103 продолжена после FF от свежего staging491685b.

## Local

- Доменный контракт принимает необязательный reportDocumentId, передаёт в общее денежное ядро. Нет новой связи/миграции/копии документа. Fingerprint прежних закупок без файла побайтно совместим; смена файла при повторе отклоняется.
- PostgreSQL PASS: оплаченный BYN и USD приход, один ID документа в платеже и складской проекции; файл READY/владелец/непривязан проверяется общим ядром. Чужой/PENDING/отсутствующий/использованный документ отклонён с rollback. Точные суммы, денежный потолок, последняя ошибка, конкурентные запросы и повторы PASS. Все исходные digest MATCH.
- CRM использует FinanceDocumentUpload в общей PaymentDialog с необязательной подписью. Без файла сохранение доступно; после upload файл входит в payload, повтор сохраняет UUID/документ. Component10/10 PASS, реальный браузер1440/390 PASS: настоящая загрузка PDF, мобильный скролл/доступный submit, связанный документ, только собственные QA-строки/bytes очищены, сообщений сотрудникам0.
- Telegram использует общий модуль переноса/ошибок/UUID с обычными расходами. Файл/фото/пропуск, потеря upload/commit ACK, отмена, старые кнопки и свежие роли PASS; callbacks укладываются в64bytes. Fake-provider bot38/38 PASS.
- RED→GREEN нового контракта; fullweb1364/1364 PASS; types/lint/build PASS (5 прежних warnings), OpenSpec strict PASS. Исправлена локальная коллизия имени переменной в QA браузере, повторный build PASS.

## Staging

CI177 SUCCESS; принят фактически развёрнутый staging3704214e590f7b1dd2478c25e2d9e3fa4d831e7d, web healthy, image sha256:9d7ea87bbce04250157c8f504443660ac72ee5c1e66d38295ca320d77436b0a8. Native, concurrency и HTTP PASS на REAL_ACTIVE: документы/без документа, FX, receipt/retry, rollback, права и неверный документ. Собственные QA-строки очищены, исходные digest MATCH, уведомлений0; DB и W07 совпали с baseline.

Обновлён только tgbot-staging на тот же SHA; image sha256:843ef88bf3079fbd220c00547b495bf5c1c699e331813bb804f1d75c191f3264, healthy. На фактическом /app/dist прошли16 transport/engine/document тестов с fake providers, внешних сообщений0. Остальные контейнеры и config/env не изменены. Receipts: ignored .playwright-mcp/finance103-review/staging-receipt.json, bot-deploy.json, bot-verified.json. Main не меняется.
