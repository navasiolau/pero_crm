# Проверка №187

Дата: 18.10.2026; обновлено 20.10.2026. Worktree: `kp-187`, ветка `feature/187`.
Исходная реализация готовилась за выключенным `PERO_KP_ENABLED=0`. Коммит, push, включение
раздела, операции с рабочими БД/S3 и установка интеграций этим агентом не выполнялись.

## Текущий статус приёмки, 20.10.2026

На закреплённом staging `acbd164cb6e79194b7fe87a0469d60d745dead1a` и immutable
паре образов из evidence ниже Root принял API CORE4, AI01 SDK/MCP/Python,
private-file/NBRB проверки, AUTH 22 роли / 71 scopes / 10 boundaries / 72 operation
cases и все четыре credential transitions. Согласованные UI-компоненты приняты:
KP_EDITOR_ONLY Lead FULL23, Locked8 UI34 и MANAGER_BROWSER составными 5+1 случаями.
Пределы internal HTTP, KP_EDITOR_ONLY и отдельных browser scenarios сохраняются;
приёмка всего приложения и public HTTPS Bearer через Basic perimeter не приписываются.

Пункт 3.3 остаётся `[ ]`: физическая цепочка №188 не принята, финальная deployed
composition нового SHA/образов №187/189 ещё NOT_RUN. Actual archive APPLY32/REPLAY36
принят отдельно с provenance operational CLI4ff64fc; его receipts не выдаются за
проверку будущего final image. Обязательные оставшиеся проверки не отменены;
полная staging-приёмка, switch/main/production не объявляются выполненными.
Датированные разделы ниже описывают соответствующие исторические cohorts:
их прежние HOLD/NOT_RUN/PENDING сохранены и не переоткрывают позднее принятые
компоненты. Точные UI34/AUTH35 closure/classification refs приведены в разделе
«Manager 5+1, UI34 Locked/Mixed и AUTH35».
Ранние Origin403, первый SDK200 и ошибочная native createdAt-проверка относятся
к историческим попыткам. Они сохранены ниже; текущий API/AI01/UI/auth статус
определяется последующими принятыми evidence, а не прежним UNACCEPTED.

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

## Исторический итог local-сборки до staging-приёмки

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


## Приёмка №187: свежий опрос артефактов CI, 19.10.2026

Обычный merge Origin-исправления опубликован в staging как
`9b70a20898dd9af1110df65d407c5852c5f72cbc` (feature/187
`c4d3b1c07d3dfc7d3aabff899c98133799acc404`). CI305 / run39279296589
не выпустил новых образов: в первой попытке backend и native отклонили ожидание
артефакта с `CI_TARGET_REFUSED:producer-timeout`; во второй backend, renderer
и обе component-проверки завершились успешно, native завершился ошибкой на шаге
ожидания проверенного backend artifact. Native PostgreSQL/HTTP/S3-проверки
прошли до этого ожидания. Это не является новой staging-приёмкой.

Узкое исправление в test runtime добавляет уникальный query nonce и запрет
кеширования к каждому metadata GET GitHub API. Signed blob URL и его запрос
сохранены; проверки repo/run/SHA/attempt, producer/consumer, шага загрузки, имени,
владельца и digest артефакта, redirect/domain, размеров и прежние time budgets
не менялись. Workflow и production-код приложения не менялись. Кеширование
как причина реального таймаута не установлено; исправление устраняет
воспроизводимое залипание повторяемого URL в локальном контролируемом сценарии.

Локальные evidence: reviewed ignored patch `db670354…`, review `60278375…`.
Регрессия вызывает настоящий `receiveCiArtifact`: старая реализация получает
`producer-timeout`; новая проходит реальные metadata/redirect guards до
отдельного sentinel скачивания blob. ZIP, Python, файловая система и сеть
в этой синтетической проверке не вызываются. GREEN — **11/11 PASS**; синтаксис,
focused ESLint и `git apply --check` — PASS. Независимое source-only review
подтвердило точные manifest hashes и ограничение изменения вложенным `api()`:
**NO FINDINGS**. Результат нового настоящего CI требуется отдельно.

Задача 3.3 остаётся открытой. Актуальные UI/AI, физическая очистка №188
и архивный import/replay №189 не считаются принятыми. Текущие выключенные флаги
и закрытые QA-доступы сохранены; production/main не затрагивались.

## Actual staging acbd: full3–full5, 19.10.2026

Закреплён SHA `acbd164cb6e79194b7fe87a0469d60d745dead1a`; CI306 / run39290284146 — **7/7 PASS** (receipt `42974641…`).
Immutable images: web `sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`,
renderer `sha256:ec35d0956e41d55f7d21cac46c5ea07430bde99d920a9538791899cc75dac5a8`.

- Full3: CORE money/media/versions/contracts — **все четыре PASSED**. Закрывающий
  OrgSetting diff классифицирован отдельным evidence `4ef0b5ad…`: единственная подстановка прежнего
  `telegram.botUsername.updatedAt` точно воспроизводит старый hash; автор записи не установлен. Исходный HOLD сохранён.
- Full4: **AI01 SDK/MCP/Python принят отдельно** — шесть native ACK VERIFIED, ревизии 8→11,
  replay/stale без побочных изменений; три download по 286774 B совпали с SQL artifact SHA `169b2c77…`.
  Original finish закрыл 11 пользователей/22 ключа до deadline; finish→CLOSED_OFF: BUSINESS всех
  76 таблиц и четыре каталога exact, RAW diff только прежнего разрешённого legacy ApiToken.lastUsedAt.
  Все поля трёх OrgSetting стабильны BEFORE_AI→CLOSE; итог `dd7aad27…`, UI/physical/archive им не принимаются.
- Full5: UI **HOLD** — readonly Bell HTTP 200→ERR_ABORTED, затем timeout до любого Save/PDF;
  host inFlight/HOLD сохранён. Emergency finish `305646eb…` / ACK `46b89f3d…` закрыл все 11/22;
  deadline daemon `df0739f4…` подтвердил ORIGINAL_FINISH_OBSERVED/alive=false. Флаги `000`, renderer STOPPED.

Retained root evidence (`kp-180/.playwright-mcp/kp-integration/`):
`full3-close-classification-8fc5f9ad-570c-426a-937a-e35242d301ca.json` (`4ef0b5ad…`),
`full4-acceptance-b784fa50-5efa-43ab-856e-7f6aa67e0baa.json` (`dd7aad27…`),
`full5-closed-hold-a8f5069c-5c18-4fc7-8ed6-fa28ae03c37b.json` (`428dc09f…`).
UI/auth, physical №188 и archive №189 остаются **PENDING**; 3.3 — `[ ]`, старый c319 — NOT ACCEPTED.

## Actual staging acbd: FULL9/FULL10 (частичная приёмка)

Эти результаты относятся к прежнему закреплённому staging SHA
`acbd164cb6e79194b7fe87a0469d60d745dead1a` и той же immutable паре web/renderer
из раздела выше. Исторические HOLD и исходные receipts сохранены.

- **FULL9 — только mobile partial.** На 390 px native-проверки собственного
  сохранения описания и выпуска PDF дали два VERIFIED; скачан PDF 326410 B
  (SHA `37f27113a3248a7990eabdef2099488c76f2ea32f390dc2930ed6db6a70bbf78`),
  сохранены пять PNG. Общий UI остаётся HOLD: pricing-capture получил два h1
  («Проекты» и собственный номер); отдельный login ERR_ABORTED сохранён без
  заявления о его причине. Host HOLD/inFlight не очищались и не переигрывались.
- **FULL10 — CORE4 и private27 PASSED.** Money/media/versions/contracts прошли
  все четыре фазы. Отдельно выполнены ровно 25 отказов GET к приватным файлам
  (10×401, 15×403) и 2 GET курса НБРБ за 01.10.2026: BYN=1, USD=3.0207.
  Всего 27 GET; это не AUTH-матрица и не public HTTPS-приёмка. Новый курс в КП
  этими чтениями не записывался. Первоначальный pre-GET REFUSED сохранён:
  QA ожидал raw PDF job.result.artifactId вместо producer-поля pdfArtifactId;
  исправлен только ignored QA-пакет, ownership/state/version guards сохранены.
