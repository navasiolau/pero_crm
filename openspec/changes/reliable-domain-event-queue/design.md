# Design

## Context

См. proposal.md. Baseline `5a7f01ab4445f4d0cd57d76e221bb2424eaff1b2`, ветка `bugfix/135`, worktree `D:/Projects/pero_crm_worktrees/improvements-129`. `events.ts` берёт первые50 pending и повторяет уже успешные hooks при ошибке другого; последнее относится к136. `cleanupObsoleteSketch` сейчас самостоятельно пишет ACK и обходит любое будущее queue владение. В `instrumentation.register` есть существующий reminder worker, который служит примером singleton/unref loop.

## Goals / Non-Goals

**Goals:** один небольшой протокол queue claim/renew/complete/fail, который применим к обычным events и внутреннему cleanup; атомарные PostgreSQL операции и проверяемый background запуск.

**Non-Goals:** consumer ledger136, context cycle152, брокер, новые сервисы/пакеты, изменение SDK версии или hooks recipients, широкая очистка storage, обычные удаления137/138, изменение денежных writers или UI.

## Decisions

1. Additive DomainEvent fields: `claimToken String?`, `leaseUntil DateTime? @db.Timestamptz(6)`, `nextAttemptAt DateTime @default(now()) @db.Timestamptz(6)`, `exhaustedAt DateTime? @db.Timestamptz(6)`, `queueAttempts Int @default(0)`. `attempts` остаётся историческим общим счётчиком; новый budget начинается с0, чтобы прежние pending с большим attempts не были автоматически закрыты при rollout. Completed rows и payload не изменяются. Индекс: processedAt/exhaustedAt/nextAttemptAt/createdAt.
2. Store использует атомарный PostgreSQL claim `FOR UPDATE SKIP LOCKED`, новый UUID token, DB clock для lease/expiry и CAS ACK/renew по id+token+неистёкшей аренде. Берётся событие только перед его выполнением, без заранее арендованной большой партии. Ready order: nextAttemptAt, createdAt, id. Scope конкретных owned IDs поддерживается внутренним adapter для изолированных native probes; внешние API не принимают этот scope.
3. Defaults: tick15с, до50 событий за цикл, lease120с, heartbeat30с, delivery timeout90с, backoff30с×2 до15мин, automatic budget12. Все числовые настройки ограничены и проверяются; heartbeat/timeout меньше lease. TTL покрывает обычную короткую delivery, renew защищает долгую. Timeout ограничивает ожидание worker; он не отменяет уже выполненный внешний эффект и не обещает exactly-once.
4. На claim увеличиваются attempts и queueAttempts. Ошибка ставит nextAttemptAt и снимает своё владение. Последняя ошибка или crash последней попытки оставляет видимый exhaustedAt; следующий worker паркует expired budget без нового hook. Старый token никогда не пишет ACK/ошибку после expiry/reclaim. Старые completed не участвуют в claim.
5. Core зависит от clock/timers/store/deliver, а не от Prisma/Next напрямую. Postgres store и worker — узкие adapters. `dispatchEvent` и `dispatchPendingEvents` сохраняют существующие async exports, ordinary hook routing и результат count. Internal executor возвращает outcome без самостоятельного processedAt update; общий протокол подтверждает результат.
6. `cleanupObsoleteSketch` сохраняет signature/boolean и все intent/live-file/path/точные ключи guards. Доверенный post-commit retry той же receipt может принудительно сделать ready именно незавершённый internal intent, и после exhaustion начать новый queue budget; attempts history сохраняется. Это не крадёт active lease и не переоткрывает completed. Фоновый worker такую принудительную операцию не выполняет. Физическая семантика removeExactLocal/s3DeleteExact не меняется.
7. Worker запускается только `instrumentation.register()` при `NEXT_RUNTIME=nodejs` и `DOMAIN_EVENT_WORKER_ENABLED=true`; defaultfalse. Один global singleton, unref timer, non-overlap, immediate tick, live disable. Import/build сами не стартуют. Для реального staging enable нужен предварительный root proof его DB/storage/side-effect изоляции. Никаких env/infra изменений от worker.
8. Защищённая GET диагностика на существующем `/api/v1/events/dispatch` требует тот же Bearer write scope и возвращает только ready/active/exhausted/oldestPendingAgeMs и runtime status. Не раскрывает payload/actor/token/errors env. POST сохраняет обычный dispatch count; новый UI не добавляется.

