# Проверка №187

Дата: 18.10.2026; обновлено 19.10.2026. Worktree: `kp-187`, ветка `feature/187`.
Реализация находится за выключенным `PERO_KP_ENABLED=0`. Коммит, push, включение
раздела, операции с рабочими БД/S3 и установка интеграций этим агентом не выполнялись.

## Выполнено

- Общий router для session и Bearer; закрытые JSON/multipart-схемы, bounded body,
  проверка Origin, active owner/role/sessionVersion и явных семи scopes КП.
- Повторная авторизация с SHARE locks в командных транзакциях и на границах I/O.
  Действующий actor передаётся в бизнес-операцию после длительной подготовки.
- Реальные adapters №181–186: общая синхронизация, Decimal pricing и fixed rate,
  подготовка private media вне final tx, версии/restore/PDF и contract workflow.
  Перед подготовкой медиа выполняется поиск immutable receipt.
- Immutable API receipt и key audit в бизнес-транзакции; GET operations возвращает
  сохранённый result, включая canonical state создания/сохранения.
- Job/artifact/receipt readers выбирают scope по сохранённому виду результата.
  DOCX и CONTRACT не доступны ключу только с `kp:read`.
- Общий приватный artifact writer для PDF/DOCX/импорта: pinned binding,
  IfNoneMatch, hash/size readback после неизвестного ACK, bounded actual stream,
  abort/timeout после заголовков, освобождение клиента. Удалений и disk fallback нет.
  Временная ошибка S3 допускает retry; отсутствие/нарушение целостности — 410.
- Standard Product revalidation вызывается также при изменении только цен/медиа;
  прежние номера удалённых/перенумерованных изделий сохраняются для cache paths.
- OpenAPI, `docs/API.md`, пресет «ИИ-агент КП», приватные download URL. Поля source
  state не декорируются и не подменяются URL транспорта.
- Root реализовал AI bundle в `integrations/ai` и зафиксировал отдельную проверку
  в `integrations/ai/verification.md`. Установка существующего skill и cutover ещё
  не выполнены; состояние не подменяется наличием исходников.

## Local evidence

- `pnpm db:generate` — PASS на текущей базовой схеме, без подключения к БД.
- Focused ESLint для backend/маршрутов/auth/key UI/тестов — PASS.
- `pnpm exec openspec validate kp-agent-api --strict` — PASS.
- `git diff --check` — PASS.
- API auth/operation/router/artifact/render-budget DI/HTTP suite (29) и действующие
  auth-security regressions (4) — **33/33 PASS**. Проверяются cookie fallback, generic admin без KP scopes,
  owner/revocation/role/Origin, raw-state bypass, dishonest Content-Length,
  canonical multipart documentId/alias mismatch, cross-kind grants,
  immutable lost ACK/concurrent replay, rollback при audit failure,
  abort slow body, binding change, unknown PUT ACK, фактический overflow и общий
  budget приложений нескольких КП до base64. Production использует shared
  `KP_RENDER_LIMITS` №184 (DOCX 1000 страниц, 128 MiB PNG, 16 MiB на PNG).

## Обычная интеграция №180–186 и checked adapters

Root выполнил обычный FF merge №185/186 до HEAD
`45a7e5810914df0d73662a96477d6e7e8c3c425b`, включая принятые №180–184.
Все собственные staged/untracked API-файлы №187 и reviewed AI bundle сохранены.
Runtime imports теперь разрешаются на реальные producers этой ветки; реализации
№185/186 и `integrations/ai` в этом исправлении не менялись.

Первый tsc после offline install выявил устаревший generated client, а не дефект
production-схемы. По разрешению root выполнены только собственные Prisma 6.19.3
validate/generate с inert DSN `127.0.0.1:1/schema_only` и отключёнными
CHECKPOINT/telemetry/update checks, без подключения к БД. После генерации остались
три настоящие integration-ошибки типов на границах `api-render-runtime.ts`:
stable item ID, ArtifactRecord.kind и PdfAsset MIME.

Добавлен небольшой чистый `api-render-adapters.ts`. Он проверяет непустой ID
перед существующим canonical media parser, допускает только сохранённый kind
PDF/DOCX и явно сужает MIME к прежним JPEG/PNG/WebP приватного media pipeline.
Неизвестные значения отклоняются с безопасным 410; coercion/cast и расширения
allowed MIME нет. State, обе image slots, порядок, media IDs и base64-байты не
меняются. Raw-state обход, Zod-схемы и лимиты DOCX/PDF не ослаблялись.