- Для private27 независимо восстановлены 54 полных RAW fingerprint из receipts
  и проверены 27 пар прежним canonical checker: 26 RAW exact, одна дельта только
  разрешённого lastUsedAt одного legacy ApiToken. Foreign BUSINESS и addback
  собственных реквизитов стабильны; отдельные полные boundary меняются по
  ApiToken из-за ожидаемого lastUsedAt собственных ключей. Полное RAW equality
  этих boundary не заявляется.
- Original finish закрыл 11 пользователей/22 ключа. Foreign RAW и BUSINESS
  до/после finish exact; полный RAW меняется только по собственным User,
  ApiToken и одной записи аудита finish. Финальный full76 совпадает с
  finish.afterFullRaw. Во всех 16 контрольных full76 стабильны четыре
  агрегата каталога и migration history: 84 записи, 83 successful,
  1 historical rolled back, 0 pending. Narrow OrgSetting и legacy token row
  до/после finish exact. Deadline receipt `c03ca3fd…` подтвердил
  ORIGINAL_FINISH_OBSERVED/alive=false; флаги `000`, owned renderer STOPPED.
- **Архив не импортирован.** Доставка остановлена с
  ARCHIVE_ROOT_PRIVATE_FILE_REQUIRED до SQL/S3/import: payload имел режим 0644
  при точном совпадении 5952000 B и SHA. Read-only metadata receipt `087f9d3e…`
  подтверждает mode-only причину; исходный HOLD сохранён. Пять собственных
  PURGE_MEDIA остаются PENDING и сохранены; физическое удаление не выполнялось,
  отсутствие всех заданий не заявляется.

Сохранённые root evidence в `kp-180/.playwright-mcp/kp-integration/`:
`full9-closure-classification-c682958e-45f5-44ce-983d-bf663728f11a.json`
(`daa2d7d3…`),
`full10-closure-classification-14fb7853-6bdd-421e-8efd-5dad08106444.json`
(SHA `71823a947b5d20a8e72bdade27ef8387fb54b9dc2e210ce4c685f038af3026bf`),
`fresh-full10-run-context.json`
(SHA `428b2f03675a0bbb02bad3782c29b0c3185f32743b3c113f538869e39931116b`).
Actual private27: `kp-187/.playwright-mcp/kp-187/file-access-denials-run-33bfe963-adb3-400f-8751-9d26bf9fcb2d/result.private.json`
(SHA `375d4386caa075ff85fa202148a389a5e86f3f69bc3944408774b71fef2633d7`).

Scope — **PARTIAL ONLY**. AUTH, полный UI, MANAGER_BROWSER, archive APPLY/REPLAY
и physical retention №188 остаются открытыми; пункт 3.3 сохраняет `[ ]`.
Main и production этими прогонами и данным docs-only дополнением не затрагивались.

## Actual staging acbd: FULL11 — роли и scopes, AUTH частично

На той же закреплённой паре acbd/8ef120/ec35 выполнены **22/22 роли**
(8×200 и 14×403 KP_FORBIDDEN, Bearer и session) и **71/71 scopes**:
2×200, 4×400, 1×415, 63×403 KP_SCOPE_REQUIRED, 1×401 отозванного ключа.
Разрешённые по scope команды с пустым body останавливались проверкой запроса
до business mutation. Это внутренняя HTTP-приёмка двух фаз, не вся AUTH-матрица.

В сохранённых receipts независимо восстановлены 186 RAW-снимков и проверены
93 BUSINESS-пары: 92 RAW exact, одна дельта только прежнего разрешённого
legacy ApiToken.lastUsedAt. Addback собственных реквизитов exact; полный
boundary меняется по ApiToken из-за ожидаемого использования собственных ключей.
Третий execute, auth-boundaries, получил **AUX_DEADLINE_FINISH_RESERVE_HOLD**
до target/host BEGIN и не выполнил ни одного случая; его предшествующий
read-only PREPARE сохранён. Из восьми настроенных AUTH-фаз две PASSED,
шесть не имеют actual cases: этот HOLD и пять ещё не запущенных фаз
(operations и четыре credential transitions). HOLD не превращён в PASS.

Original finish `137c1ed7…` закрыл 11 пользователей/22 ключа; deadline
`29c31f8e…` подтвердил ORIGINAL_FINISH_OBSERVED/alive=false. Флаги `000`,
owned renderer STOPPED. Foreign RAW и BUSINESS до/после finish exact;
полный RAW меняется только по собственным User, ApiToken и одной записи finish.
Полные before/after совпадают с закрывающими boundary; во всех 12 full76
снимках стабильны каталог и история 84/83 (одна historical rolled back,
0 pending migrations). Narrow OrgSetting и legacy token row до/после finish exact.
Пять собственных PURGE_MEDIA FULL11 сохранены PENDING; удаление не выполнялось.

Root proof: `kp-180/.playwright-mcp/kp-integration/full11-closure-classification-067e33c2-9079-4419-9fc1-bb00d6f7ae4c.json`
(SHA `a0e664b25bb4b985504bf87e8b44c17067cb1757329fce461f527d6ce028d4c3`),
`fresh-full11-run-context.json`
(SHA `d517c6194e96b0c7fdf77da2016d864140bfb0099a11e020d741f6594ac278e0`).
Producer body SHA: roles `ea3c26d5…`, scopes `ad51a45f…`;
source proof `05b7be8a…` и canonical telemetry policy прежние.

Scope — **PARTIAL ONLY**. Остальные AUTH, полный UI, MANAGER_BROWSER,
archive APPLY/REPLAY и physical retention остаются открытыми; 3.3 — `[ ]`.
Старые receipts/HOLD сохранены, main/production не затрагивались.

## Actual staging acbd: FULL12 — mobile partial и manager FAILED

MONEY и MEDIA получили PASSED. Manager-проба прежнего QA-пакета63 завершилась
FAILED на own-product-projection (MANAGER_DRAFT_OWN_COVER_PROJECTION_REQUIRED),
без принятых случаев; cleanup также FAILED (MANAGER_DRAFT_BROWSER_CLOSE_FAILED).
Root сообщил read-only Win32 осмотр в 22:06:59 UTC с нулём собственных issuers,
но локальный artifact не записан: это ROOT_REPORTED_LOCAL_RECONCILIATION,
не независимый PASS и не DRAINED. Original FAILED сохранён. Внешние full76
до/после manager подтверждают BUSINESS exact, RAW diff только legacy lastUsedAt.

UI lead остаётся HOLD. На mobile390 сохранение описания и PDF дали два native
VERIFIED (guard2b95); скачанный PDF 322617 B совпал с SQL artifact SHA
`b031d88117d2f1c7e8f67a72cde8136ac2efb7689fa800a71e68f8a4272d8f60`.
При локальной перепроверке использован прежний reviewed codec21ef: он только
восстанавливает известный порядок сериализации при точном исходном RAW SHA,
не меняя значений; затем canonical checker5289 подтвердил оба receipts.
Сохранены семь mobile PNG; визуальную оценку Root ведёт отдельно.
Следующий desktop завершился OUTER_FAILURE/TimeoutError на
acceptance-ui.mjs:146:17 (frame.waitForFunction, 15000 ms); browserErrors=[],
desktop screenshot отсутствует. Причина не объявляется business defect;
HOLD сохранён. Scenarios versions/contracts и UI locked не запускались.

Original finish `4ecaee75…` закрыл 11 пользователей/22 ключа;
status `9c5f13d4…` — ORIGINAL_FINISH_OBSERVED/alive=false. Foreign RAW и BUSINESS
до/после finish exact; полный RAW меняется только по собственным credentials
и одной записи finish. Каталог и история 84/83 стабильны во всех 15 full76
(одна historical rolled back, 0 pending migrations); narrow OrgSetting
и legacy token row до/после finish exact. Флаги000, owned renderer STOPPED;
один собственный PURGE_MEDIA сохранён PENDING, удаление не выполнялось.

