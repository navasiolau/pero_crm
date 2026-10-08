# Design

## Context

См. proposal.md. FinanceDocument/общий upload сервис готовы в #97; Telegram engine сейчас принимает только text и очищает платёжный диалог после любого ответа. Деньги записывает общий payments/core с withTaskTransaction.

## Goals / Non-Goals

**Goals:** тонкий Telegram транспорт, проверенная привязка документа и однократное проведение, восстановимый диалог.

**Non-Goals:** общие расходы #100, обязательность документа во всех каналах #99, production/настоящие сообщения сотрудникам в QA.

## Decisions

1. POST /api/v1/bot/documents/upload проверяет Bearer write + acting user/FINANCE_ROLES до multipart и вызывает общий uploadFinanceDocumentResponse(source=telegram). Хранилище/валидация содержимого не дублируются.
2. TgMessage расширяется document/photo/caption. Скачивание getFile ограничивается 20 MB, только config.telegramApiOrigin; file_path сегменты валидируются, redirect запрещён, stream ограничен фактической длиной. Имя/MIME сохраняются из входящего сообщения; для фото используется наиболее крупный вариант, имя генерируется детерминированно. Секретный download URL не выводится в ошибках.
3. Новые document/confirm шаги. UUID платежа задаётся один раз при начале диалога; UUID загрузки сохраняется при повторе того же вложения. Подтверждение допускается только на соответствующем шаге, ошибки сохраняют состояние. Отмена прекращает диалог, но не отменяет уже проведённые деньги.
4. Payment schema получает optional clientMutationId/reportDocumentId. receipt helper использует существующий ChangeLog с уникальным ID payment-request:<UUID>, fingerprint actor + нормализованный input. Проверка receipt идёт до FX и повторно в денежной транзакции. Повтор удалённого платежа отклоняется. Доступ/деньги не дублируются в bot adapter.
5. READY документ должен принадлежать actor и не иметь платежа; уникальный FK фиксирует единственную связь. Receipt и основной audit/outbox записываются атомарно. Общая обязательность ещё выключена для прежнего веб-клиента.
6. Запись платежа выделена в payments/transaction без Next/UI и проектного CRUD; общий DomainActor/requireActorRoles — в server/actor с сохранением прежних реэкспортов. Web/бот подготавливают операцию через core; будущий складской приход использует тот же transaction модуль в общей транзакции. Native QA вызывает настоящее ядро и PostgreSQL с откатом, не вызывая рассылки сотрудникам.

## Risks / Trade-offs

- Раздельная доставка web/bot → новый bot upload до готовности endpoint получает явный отказ, не создаёт расход, сохраняет запрос.
- Большие файлы Telegram → понятный предел 20 MB; больший документ можно загрузить через CRM.
- Перезапуск бота сбрасывает прежние memory-only диалоги; сохраняется текущая модель жизненного цикла. Подтверждённые документы/платежи живут в CRM.

## Sources

[Официальный Telegram Bot API getFile](https://core.telegram.org/bots/api#getfile), проверено 08.10.2026: 20 MB, getFile/file_path, отдельное сохранение имени/MIME. Firecrawl не выполнил запрос из-за отсутствия кредитов; использован официальный источник через web.