Фактический итог после исправления:

- Полная web-типизация `tsc --noEmit --incremental false --pretty false`: PASS.
- Прежние API/auth/file/render-budget сценарии: 34/34 PASS; вместе с тремя
  новыми поведенческими regressions `kp-render-adapters.test.ts`: **37/37 PASS**.
  Новые проверки подтверждают stable IDs/обе slots без изменения снимка,
  закрытый PDF/DOCX kind и точные MIME/байты без passthrough неизвестных значений.
- ESLint всех собственных API modules/routes/scopes/auth/instrumentation/key UI
  и шести профильных test-файлов: PASS; новые adapters/runtime/test дополнительно
  проверены после финальной правки типовой аннотации тестовой JSON-фикстуры.
- OpenSpec strict и `git diff --check`: PASS. Git index не изменялся.

AI bundle не переписывался и не переустанавливался; его отдельные ранее
проверенные 19 сценариев/review остаются в `integrations/ai/verification.md` и не
выдаются за новые тесты этого прогона.

## Не завершено

Обычная интеграция №180–186, собственная Prisma generation и полный typecheck
завершены. Root выполнил `pnpm --filter @pero/web build`: PASS, все 36 static
страниц сгенерированы, API и страницы КП собраны как dynamic routes. База и S3
были явно направлены на нерабочий `127.0.0.1:1`, КП и workers выключены,
телеметрия отключена, использованы только синтетические build credentials.
Живые БД/S3 и renderer этой сборкой не принимались. Лог:
`.playwright-mcp/kp-187/build-0c183057-2db7-4c2a-8f4d-0fd125dcc3e7.log`.
Остались три прежних lint warnings в product-attachments и percentage core;
новых предупреждений в модуле нет. Local-приёмка 3.2 закрыта.

## Частичная staging-проверка и диагностика 19.10.2026

По переданному root результату на реальном staging прошли 22 случая API
ролей/scopes, НБРБ, шесть денежных случаев и приватные изображения с независимыми
копиями изделий. Первый `POST /api/v1/kp/documents/:id/pdf` вернул
`503 KP_UNAVAILABLE` до появления job/version. Две последующие DB-диагностики
с откатом — `requestProposalPdf`, затем `runApiCommand` + `writeApiReceipt` —
прошли целиком. На том этапе это не объясняло исходный HTTP-сбой и не подтверждало
выпуск PDF. Позднее root сообщил об успешных реальных PDF/job/version/private
download и договорных сценариях. Исторический 503 сохранён как факт раннего
прогона; он больше не описывает текущую незавершённую UI/AI-приёмку.

Root сообщил о восстановлении трёх выключенных флагов (`000`), отзыве временных
ключей, восстановлении уведомлений и исходного Plugin. В рамках этого локального
исправления targets/SSH/Docker/БД/env не вызывались; эти результаты повторно
не проверялись и не выдаются за evidence нового server report на staging.

База исправления: чистая `feature/187`, совпадавшая с `origin/staging`
`5d7eea8b79884f39e4cd7e787de6601fbb860085`. Только общий неожиданный catch router
теперь пишет `KP_API_UNEXPECTED`: закрытый класс ошибки, разрешённые коды
Prisma/Node и SQLSTATE, не более пяти статических кадров `.next/server`,
`kp-template` или `node:`. Первая строка stack и имена функций отбрасываются;
message, SQL, meta.message, параметры, headers/body, ключи, URL и ID не логируются.
Пути upload/client data, query strings и traversal не разрешены. Ожидаемые
`KpApiError`/Zod ошибки не логируются. Сбой console/accessor не меняет прежний
503, тело ответа либо бизнес-операцию. Reporter не исправляет и не устанавливает
причину PDF-сбоя; нужен его отчёт следующего воспроизводимого unexpected 503.

Локальная проверка исправления:

- RED до реализации: три новых сценария ожидаемо падали из-за отсутствия report;
  проверки отсутствия логов ожидаемых ошибок и сохранения 503 уже проходили.