Root evidence:
`kp-180/.playwright-mcp/kp-integration/full12-closure-classification-d8410aa8-4b57-4b53-a522-d48d9f102957.json`
(SHA `d7bf42ec97d4d30366957c1e3ebfdfdf27914d1f3435d054bafab97200a68678`),
`fresh-full12-run-context.json`
(SHA `03d171b0f329a8b0ea8e413d86f4ad8990b282d127fe1c7bcb0a076042f59cd5`).
Manager receipt `9f00ce6e…`, UI failure `a069702f…`, OUTER_FAILURE `5238c01e…`
и оба native receipts сохранены. Scope — PARTIAL ONLY; 3.3 остаётся `[ ]`.
AUTH remainder, полный UI, MANAGER_BROWSER, archive и physical не приняты;
main/production не затрагивались.

## Actual staging acbd: FULL13 — доставка архива, probe HOLD

Архивный cohort создал только собственные 11 пользователей/22 ключа.
RESERVE_TRANSFER `32d4be3e…` подтверждён. В PREPARE_PACKAGE sealing прошёл:
пакет 5952512 B, mode0600, inode и содержимое неизменны. Затем probe остановился
с ARCHIVE_CLI_PROBE_GENERATED_SCHEMA_MISMATCH; host receipt `a690570d…`
сохранил HOLD до DB/S3/aux BEGIN. Полные RAW и BUSINESS снимки до/после PREPARE
exact. Это не успешная подготовка к импорту: IMPORT/REPLAY не запускались,
как и MONEY/MEDIA/manager diagnostic. Guard не обходился.

Original finish `ec76a36e…` закрыл 11/22; status `557472bd…` подтвердил
ORIGINAL_FINISH_OBSERVED/alive=false. Foreign RAW и BUSINESS до/после finish
exact; полный RAW меняется только по собственным User, ApiToken и записи finish.
Во всех 11 full76 стабильны каталог и migration history84/83 (одна historical
rolled back,0 pending migrations); финальные full/narrow `2a59e0a3…`/`de3119e5…`
согласованы с finish. Flags000, owned renderer STOPPED. Собственных pending
jobs FULL13 нет; ноль глобальных старых pending jobs не заявляется.
Старый delivery086/HOLD `d83db5f4…` и новый deliveryb271/HOLD `a690570d…`
сохранены, очистка старых заданий не выполнялась.

Root proof: `kp-180/.playwright-mcp/kp-integration/full13-closure-classification-d087a236-bf13-405a-9501-30dddeb2f34b.json`
(SHA `fae48354a425f24186c7b7e2b35391f5b4eed9e708fb3b0e9964c42254924413`),
`fresh-full13-run-context.json`
(SHA `3fda341def27f14c9d5526383b9ba72229aecd4d284499607b096a5e8fe32fc5`).
Archive приёмка остаётся HOLD/NOT_IMPORTED; общая задача3.3 — `[ ]`.
Старые evidence и чужие изменения сохранены; main/production не затрагивались.

## Actual staging acbd: FULL14 — AUTH boundaries, закрытое окно

На прежних acbd164c / web image8ef120a6 собственный cohort `a68367ad…`
повторил CORE money/media/versions/contracts: 11 случаев, 99 exchanges, PASSED.
AUTH boundaries дал 10 PASSED случаев внутреннего HTTP: Origin и разделение
session/Bearer. Checker5289 проверил 20 native samples / 10 before-after pairs:
foreign RAW и BUSINESS exact, четыре каталога exact. Public HTTPS Bearer
сохраняет NOT_ACCEPTED_BASIC_PERIMETER; полная AUTH-приёмка не заявляется.

22 роли и 71 scopes остаются отдельной prior-приёмкой FULL11
(`auth-prior-acceptance2-full11-de40cad2.json`, SHA `a0b5df60…`), а не новыми
завершёнными фазами FULL14. Operations остановился с HOLD
`AUX_ROOT_PRIVATE_FAILURE_CHECK_PRIVATE_EVIDENCE`; private-причина не установлена,
приёмки нет. Четыре перехода отзыва/версии session/ролей/деактивации не запускались.

Original finish `a6fc1904…` / semantic receipt `6709347c…` закрыл собственные
11 пользователей / 22 ключа. Deadline status `111428be…` подтвердил
ORIGINAL_FINISH_OBSERVED и alive=false; автоматическое истечение не заявляется.
Первый qa-off `d569850c…` сохранил HOLD KP_ROLLOUT_BUSY_NO_MUTATION, включая
targetMayHaveChanged=true и automaticRetry=false. Source58c2 подтверждает отказ
lock до замены env. Затем сохранены fresh read-state `1f9c761d…`, новый full76
BEFORE_OFF `88256932…` и отдельный successful OFF `b512ea1a…`: flags000,
owned renderer STOPPED. Первый HOLD не заменён на PASS.

Локально закреплены и перепроверены все 32 full76 и восемь narrow inventories:
RAW/BUSINESS digests сохранены, четыре каталога и migration history84/83 стабильны
(одна historical rolled back, ноль pending migrations). Во всех narrow сохранены
все десять полей legacy token; девять неизменны, только lastUsedAt может меняться;
OrgSetting exact. Foreign RAW `d9655b97…` и BUSINESS `35f1fd40…` exact через finish.
Полный finish RAW меняется по собственным User/ApiToken и записи ChangeLog;
соседние внешние RAW отличаются от внутренних finish-снимков только ApiToken
по времени телеметрии. Все исходные RAW оставлены без нормализации.
Два WINDOW_PROOF проверены как ссылки на sealed ACK, readbackOnly — по исходной
схеме host36de; собственная seal-формула к WINDOW_PROOF не применяется.

Пять собственных PURGE_MEDIA сохранены PENDING; business cleanup/prune закрыт,
старые задания сохранены, ноль глобальных pending не заявляется. Root context
`fresh-full14-run-context.json` закреплён SHA
`972bfa71d2cdf45994f28a974dc2c2b8045c2e6262c87ff6c166c83537fa97a1`.
Локальный proof без target calls:
`kp-187/.playwright-mcp/kp-187/full14-closure-classification-79cb0f5d-0d35-4c8e-a1bd-2030cdc50f7d.json`
(SHA `b54223c41f53f6c5873ea7ffaccc581bad35fc81458e02647ee7a129f045e811`).
Scope — PARTIAL ONLY; task3.3 остаётся `[ ]`. AUTH remainder, полный UI,
MANAGER_BROWSER, physical №188 и archive import/replay №189 не приняты;
main/production не затрагивались.

## Actual staging acbd: ARCHIVE17 — пакет подготовлен, импорт не запускался

Собственный cohort `3da646d1…` на прежних acbd164c / image8ef120a6 получил
MONEY и MEDIA PASSED: семь случаев, 27 exchanges. Versions/contracts не запускались.
RESERVE_TRANSFER `03c03e3b…` и PACKAGE_PREPARED `aa2baacd…` подтверждены.
Пакет 6041600 B / SHA `ef607d4d…` прошёл actual PACKAGE_LOAD_PROBED_NO_IO:
CLI main не выполнялся, credentials не читались, DB/S3/source R2 не вызывались,
applyReady=false. Это подготовка пакета, а не импорт архивных изображений.

Старый INSPECT `9d385f1a…` с generic HOLD сохранён. Отдельная локальная проверка
Root и source proof `6fa07e39…` установили пустой stdout/exit0 для прежнего
process.cjs через stdin и false require.main gate; сам opaque ACK не раскрывает
private-причину. Новый reviewed read-only supplement `7c3f8116…` дал INSPECTED:
previousHead точно совпал с PACKAGE_PREPARED, actorId/fixtureRunId=NULL,
environmentRead=false, DB/source R2 NOT_CALLED. Старый HOLD не заменён на PASS.
Static packet `c48ee43c…` и подготовленный материал сохранены для следующего окна;
APPLY/REPLAY не отправлялись, архивные изображения не импортированы.

Browser run не выполнялся. Desktop PREPARE дал
HOLD_AUX_DEADLINE_FINISH_RESERVE_HOLD в tool session25089 только по наблюдению Root:
ROOT_OBSERVED_TOOL_OUTPUT_ONLY, raw/native feature receipt отсутствует.
Оба archive17 desktop/manager config сохранены. Native before взят из последнего
window-proof.after (`5d26ad15…`), after — `065ec257…`: BUSINESS exact,
RAW сохраняет только разрешённую разницу legacy lastUsedAt. Это не UI-приёмка.

