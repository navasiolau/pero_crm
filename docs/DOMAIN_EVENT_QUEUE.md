# Очередь доменных событий

Outbox сохраняет исходные ID, payload, actor и createdAt. `processedAt` завершённых событий сохраняется; миграция не открывает их заново. `attempts` — прежняя история, `queueAttempts` — новый конечный бюджет автоматической доставки.

## Штатный запуск

Worker запускается только `instrumentation.register()` существующего Node web процесса при явном `DOMAIN_EVENT_WORKER_ENABLED=true`. По умолчанию false; import/build/edge не запускают таймер. Нового сервиса или cron нет. Один процесс имеет один unref timer и не перекрывает свои циклы; разные процессы координируются PostgreSQL lease.

Defaults: цикл15с, batch50, lease120с, heartbeat30с, deadline90с, backoff30с×2 до15мин, budget12. Числовые настройки проверяются; deadline и heartbeat меньше lease. Изменение enabled применяется на следующих ticks; интервал изменяется после штатного перезапуска согласованного runtime.

Включение staging выполняет root после проверки фактического image/SHA, применения additive migration и доказательства изоляции DB/storage/внешних эффектов. До этой проверки worker остаётся disabled. Production/main этой задачей не меняются.

## Владение и повторы

Claim атомарно берёт ready event перед выполнением через `FOR UPDATE SKIP LOCKED`. ACK/renew/fail требуют текущий token и срок после row lock по DB clock. Истёкший или чужой token не меняет состояние. Последний crash после истечения lease паркуется как exhausted. Ready order nextAttemptAt/createdAt/id позволяет исправному событию после50 отказавших пройти за второй стандартный batch50 цикл.

Deadline ограничивает ожидание, но не отменяет уже выполненный внешний эффект. Consumer обязан переносить повтор с тем же event ID; exactly-once не обещается. Успешный subscriber при ошибке другого пока может повториться. Перед новыми бизнес-подписчиками нужна задача136.

Внутренний sketch cleanup не доставляется plugins. Executor сохраняет intent/live-reference/path/key guards и не пишет ACK самостоятельно. Перед каждым точным remove проверяется владение. Доверенный replay подтверждённой upload receipt может повторить именно pending/exhausted internal intent, сбросив только новый budget; active claim не крадётся, completed не переоткрывается, attempts history остаётся.

## Диагностика

`GET /api/v1/events/dispatch` требует существующий Bearer write scope. Возвращает только ready/active/exhausted/oldestPendingAgeMs и worker enabled/started/running/lastTickAt/lastCount. Payload, actor, token, env значения и storage errors не раскрываются. POST сохраняет `{ok, dispatched}` для ограниченного ручного цикла.

Exhausted событие остаётся в БД вместе с payload и безопасным lastError. Автоматическая доставка его не повторяет. Обычные business events требуют согласованной операторской процедуры повторения и consumer idempotency; массовое обнуление processedAt/attempts запрещено.

## Native проверка и возврат

Native используется только в root-выделенном окне существующей разрешённой local5433 или проверенной staging. Внутренний adapter ограничивается exact owned event IDs; пустой scope пуст, внешние API scope не принимают. Пробы не вызывают реальный S3/FS erase. Проверяются два соединения, expiry/staleACK, expiry во время ожидания row lock, последняя crash попытка и migration preservation. Fake memoryStore это не доказывает.

Миграция только добавляет nullable/default поля и индекс. При возврате приложения root выключает worker и проверяет завершение/истечение active leases; прежний образ умеет читать старые поля. Колонки не откатываются, completed/payload не переписываются. Dump/newDB/reset/seed/restic и широкая storage cleanup не применяются.