- `pnpm --filter @pero/web exec tsx --test tests/kp-api-error-report.test.ts tests/kp-api-router.test.ts`:
  **15/15 PASS**, включая пять новых privacy/error-report сценариев с синтетическими
  секретами и настоящим `PrismaClientKnownRequestError` с чувствительным meta.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false --pretty false`: PASS.
- Focused ESLint reporter/router/нового test-файла: PASS.
- `pnpm exec openspec validate kp-agent-api --strict` и `git diff --check`: PASS.
- Независимое read-only review: NO FINDINGS; проверены закрытые поля диагностики,
  неизменность HTTP-ответа и обе формы статического пути Next catch-all route.

## Исправление session Origin и текущий статус 19.10.2026

База этого исправления — чистая `feature/187` на
`d1497e1d077c6aeacb45b4b2fd23ee5e2425ffff`. Root подтвердил: реальные PDF,
сохранённые версии, private download и договорные сценарии прошли в последующих
изолированных прогонах. Это отдельные результаты; они не закрывают приёмку
редактора и AI transports.

Реальный UI-save не принят: session REST-запрос получил 403 при проверке Origin
за reverse proxy. При отсутствии AUTH_URL/NEXTAUTH_URL прежний fallback сравнивал
публичный Origin с внутренним standalone `request.url`. В проверенном исправлении
настроенный canonical Origin сохраняет строгий приоритет; иначе используется
одиночный проверенный X-Forwarded-Host/Host, согласованный с существующей границей
Caddy и подходом Next Server Actions. Отсутствующий, чужой, cross-site,
неоднозначный либо malformed Origin/authority отклоняется. Caller body, wildcard
и новые настройки не добавлены. Проверки Bearer/scopes/owner/sessionVersion,
команды сохранения и выпуска не изменены.

В ignored UI harness применена отдельно reviewed диагностика: HTTP status и
API error code собственного REST-ответа сохраняются до проверки ACK, полные
pageerror/stack/cause — только в private-файлах. Ошибка collector немедленно
отклоняет ожидаемый flow; browser/workflow/verification/diagnostic callbacks
дожидаются cleanup. PASSED receipt публикуется после финальной проверки
диагностики. POST/Bell allowances и строгая политика разрешённых изменений не
расширялись. Frozen packets прежних прогонов сохранены.

Локальные проверки после применения исправления:

- `pnpm --filter @pero/web exec tsx --test tests/kp-api-auth.test.ts` — **10/10 PASS**;
  новый proxy fallback и canonical priority проверены вместе с отказами для
  отсутствующих, чужих, cross-site, duplicate и malformed headers.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false --pretty false` — PASS.
- Действующие `ui-acceptance-offline.test.ts` — **12/12 PASS** без target calls;
  отдельный reviewed diagnostics v2 ранее прошёл **5/5 PASS**, включая late closing
  write failure, clean control и RED на прежней frozen-копии. Применённые helpers
  совпадают с reviewed v2 по raw SHA.
- Focused ESLint `api-auth.ts`, `kp-api-auth.test.ts` и двух собственных ignored
  UI helpers — **0 errors / 0 warnings**.
- `pnpm exec openspec validate kp-agent-api --strict` — PASS.

По последнему отчёту root первый SDK PUT в закрытом cohort `b458` вернул HTTP 200.
Generic отказ последующего native post-verification локализован до
`UI_PRESERVATION_ONE_NEW_EXACT_EVENT_REQUIRED`. Отдельный read-only postmortem
подтвердил: полный BUSINESS-снимок 76 таблиц до/после совпадает, RAW-различие
ограничено ранее одобренным `lastUsedAt` одного legacy ApiToken. Последующая
read-only проекция показала ровно одно новое событие нужного типа, actor и payload
с нужной ревизией. Не проходит только требование точного совпадения `createdAt`:
событие имеет время `14:59:40.501`, core receipt — `.503`, API receipt — `.509`.
Core/API receipts принадлежат одной транзакции; event и delivery plan уже обработаны
dispatcher в последующих транзакциях. Совпадение времён не является допустимым
доказательством их связи. До/после этой проекции полные RAW и BUSINESS снимки
76 таблиц совпали точно. Результат проекции остаётся `DIAGNOSTIC_NOT_ACCEPTED`;
исправленная проверка и будущий прогон ещё не приняты.
HTTP 200 не выдаётся за принятую сквозную SDK/MCP/Python-проверку; повторная
запись здесь не выполнялась.

Задача 3.3 остаётся открытой, **UNACCEPTED**. Требуются приёмка реального UI на
390×844 и 1366×900 и завершённый AI/native результат на новой закреплённой
staging паре. Импорт/cutover №189 и физическая очистка №188 сохраняют отдельные
критерии приёмки. Полная staging- и production-приёмка не заявляются. По отчёту
root staging выключен (`000`); targets, env, SSH, Docker, БД и S3 этим локальным
исправлением не вызывались. Commit/push не выполнялись.