Локально закреплены 24 full76, 12 narrow inventories и девять read-only pairs.
Все RAW/BUSINESS digests сохранены; четыре каталога и migration history84/83
стабильны (одна historical rolled back, ноль pending migrations). Сохранены все
десять полей legacy token: девять неизменны, lastUsedAt отдельно учтён;
OrgSetting exact. Original finish `70f7b91c…` / semantic receipt `52c2edb1…`
подтвердил foreign RAW и BUSINESS exact, закрытие собственных 11 пользователей /
22 ключей. Deadline `573ddfb6…` — ORIGINAL_FINISH_OBSERVED/alive=false,
flags000, owned renderer STOPPED. Собственных pending jobs нет; ноль глобальных
старых заданий не заявляется. Business cleanup/prune закрыт, старые задания сохранены.

Локальный proof без target calls:
`kp-187/.playwright-mcp/kp-187/archive17-closure-classification-5a27828f-963e-4178-a09c-4452f48b55bd.json`
(SHA `9019db466c13db70e51d3281dbed4244260b21ab09662a302d2ea06c78825aae`).
Final `fresh-archive17-run-context.json` сохранён без правок, SHA
`ebb6d54b1b571b3374b797b6409355137f6690291fff7d3d717ea06687aa2fb2`.
Scope — PARTIAL ONLY; task3.3 остаётся `[ ]`. Полные AUTH/UI/MANAGER_BROWSER,
physical №188 и archive APPLY/REPLAY №189 не приняты; main/production не затрагивались.

## Actual staging acbd: ARCHIVE19 — две diagnostic-пробы FAILED

MONEY/MEDIA PASSED: семь случаев, 27 exchanges; versions/contracts не запускались.
Archive APPLY/REPLAY и локально подготовленный INSPECT `d843eab0…` не отправлялись.
На момент закрытия19 static c48 сохранял PACKAGE_PREPARED по прежнему INSPECT
и отсутствию новых archive host calls в этом окне.

Desktop26fb остановился до image step: UI_ACCEPTANCE_UNBOUND_LOGIN_POST_BLOCKED,
operationIds/verifiedOperationIds пусты, NOT_ACCEPTED. Manager3d77 — FAILED
MANAGER_DRAFT_OWN_COVER_PROJECTION_REQUIRED, принятых случаев нет; cleanup FAILED,
context.close REJECTED, browser.close FULFILLED. Исходные результаты сохранены.
Flight `1dc1b13e…` и SSR `497d87dc…` закреплены. Локальная framing-правка450
восстанавливает два пропущенных JSON records после T79b; её SOURCE/local PASS
не меняет FAILED этого browser run и не является staging-приёмкой.

Проверены 21 full76, девять narrow и восемь read-only pairs; внешние пары обеих
diagnostic-проб имеют BUSINESS exact, RAW допускает только approved legacy lastUsedAt.
Четыре каталога и migration history84/83 стабильны; foreign RAW/BUSINESS exact
через original finish. Собственные 11/22 доступы закрыты, deadline alive=false /
ORIGINAL_FINISH_OBSERVED, flags000, owned renderer STOPPED, own pending0.
Ноль глобальных старых pending не заявляется; очистка не выполнялась.

Proof: `kp-187/.playwright-mcp/kp-187/archive19-closure-classification-d611d932-b8f1-46aa-881d-fb44d2825ec2.json`
(SHA `970f9104f315e43e60e22d9b677a3bb19faa98faa79dc555aea8baf2a9e6f9fa`).
Final context SHA `3247260b16e6c98f73180657ca0bcc81f7eaa6ceaa5e74a2847ec93628fbaa32`.
Scope — PARTIAL ONLY; 3.3 остаётся `[ ]`, UI/MANAGER_BROWSER не приняты.

## Actual staging acbd: ARCHIVE21 — APPLY отправлен, preflight HOLD

Окно без UI повторило MONEY/MEDIA PASSED. Fresh read-only INSPECT `1d484973…`
подтвердил PACKAGE_PREPARED; original502 PREPARE `fb9211ce…` / `7d5…` сохранён.
Первая локальная PowerShell DateTime parse failure произошла до вызова wrapper:
APPLY не отправлен, full76 after-anchor `7a362054…` / after `87975416…`
RAW и BUSINESS exact. Это отдельно от следующего actual APPLY `aabd9fa5…`.

Actual ACK `3589dba3…` — HOLD / SERVICE_BOOTSTRAP_STAGE_HISTORY_SOURCE_CHANGED:
AUX BEGIN выполнен, HOLD nonce сохранён. Worker успел только RR read-only SELECTs
проверки identity/_prisma_migrations и остановился до executeCli, import DML
и R2/S3 commands. Диагноз `32c3b342…` закрепляет прежний literal5d7eea8b
в history-модуле при actual acbd164c; все 83 SQL/Git hashes совпадают с control.
Это source binding отказ, повреждение истории БД не установлено. Full76
до/после actual APPLY (`a8978c21…` / `83fbf499…`) RAW и BUSINESS exact.
C48 head теперь HOLD: повторное использование закрыто, REPLAY не выполнялся,
архивные изображения не импортированы. Старый delivery и nonce сохранены.

Первый CARRY18 bind-off BUSY/HOLD сохранён; отказ lock предшествовал env mutation.
После fresh same read-only inventory `c5fe0696…` получен отдельный bind ACK
`9d007789…`. Первый AFTER_FINISH `3bf0791e…` также сохранён как REFUSED /
REFRESH_OR_DEPLOY_BUSY, а не native PASS; новый full/narrow `951be1bb…` / `b04dd742…`
проверен отдельно. Во всех 22 full76 и десяти narrow стабильны четыре
каталога и history84/83. Foreign RAW/BUSINESS через finish exact, 11/22 закрыты,
deadline ORIGINAL_FINISH_OBSERVED/alive=false, flags000, owned renderer STOPPED,
own pending0; глобальный pending0 и cleanup/prune не заявляются.

Proof: `kp-187/.playwright-mcp/kp-187/archive21-closure-classification-792f0ba6-4800-481c-815d-d067aa8df19e.json`
(SHA `7ba8c4a2d77e9c2bd3f11361df69f6bfb032e971c937a2e9a98c41ab70380fa4`).
Final context SHA `768a51044b8c84d47dd6e6f113e489cd819ec05c877c3e9e0d6b47437f5ad886`.
Все исходные RAW, HOLD и чужие изменения сохранены; 3.3 остаётся `[ ]`,
полная AUTH/UI/physical/import-приёмка не заявляется, main/production не затрагивались.

## Actual staging acbd: FULL22 — два AUTH-перехода, mixed HOLD

Собственный cohort `68f051e7…` повторил CORE4 PASSED: 11 случаев, 92 exchanges.
Revoke-admin-key прошёл bearer401/session200; director-session-version —
bearer200/session401. Это четыре actual internal HTTP probes, без browser login.
Durable intents, APPLIED readbacks и host seals закреплены: fixed CAS менял только
собственный ApiToken.revokedAt либо User.sessionVersion/updatedAt директора;
оба CAS repeated=false. Остальные stable поля проверены исходным fixed-subject
CAS/readback и credential-addback, без расширения разрешённых колонок.

Для двух PASSED переходов checker5289 перепроверил 12 native samples / шесть pairs;
RAW восстановлен из firstRaw и точных delta, credential-addback и foreign BUSINESS
exact, четыре каталога exact. Отдельные два samples / один pair mixed REFUSED
подтверждают сохранность данных и не являются успешным переходом.
Mixed-role-revocation остался generic HOLD с неизвестной здесь причиной;
его внешние before/after BUSINESS exact. Диагноз ведётся отдельно, HOLD сохранён.
Manager-deactivation не запускался. Operations в22 не запускался; prior HOLD
не принят. Роли22/scopes71 из FULL11 и boundaries10 из FULL14 остаются отдельной
исторической приёмкой, а не новыми завершёнными фазами22.

Проверены все 37 full76, девять narrow inventories и 14 typed ACK/proof refs.
Три WINDOW_PROOF связаны с исходными sealed ACK; два readbackOnly проверены
с их точными export-полями. Сохранены BEFORE_OFF/BEFORE_FINISH/AFTER_FINISH,
все RAW, десять полей legacy token и approved lastUsedAt proof. Четыре каталога
и migration history84/83 стабильны (одна historical rolled back, ноль pending).
Original finish `60c34e2e…` имеет foreign RAW/BUSINESS exact и закрыл собственные
11 пользователей / 22 ключа. Deadline `c2172777…` — ORIGINAL_FINISH_OBSERVED /
alive=false; flags000, owned renderer STOPPED. Пять собственных PURGE_MEDIA
сохранены PENDING; business cleanup/prune закрыт, глобальный pending0 не заявляется.