## Allowed paths

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/20261011120000_domain_event_queue/migration.sql`
- `apps/web/src/server/plugins/event-queue-contract.ts`
- `apps/web/src/server/plugins/event-queue-store.ts`
- `apps/web/src/server/plugins/event-queue-core.ts`
- `apps/web/src/server/plugins/event-worker.ts`
- `apps/web/src/server/plugins/events.ts`
- `apps/web/src/server/products/sketch-cleanup.ts`
- `apps/web/src/server/products/sketch-cleanup-core.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/app/api/v1/events/dispatch/route.ts`
- `.env.example`
- `docs/DOMAIN_EVENT_QUEUE.md`
- `apps/web/tests/event-queue.test.ts`
- `apps/web/tests/helpers/event-queue-fixture.ts`
- `apps/web/tests/event-queue-store-native.ts`
- `apps/web/tests/event-worker.test.ts`
- `apps/web/tests/event-queue-http.test.ts`
- `apps/web/tests/product-sketch-cleanup.test.ts`
- `apps/web/tests/upload-route-reliability.test.ts`
- `openspec/changes/reliable-domain-event-queue/**`: только .openspec.yaml/README/proposal/design/spec/tasks/evidence.

## Risks / Trade-offs

- [Эффект уже выполнен, затем timeout/crash до ACK] → стабильный event ID и честное at-least-once; реальные business consumers закрываются136 до включения, успешный другой hook пока может повториться.
- [Lease потерян, callback физически ещё выполняется] → stale token не пишет queue ACK; timeout не является отменой внешнего эффекта. Internal exact erasure остаётся идемпотентным, guards сохраняются.
- [Непреднамеренная обработка старых internal intents] → worker defaultfalse; staging enable только root после DB/storage isolation proof. Native всегда использует owned IDs и подставной remove, без реального S3/FS удаления.
- [Schema изменяется одновременно другими задачами] → только additive поля DomainEvent, согласование migration sequence/интеграции root; no force/reset/cherry-pick.
- [DI скрывает SQL concurrency] → mandatory native PostgreSQL two-session claim/expiry/staleACK plus миграционная preservation сверка и actual runtime staging tick.

## Migration Plan

Согласовать design с независимым reviewer перед исходными правками. Написать RED, затем минимальную additive migration/queue/worker/cleanup adapters. Local: targeted suites/lint/typecheck и existing5433 native только в выделенном root окне после guardproof; no dumps/new DB/reset/seed. Old image совместим с дополнительными колонками и completed не переоткрываются. Root normalmerge/CI/staging применяет migration и проверяет actualSHA/health. После isolation proof root включает worker в существующем staging runtime и принимает tick/diagnostics/concurrency/staleACK/exhaustion/cleanup fixtures. Production/main не затрагиваются.
## Reviewed compatibility refinement: concurrent manual cleanup

Root разрешил design update после truthful shared-memory upload adapter: прежний SQL stub всегда [] скрывал новый read, а после исправления выявлен реальный duplicate replacement [200,503] вместо сохранённого [200,200]. Исходные ACL/retry/unknown/winner assertions не ослабляются.

Предлагаемый small API: `EventQueueStore.observe(id)` только читает event + DB-clock leaseActive; `processor.waitForCompletion(id,{verifyIntent,claimToken?,signal?})` вызывается только trusted cleanup после dispatchOne=false. На каждом read проверяются прежние id/type/actor/createdAt и parsed immutable intent. Monotonic deadline <= deliveryTimeout, poll100ms; foreground observer timer ref, существующие background/delivery timers unref.

Terminal matrix: same-intent durable processedAt → true; missing/released/exhausted/current owner failure/expired lease → false; исторический lastError при active lease не считается новым failure. Pending claimToken сменился → conservative false. Durable completion того же intent допускается независимо от завершившего текущего владельца. Abort прекращает только ожидание, не отменяет эффект владельца. Observer не вызывает claim/renew/complete/fail/remove, generic/nested/background dispatchOne не ждёт.

Source-only early native diagnostic расширяется на arguments/source/Docker/private-config/URL/client фазы и выдаёт только bounded F135/errno/Pcode/phase/hash. Старый failed native run не повторяется; source pins/new run/private memory launcher получают отдельное reviewer/root approval.