Proof: `kp-187/.playwright-mcp/kp-187/full22-closure-classification-f238e1e8-a3de-4a8f-aaa8-8cfbf8faf0c0.json`
(SHA `432064b213330b40e7e9ca28fbf05bc7fea10fe44f265508fd18fe05dac9ab68`).
Final context SHA `caa0d4051c663513bbe477b67efbfbe6dc61a208963a5a9a9ebaeaf1bf4825de`
сохранён без правок; reviewer target calls0. Scope — PARTIAL ONLY, task3.3 — `[ ]`.
Полная AUTH/UI/MANAGER_BROWSER/physical/archive-приёмка не заявляется;
main/production не затрагивались.

## Actual staging acbd: FULL23 — UI lead ACK, Manager FAILED

CORE4 повторён: 11 PASSED случаев и 95 exchanges. UI lead `0ddd28d0…`
имеет actual host ACK `c9e1a015…` / result `26a00b40…`:
пять PASSED случаев в scope KP_EDITOR_ONLY, два native-verified operationId
(description и PDF), mobile Save/private PDF на 390 px. На 1366 px проверены
layout и pricing; отдельный desktop Save/export в этом run не отправлялся.
PNG/PDF visual review остаётся PENDING у UI-агента, включая gray editor artifact;
полная визуальная UI-приёмка не объявляется. UI locked не допущен до PREPARE
из-за STRICT_405_SECONDS_FLOOR; producer не отправлялся.

Standalone Manager0570 — FAILED / own-product-projection, cases0, NOT_ACCEPTED.
Cleanup DRAINED: context/browser FULFILLED, readContext NOT_CREATED. Host BEGIN/FINISH
не вызывался. Внешние full76 BEFORE_MANAGER `d39cfe69…` и AFTER_MANAGER
`11f62922…` имеют RAW и BUSINESS exact; FAILED сохранён.

Локально перепроверены 31 full76, семь narrow inventories, девять read-only pairs
и 13 typed ACK/proof refs. Оба WINDOW_PROOF связаны с исходными sealed ACK;
readbackOnly проверен с удалением ровно трёх export-полей. Четыре каталога
и history84/83 стабильны, одна historical rollback и ноль pending migrations.
Три OrgSetting и девять stable полей единственного approved legacy token exact;
lastUsedAt учтён отдельно, весь RAW сохранён. Для UI checker5289 проверил 20
сохранённых native samples, пять read-only pairs и обе write-preservation receipts.
Две canonical-written private baselines восстановлены из точных RAW capture
witnesses только по порядку ключей: все значения и expected digests прежние,
исходный guard не менялся.

Original finish `1a03127f…` / semantic receipt `c09bbd73…` подтвердил
foreign RAW/BUSINESS exact и закрытие собственных 11 пользователей / 22 ключей.
Full-after-finish меняет только ApiToken/User/ChangeLog; глобальный full equality
не заявляется. Deadline `b3e36124…` — ORIGINAL_FINISH_OBSERVED/alive=false;
flags000, web b6e59072…, owned renderer052f STOPPED. Сохранены шесть собственных
PURGE_MEDIA/PENDING, подтверждённых original finish и CORE contract intents;
глобальный pending0 и cleanup/prune не заявляются.

Proof: `kp-187/.playwright-mcp/kp-187/full23-closure-classification-be523ee8-ff2a-46ea-899d-ae01cdc27605.json`
(SHA `2f53ae84561c8e8172e047695cac9818751b8ad2cc2a965cf352a84fb28555ec`).
Final context SHA `20c77bf4d816a8ec7839a2875599b542334cb7934d636c767b9130fc35bbfffa`
сохранён без правок; reviewer target calls0. Scope — PARTIAL ONLY, task3.3 — [ ].
Полная UI/MANAGER_BROWSER/AUTH/physical/archive-приёмка остаётся открытой;
main/production не затрагивались.

## Actual staging acbd: ARCHIVE24 — пакет подготовлен, import NOT_RUN

Новый delivery 7b53c333… прошёл actual RESERVE_TRANSFER 36af7664…,
PREPARE_PACKAGE a493d0af… и supplemental read-only INSPECT 5e00d0ca…;
отдельный main PID proof e22e58af… подтверждает текущий image command / PID1.
Payload 6043136 B / 292feb16… запечатан 0600 с неизменными байтами.
PACKAGE_LOAD_PROBED_NO_IO загрузил package9778 / derived schema735d, outputs93:
CLI main, target credentials, DB, source R2 и business S3 не вызывались.
В сохранённом head на момент CLOSED24 — PACKAGE_PREPARED, actorId/fixtureRunId NULL,
не HOLD. Это историческое состояние24, а не утверждение о текущем delivery в25.
Старый c48 HOLD и все исходные receipts сохранены без retry/repair.

APPLY и REPLAY в24 не отправлены; AUX BEGIN не вызывался. Root dispatch admission
зафиксировал 384543 ms < 405000 ms в 01:06:41Z и NOT_ADMITTED_NO_PRODUCER_DISPATCH.
Это manual Root time floor, не ответ API/importer и не импортная приёмка.
MONEY/MEDIA завершены: семь PASSED случаев, 27 exchanges, обе quarantine restore ACK.
UI/AUTH/versions/contracts в этом cohort не запускались.

Перепроверены 19 full76, девять narrow inventories, шесть read-only pairs и пять
исходных36de ACK seals. Все raw/business digests пересчитаны без изменения RAW;
четыре каталога и history84/83 exact, одна historical rollback, ноль pending migrations.
Все поля трёх OrgSetting exact; у единственного approved legacy token неизменны
девять stable полей, lastUsedAt сохранён отдельно. RESERVE/PREPARE/INSPECT/OFF
и capture-quarantine не изменили BUSINESS; изменения RAW от approved legacy
lastUsedAt сохранены и проверены исходным checker5289.

Original finish 68f61f90… / semantic receipt43a815a8… закрыл 11 пользователей / 22 ключа
с foreign RAW и BUSINESS exact; full-after-finish меняет только ApiToken/User/ChangeLog.
Deadline99245736… — ORIGINAL_FINISH_OBSERVED, alive=false, без заявления autoexpiry
или server TTL. Flags000, OFF web774724d7…, owned renderer9e1ca718… STOPPED.
Собственных pending jobs по original finish0; глобальный pending0 не выводится,
старые jobs и business cleanup/prune не затрагивались.

Proof: `kp-187/.playwright-mcp/kp-187/archive24-closure-classification-4bb08b97-eb8d-4e68-8299-01f5af38d1a5.json`
(SHA `993accacca0458f8840b078ef026985f22582118162bc816198992dcdef77100`).
Final context SHA `43f4259ce626dc1b2ed31ff47d05e8b87ca0b0519c19afa2696f989d47e094f6`
сохранён без правок; reviewer target calls0. Scope — PARTIAL ONLY, task3.3 — [ ].
Archive APPLY/REPLAY и полная приёмка остаются открытыми; активный25 этим receipt
не классифицируется, main/production не затрагивались.

## Actual staging acbd: ARCHIVE25 — reserve DML, APPLY HOLD

MONEY/MEDIA PASSED: семь случаев / 27 exchanges. Actual APPLY d8cc4603…
отправлен, ACK2a2167be… — HOLD / ARCHIVE_TARGET_STORAGE_CHANGED
(outer ARCHIVE_ROOT_WORKER_ACK_UNKNOWN_HOLD). AUX BEGIN состоялся, HOLD nonce
сохранён; delivery3c027 / run7b53 теперь HOLD и повторно не используется.
REPLAY не отправлялся; старый c48 HOLD сохранён. Исходный CLI storage predicate
и его representation-диагноз ведутся отдельно, этот receipt ничего не исправляет.

Full76 BEFORE_APPLY9f09ce19… → AFTER_APPLY80fb61e2… / diff78ecb853…
подтверждают reserve DML: +23 CommercialProposal, +6 ProposalContract,
+258 ProposalMedia, +7 ProposalArtifact, +530 ProposalJob и +30 ChangeLog.
ProposalItem/ProposalVersion и таблицы published media/contract refs exact;
публикация174 items/versions не состоялась. S3 PUT первых семи DOCX возможен:
нулевые I/O/SQL эффекты не заявляются, отдельный OFF HEAD/GET/state readback pending.
В 69 остальных RAW таблицах изменений между этими двумя snapshot нет;
изменение ApiToken проверено approved lastUsedAt projection. Приросты сами
по себе НЕ доказывают сохранность прежних строк внутри шести изменённых таблиц.

Перепроверены 19 full76, семь narrow inventories, шесть typed ACK/proof refs
и семь read-only pairs. Четыре каталога и history84/83 exact; три OrgSetting
по всем полям exact, RAW legacy telemetry сохранён. Original finish4e59abcd…
/ semantic92b47602… закрыл11 пользователей/22 ключа с foreign RAW/BUSINESS exact
только через сам finish; это не переносится на предшествовавший APPLY.
Сохранены265 PURGE_MEDIA/PENDING — exact cleanup IDs из manifest, не глобальный0.
Deadline41137602… — ORIGINAL_FINISH_OBSERVED/alive=false, OFF f1cfb535…/flags000,
owned renderer ef406f76… STOPPED; cleanup/prune не выполнялся.

В receipt закреплены exact reserved ID families и recipe дополнительного
REPEATABLE READ READ ONLY proof: только id23/6/258/7/530/30, плюс один проверенный
finish ChangeLog ID; без prefix/parent-FK masks и без исключения User/ApiToken.
Expected snapshot сохраняет BEFORE_APPLY и подставляет только проверенные
AFTER_FINISH credential-table fingerprints. Этот readback НЕ выполнен:
сохранность original rows в изменённых families остаётся PENDING, не PASS.

Proof: `kp-187/.playwright-mcp/kp-187/archive25-closure-classification-b53e7fbc-565b-4055-b840-5f925b972262.json`
(SHA `6d11e8a5716c762e8589311df4cf1964ef58e3b47dcefa359acbc252a440dc85`).
Final context SHA `11f242a656662b53347627e756bb922b14ee1381e26eff608930ca710197b77f`
сохранён без правок; reviewer target/env calls0. Task3.3 — [ ]; archive import,
replay, physical S3 и полная приёмка не приняты; main/production не затрагивались.

## Actual staging acbd: ARCHIVE25 supplemental RRRO — original rows preserved

Root actual OFF read-only capture bd0f589a… завершился PRESERVED /
C25_ORIGINAL_ROWS_PRESERVED, expectedBusinessEqual=true, rowsDelta/catalogDelta пусты,
writes0. Raw response сохранён до parse; checker5289 отдельно перепроверил полные
и filtered RAW/BUSINESS digests. Этот новый proof закрывает PENDING preservation
из предыдущего раздела; исходный classification6d11 не переписан.

Граница сравнения явная: шесть families CommercialProposal/ProposalContract/
ProposalMedia/ProposalArtifact/ProposalJob/ChangeLog сверены с BEFORE_APPLY9f09…
после исключения только exact manifest IDs23/6/258/7/530/30 плюс один exact verified
finish audit ID. Во всех шести filtered RAW и BUSINESS exact. Остальные70 таблиц
сверены с verified AFTER_FINISH a864…: 69 RAW exact, ApiToken — только approved
legacy lastUsedAt projection с сохранением RAW. User/ApiToken не исключались;
11 inactive/22 revoked и semantic finish receipt92b47602… повторно проверены.
Четыре каталога и history84/83 exact; filtered BUSINESS ca329b26… совпал
с закреплённой hybrid expected map. Это proof CLOSED25 до UI26, без последующих
данных и без заявления единой неизменности всех таблиц с момента до setup.

Первый reader receipt68efbc51… остаётся HOLD / C25_HISTORY_CHANGED. Причина —
ожидался acceptance digest старого5d, хотя unchanged acbd history predicate
успешно проверил83 SQL/84 rows и вычислил revision-bound digest eb055f9a… .
Новый source-only derivative5081 меняет ровно expected acceptance SHA и compiler
profile pin; reader/runner, SQL predicates, все IDs и expected76 прежние.
Source whole-inverse и Native NO FINDINGS сохранены; 5 history regressions и
6 scope checks/strictTS/INERT прошли. Ошибка metadata сравнения не переименовывает
старый HOLD в успешный actual run.

Proof: `kp-187/.playwright-mcp/kp-187/archive25-preservation-supplement-18d5813d-8da5-4e71-b972-a8eb7d904ba6.json`
(SHA `95ba792cba62e00f75232d1f090f31413c8478c57c301b2958e8ae3b623eb4cd`).
Archive APPLY2a2167 остаётся HOLD, nonce и reserve DML/265 pending сохранены;
REPLAY/import не приняты. S3 proof ведётся отдельно и этим SQL reader не снимается.
Task3.3 — [ ], main/production и closed context не менялись; reviewer targets/env0.

## Actual staging acbd: FULL26 — locked HOLD, readonly diagnostics сохранены

CORE4 повторён: 11 PASSED случаев / 89 exchanges. Mobile390 выполнил только
READONLY_MOBILE_EDITOR_VISUAL_DIAGNOSTIC: settled=true, одна видимая section,
нулевые operationIds. Два PNG сохранены; Root сообщил legible/no clipping.
Статус остаётся DIAGNOSTIC_NOT_ACCEPTED, Bell failures сохранены отдельно.
Один mobile native read pair проверен checker5289 по exact RAW witness;
внешние full76 before/after имеют BUSINESS exact с сохранением approved telemetry RAW.

Standalone Manager9a — FAILED / browser-download после пяти PASSED случаев,
pageErrors0, cleanup DRAINED (context/browser FULFILLED). Host BEGIN/FINISH
не трогался; внешние BUSINESS exact. Исходный assertion SHA10985… сохранён.
Позднее source review f232/328cf подтвердило только QA fix установленного
Playwright1.63 download sentinel и initial strict Bell gate; новый actual Manager
run этим не заменён, прежний FAILED не принят.

UI locked e390beda… — HOLD/NOT_ACCEPTED. До failure действительно выполнен
один contract settings save d9ab945a…; intent и verification имеют статус VERIFIED
под original2b95. Это не PDF/CP save и не полный PASSED locked-сценарий.
Из пяти actual native raw samples восстановлен exact raw baseline; все значения
целиком совпадают с canonical-written intent, expected hashes не менялись.
Checker5289 подтвердил foreign RAW/BUSINESS exact сохранения contract settings.
Внешний before/after изменяет только ApiToken, ChangeLog и ProposalContract.
History-summary locator failure остаётся UNDER_INVESTIGATION; AUX HOLD и evidence
сохранены без retry/clear, успешный сценарий не объявляется.

Перепроверены 28 full76, шесть narrow inventories, восемь read-only pairs и
11 typed ACK/proof refs; оба WINDOW_PROOF связаны с исходными ACK, не self-seals.
Четыре каталога и history84/83 exact, три OrgSetting по всем полям exact.
Original finish42dee07e… / semanticddd9b8e4… подтвердил foreign RAW/BUSINESS exact
через finish; его full changes — только ApiToken/User/ChangeLog. Между последним
UI snapshot и finish-before записан ApiToken RAW delta; full equality этого gap
не заявляется без отдельного full API projection witness. Все исходные RAW сохранены.
11 пользователей inactive / 22 ключа revoked; deadlinea9350f90… —
ORIGINAL_FINISH_OBSERVED/alive=false, flags000, web3acc678d…,
owned renderer e4f93fb2… STOPPED. Пять текущих PURGE_MEDIA/PENDING сохранены;
глобальный pending0 и очистка старых archive jobs не заявляются.

Proof: `kp-187/.playwright-mcp/kp-187/full26-closure-classification-f9ba2ee0-af55-4144-ac69-bd778fc7693a.json`
(SHA `0d6176f30fef74c4dbe7fc6d94ce11d16e7eadd3ae060388f27d375f076c8089`).
Final context SHA `b6af425416c103f1735913a5363ea06b537bb2a8ee1bd8a5295259b9c71cd26a`
не изменялся; reviewer targets/env0. Scope PARTIAL ONLY, task3.3 — [ ].
UI locked/MANAGER_BROWSER/full UI, текущая AUTH, physical188 и archive import/replay
не приняты этим cohort; main/production не затрагивались.

## Actual staging acbd: CLOSED27 AUTHNEXT — operations HOLD

Логический cohort27 использует schema20 donor без переименования старого metadata.
CORE4 PASSED: 11 случаев / 99 exchanges. Managerf232 — FAILED до первого case:
MANAGER_DRAFT_FIRST_BOUND_BELL_READ_REQUIRED, verified Bell reads0, pageErrors0,
cleanup DRAINED, host BEGIN/FINISH не трогался. Внешний before/after BUSINESS exact.
Source sibling55a4 с одним normal Bell open принят только source-review;
actual f232 failure сохранён и не становится PASS.

AUTH operations e093ce45… остался HOLD / QA187_COHORT_DEADLINE. Native report e9018197…
закрепил полные stdout225151 B / stderr0, 132 RAW samples с проверенными SHA и
66 before/after pairs: foreign BUSINESS exact, credential addback stable,
четыре каталога exact. Причина — прежний phase-local80s budget с pre-fetch guard,
не timeout135 транспорта и не fixture TTL; 66-й HTTP не отправлен. Последовательный
source позволяет вывести65 завершённых probes, но error envelope не содержит
sealed per-case cases/exchanges; full operations PASSED не заявляется.

Отдельный keyless native SQL receipt60a8b57c… содержит18 unique operations.
Неизменённый matrixBinding передаёт их без фильтра; frozen matrix3ceb6b76… задаёт
четыре probes на operation: planned72, inferred completed65, blocked-before-HTTP1,
ещё6 не запускались. Это дополнительный source/catalogue proof; исходный Native
report с UNKNOWN total и actual HOLD не переписан. Исторические120/30 totals
сюда не переносятся. Остальные два credential transitions NOT_RUN. UI geometry/
locked не допущен по неизменённому405s floor, PREPARE и producer не отправлялись.

Перепроверены26 full76, четыре narrow inventories, семь read-only pairs,
11 typed ACK/proof refs; оба WINDOW_PROOF — ссылки на исходные sealed ACK.
History84/83, четыре каталога и три OrgSetting по всем полям exact.
Внешний operations before/after меняет только ApiToken с прежним count:
собственные bearer lastUsedAt — разрешённая credential telemetry, поэтому
глобальная BUSINESS equality этого outer pair не заявляется вместо Native
foreign+credential-addback proof. RAW не удалён и не нормализован.

Original finishfb578c5a… подтвердил foreign RAW/BUSINESS exact и закрыл11/22;
его full changes — только ApiToken/User/ChangeLog. Deadlinead34b54c… —
ORIGINAL_FINISH_OBSERVED/alive=false; flags000, web57193112…,
owned renderer82bee88c… STOPPED. Пять текущих PURGE_MEDIA/PENDING сохранены;
глобальный pending0 и cleanup/prune не заявляются.

Proof: `kp-187/.playwright-mcp/kp-187/closed27-authnext-classification-b27681f9-4284-435b-99ba-d736fedb1140.json`
(SHA `536b8801d7f8f1752bcfe2f8b3e4c13ee2957f4a86d1e80c1ea77da5dc27f01b`).
Final context SHA `6ad6c292fe9b9f84b5ce2cf8c3e6cf614c3df38ce48efe24bb6206332c37b730`
не менялся; reviewer target/env0, новых tests не запускалось. Task3.3 — [ ];
полная AUTH/UI/MANAGER_BROWSER/physical/archive приёмка остаётся открытой.

## Actual staging acbd: CLOSED31 — AUTH operations 72/72 приняты

Root и независимая проверка Manager приняли текущий каталог из18 операций:
два batch, все72 GET cases PASSED, включая own-key200 и три изоляционных404
на каждую операцию. Собственные CORE4 prerequisites также PASSED.
Aggregate: `kp-180/.playwright-mcp/kp-integration/auth31-complete-operations-6d3744fa-4efa-4f05-bf0f-85ab1922caf9.private.json`
(SHA `ce4c3196d12a3c557f2ba32ec51969f6283c23fa3c74054480134ebd7573b58c`).

Перепроверены все144 SQL snapshot /72 before-after pairs: foreign BUSINESS и
credential addback exact;70 пар RAW exact, две имеют только прежний approved
legacy ApiToken.lastUsedAt delta с сохранением исходного RAW. Также проверены
43 full76 snapshots,18 narrow inventories и неизменность четырёх каталогов;
три OrgSetting стабильны по всем полям. Это покомпонентное доказательство
с учётом собственных разрешённых мутаций, не заявление whole-DB equality
от начала до конца cohort и не перенос результатов исторических HOLD.

`mixed-role-revocation` и `manager-deactivation` — NOT_DISPATCHED / accepted=false:
по сохранённому Root admission-выводу local405s floor отказал до HTTP;
transition AUX run отсутствует. Оба перехода остаются pending, без фиктивного PASS.

Закрытие: flags000, новый OFF web03eed87d…; owned renderer b10309be… STOPPED.
Original finish SHA `a91c9a7a7aaa8f8620a57b00940e7a0002fdbf232b5f3146cde8229bcd8d3155`
закрыл11 пользователей/22 ключа; terminal SHA `8fa73b31deb625c993bece20c874fd3f6fa4afe4168759de2e7805b0f556c01b`
подтвердил ORIGINAL_FINISH_OBSERVED/alive=false. QA-off receipt3ede89f9… сохранён.

Classification: `kp-187/.playwright-mcp/kp-187/auth31-closure-classification-459e6795-760d-4a3a-b7f4-a9a368393064.json`
(SHA `66d5138843d76cc1ea20648c6bf4d4c524a3aa28108ee0dd300386b949fb5788`),
CLOSED31 context SHA `a9ba9b74ce5fff1e826e3389c0da85efc21b4a88148c165b0086250943bc753a`.
Исторические HOLD и остальные pending gates сохранены; task/checklist этим
обновлением не меняется, полная AUTH/UI/physical/archive приёмка не объявляется.

## Actual staging acbd: Manager 5+1, UI34 Locked/Mixed и AUTH35

20.10.2026 Root принял следующие компоненты на прежних acbd164c / image8ef120a6:

- **MANAGER_BROWSER — шесть случаев составным evidence, без повторения пяти.**
  Пять настоящих PASSED случаев FULL26 (detail, project card/backlink, global SSR,
  omnisearch, FileViewer) приняты по supplemental preservation
  `manager-draft-browser-download-only-4e244c2d-composition-preservation.json`
  (SHA `ac1395449c6a5cd2d16bf1e680b60c3467d4fab883007b0f74edf22057fa968c`).
  Только недостающий `own-ProductFile-real-browser-download` выполнен отдельно в UI34:
  `manager-draft-browser-download-only-run-4e244c2d-7b25e8f5-fe7c-4b26-af11-e04ef94d7345/receipt.private.json`
  (SHA `e8ec78e6c419a11fd92ff007f96bc88bf2d9c75e8413df89dd39b920658c3bfa`), PASSED/cases1, cleanup DRAINED.
  Исходный FULL26 program FAILED/nativeAfterNULL и другие неуспешные попытки сохранены.
- **UI34 Locked — восемь PASSED случаев**, 390/1366, scope KP_EDITOR_ONLY:
  `ui-acceptance-run-34ade56d-bd1f-4c10-a6e6-d87e52c7608e/receipt.json`
  (SHA `a6c4b7884a91c2afa2bcc70bef483c321278e803d0ba2204b36daa5f239aa307`).
  Original host ACK seal `8db51320de9fef2eb75d08b3a9814f14bbed48b9e6c101d08fa3fb30d98b64c3`;
  background Bell/prefetch diagnostics не объявляются приёмкой всего приложения.
- **UI34 mixed-role-revocation — два PASSED GET401 случая**, Bearer/session:
  `aux-acceptance-root-private-fa149c99-e240-46e5-b321-592266e5a1f8/aux-invoke-fa149c99-e240-46e5-b321-592266e5a1f8.private.json`
  (SHA `42282f9a6f746d15c348260106265171c8bfca9c9a740e70d2bf7b346ea7b0d1`),
  host ACK seal `b536fdddd3e3c4d8e2c096bf7c25f2eed6cda56de03d946c558f967cce92098c`.
  Эти UI34 результаты относятся к CLOSED context SHA `98f9442b300d8a1b0eb85e49719df2f466711dda0ccf33ed209043bc8938c86b`,
  а не к заново выполненным фазам AUTH35.
- **AUTH35 active-owner functional case принят отдельно.** Manager-deactivation
  действительно применён один раз: active=false/SV1, точные 12 ключей владельца,
  11 новых отзывов, прежний revoked key и остальные поля сохранены; затем два
  настоящих Bearer/session GET401. Это штатный эффект applied trigger,
  не isolated inactive-user с неизменным unrevoked key. Producer PASSED и original
  host ACK подтверждены; original outer остаётся HOLD_MISSING_BOUNDARY: after-narrow
  был REFUSED/KP_REFRESH_OR_DEPLOY_BUSY. Отдельный поздний readonly after-control
  подтвердил тот же BUSINESS after; producer не повторялся и outer не переименован в PASS.

AUTH35 classification сохраняет все 69 ранее проверенных raw refs/SHA: шесть inner
SQL samples/три RAW-exact пары, foreign BUSINESS+credential addback exact;
44 full76, 12 успешных narrow, четыре каталога exact. Transition меняет BUSINESS
только User/ApiToken; единственная дополнительная RAW-дельта между original after
и recovery — разрешённый legacy ApiToken.lastUsedAt. Whole-cohort equality не заявляется.
Original finishdfa278… дал foreign RAW/BUSINESS exact, terminal794fbf… подтвердил
ORIGINAL_FINISH_OBSERVED/alive=false и 11 inactive/22 revoked; flags000,
OFF webbfc41a… / owned renderer3ce8… STOPPED. Исходный busy receipt и HOLD сохранены.

Новые immutable evidence в `kp-187/.playwright-mcp/kp-187/`:
`auth35-closure-classification-5d61a064-7e58-4f59-bff4-04e5e185a761.json`
(SHA `c068deca861894597ef04e37643240d32b7c31dfbad562c338a422643f478b25`)
и одноимённый `.md` (SHA `d1456aebd7959d3664c4e525a00b3cfe2527e574f349994e1bdbe70c3166928e`).
CLOSED35 context SHA `a4a6d049eb20f294e3a1164169e2b0b68c46ab55c1a2ceccbd2d44ce52b36e0c`.
Прежние AUTH31/72 и остальные принятые компоненты не переоткрываются и не повторялись.
Task 3.3 остаётся [ ] для оставшейся сквозной приёмки, включая physical №188 и
полный cutover №189; switch/production этим evidence не принимаются. Лимиты
405/890/900/135 и matrix guards не менялись; новых target calls/tests не выполнялось.

## Остаток обязательной приёмки после CLOSED43, 20.10.2026

FULL43 дал настоящий read-only warm capture, затем остановился на локальной
привязке secondary и не был допущен к дальнейшим physical-командам. Version/delete,
marker/prune/retry/annual и послепрунинговый retained/restore410 результат этим
cohort не доказаны; physical №188 остаётся NOT_ACCEPTED. Это не отменяет ранее
принятые CORE4, AI01, UI, AUTH и обычные версии/PDF/договоры.

Окно закрыто штатно: flags000, owned renderer STOPPED, 11 пользователей inactive
и 22 ключа revoked. CLOSED context
`kp-180/.playwright-mcp/kp-integration/fresh-full43-run-context.json`
(SHA `0aa61d40171d87c89c6d517ec74fde17f5e54d44a8629da6b7bce5d194747b74`);
original finish SHA `88a09d3f3ec715261d03eceda3b0acc5e20eae81b3696afd578f16f79e62411b`,
terminal SHA `790775854b4a012e58062d45de18340e74841084f837a22551429108a004963c`
подтвердил ORIGINAL_FINISH_OBSERVED/alive=false. Старые HOLD и исходные receipts
не изменены. Нового принятого SHA/образа и final deployed composition пока нет;
task3.3 остаётся `[ ]`. Эти записи не разрешают production/main или отмену
оставшихся обязательных проверок; новых тестов/target calls этим обновлением нет.

## CI307: missing-ready barrier в существующем browser fixture, 20.10.2026

В CI307 на staging c442 components0 прошли68/69 случаев; прежний products
kanban test остановился на `missing_exact_consumed_no_late_SSE_focus`
(`kanban-search-focus-browser.mjs`, прежняя строка159): вместо `{left:0,top:0}`
получено `{left:884,top:1313}`. Это initial missing-response/SSE сценарий;
отдельный post-manual-scroll guard на142 не падал. По проверке Root оба CI runner
были Ubuntu24.04.5; смена ОС и Node не объявляются причиной отказа.

Source допускает timing race: `apply()` ждёт clientQuery/pending и два RAF,
но ProductsKanban применяет rows отдельным effect; hook потребляет отсутствие
точного совпадения только при ready=true/cardId=null. Если SSE возвращает target
раньше этого commit, поздний focus ещё допустим. Committed state исходного CI
отказа не записан, поэтому это гипотеза причины, а не доказанный runtime trace.
В существующем QA wrapper добавлен только committed-focus сигнал через useEffect;
перед SSE тест ждёт ту же query с ready=true/cardId=null. Оба исходных scroll
assert сохранены. Production ProductsKanban/hook, sleeps/retries и глобальные
timeouts не менялись; новых тестов не добавлено.

Локально ровно один запуск существующей проверки:
`pnpm --filter @pero/web exec node --test tests/product-kanban-search-readiness.test.mjs`
— **1/1 PASS**, skipped0, около31.4s. Предшествующий
`pnpm --filter @pero/web exec node --check tests/kanban-search-focus-browser.mjs`
— PASS. Это локальный browser fixture с контролируемым транспортом, без CRM DB/S3
или live staging; прежний CI307 failure не переписан в PASS. Новая CI/staging
приёмка этим запуском не заявляется, task3.3 остаётся открытой.

## 21.10.2026 — функциональная сквозная приёмка завершена

Прежние API/auth/UI/AI proofs сохранены с собственными SHA/образами и принятой
эквивалентностью acbd→ab5. На staging `ab5b243f1e3cddd5c915ebdb70b6bff7be3a815e` /
CI308/run39462920003 завершены physical55 10/10, original quarantine RESTORED,
настоящий retained SDK и последний ordinary LEAD/version/data/PDF/restore410.
App/SDK client467e и реальные HTTP routes/body не менялись из-за исправлений QA-обвязки.

Итоговый [index](D:/Projects/pero_crm_worktrees/kp-187/.playwright-mcp/kp-187/closed55-final-existing-cases-acceptance-20261021.private.json),
SHA `05257a9bf7a00ee0bc9302d3ea4bb4acd06d28850d464d84ee90d48aae2b8e11`,
связывает physical515739, RESTOREd04, SDK22cc/01aa и последний resulta426.
Подтверждены настоящий переход в LEAD, GETversion200, один POSTrestore410
`KP_MEDIA_UNAVAILABLE`, неизменный current document и PDF200/314719bytes/SHA54424254.
Для отказа полные76 RAW/BUSINESS, catalog и22 key digests exact. Уведомления восстановлены.
Последний actor1991 безопасно закрыт: OFF000/owned rendererSTOP, original FINISH2083
и keeper6a3a подтвердили11inactive/22revoked/alivefalse. SETUP foreign76RAW/BUSINESS
exact; FINISH foreign BUSINESS76/catalog exact, RAW содержит только отдельно
сохранённое согласованное8bb4/e454 lastUsedAt. Исторические HOLD не переписаны.

Пункт3.3 функционально завершён; новых тестов и повторов успешных компонентов нет.
Финальная публикация общего staging после одного штатного CI, проверка новых SHA/
образов, постоянный OWNER110 и подключение установленного skill/MCP к рабочему
ключу выполняются Root отдельным операционным шагом и receipt. Пока рабочий ключ
отсутствует, установленное подключение не объявляется готовым. Business retention0
по AGENTS.md сохраняется; owner UAT, main и production остаются отдельными этапами.
