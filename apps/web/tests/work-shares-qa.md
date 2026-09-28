# Guarded QA: universal-work-shares

Helper — ES module `work-shares-owned-fixtures.mjs`, без auto-run, console и подключения при import. В этой подготовке БД, runtime, миграции и remote не запускались. Root выполняет отдельное ревью и разрешённый rollout по `D:\Projects\pero_infra\infra-recovery\SAFETY-RULES.md`; guard mismatch означает STOP.

## Контракт транспорта

`executeOwnedQa(request, options?)` возвращает `{ publicSummary, privatePayload }`. В обычные логи допускается только `publicSummary`. Private payload содержит HMAC envelope/QA identifiers либо короткоживущие sessions; только приватный процесс root, не Git и не вывод tool/terminal.

Request: `target: "local" | "staging"`, `operation`, при необходимости `envelope`, `durablePlanSha256`, `durableCheckpointSha256`, `actionsDrained`, `baseUrl`.

- Local: `CRM_LOCAL_CONTAINER_ID` должен совпасть с точным существующим `pero_crm_pg`; helper проверяет container ID, volume `pero_crm_v2_pgdata`, bind `127.0.0.1:5433`, DB/user `pero_crm`/`pero`. Пароль читает только в память. Отдельный случайный `AUTH_SECRET` задаёт root через env либо `options.authSecret`, затем использует тот же secret в локальном runtime и последующих операциях.
- Staging: только runtime `S3_BUCKET=pero-crm-staging`, PostgreSQL URL `db:5432/crm`, user `crm`, без fragment/дублирующихся options. Schema отсутствует либо равна `public`; `current_schema()` проверяется, весь application SQL явно адресует `public`. `AUTH_SECRET` берётся только из runtime env; override из request/options запрещён. Helper не заменяет внешний host/Docker/image/DB-volume guard root: он обязателен перед каждым вызовом. Защищённый JSON request передаётся через env, не argv; SSH pipe с private response остаётся приватным у local coordinator.
- Production не является допустимым target. Helper требует уже применённую `20260928140000_universal_work_shares`; не выполняет migrate/schema/seed/reset.

Canonical envelope bytes: `canonicalEnvelope(envelope)` — сортировка всех object keys, неизменный порядок массивов, compact UTF-8 JSON и ровно один завершающий LF. SHA256 вычисляется `envelopeSha256(envelope)`. HMAC проверяет format/body; secret в envelope не входит.

| Operation | Результат / условия |
|---|---|
| `plan` | Read-only inventory, шесть UUID, новый runId, random Argon2 hashes, baseline 34 таблиц; возвращает `envelope`, `canonicalUtf8`, `sha256`. Активный envelope не заменяется, обнаруженные прежние QA users запрещают новый run. |
| `prepare` | Root **сначала** atomic-write private envelope на Windows, readback и SHA; затем отдельный вызов с unchanged envelope и `durablePlanSha256`. Одна транзакция создаёт 2 User + Project + Work + A/B + ребро B→A. Если строки уже есть — STOP `PREPARE_ALREADY_PRESENT_USE_INSPECT`, повторных INSERT нет. |
| `inspect` | После неизвестного результата prepare сверяет заранее известные IDs/identity и foreign hashes; возвращает PREPARED либо ABSENT без новых вставок. Partial/неоднозначное состояние — STOP. |
| `sessions` | Только после подтверждённого наличия шести записей; `baseUrl` строго local HTTP или `https://staging-crm.peromebel.by`. Private `sessions` для manager/worker/mounter, TTL 900 секунд, cookie specs. Они не входят в checkpoint. Это не парольный вход. |
| `capture` | Доказывает app-generated C/D/group и связанные последствия, сверяет foreign baseline; возвращает подписанный CAPTURED envelope с exact keys и наблюдаемыми QA суммами. |
| `cleanup` | Root дожидается всех browser actions/responses и закрывает contexts, сохраняет/readback CAPTURED envelope; передаёт `durableCheckpointSha256` и `actionsDrained:true`. До DELETE — ownership + неизменность foreign rows; после DELETE — полный baseline внутри той же транзакции, иначе rollback. |

После неизвестного результата cleanup нужно `inspect`/повтор cleanup с прежним durable CAPTURED envelope: отсутствие всех собственных записей + полный baseline подтверждают завершённую очистку. Не запускать новый `plan` и не менять неизвестные строки.

## Сценарий и ownership

Private plan содержит `project`, `work`, `source` (A), `dependent` (B), `fractionalTitle` (C), `users[0]` WORKER, `users[1]` MOUNTER, `manager`, `taskType`, `dueAt`, `currency`. Existing manager/client и optional active PriceItem используются по ID; реальные email/password не читаются. Project.numberInt=-2000000000 не увеличивает обычный max. QA users имеют полный runId в name/.invalid email, PIECE и случайные пароли, которые не сохраняются и не возвращаются.

Work: quantity10.30 × price100 = total1030. A: quantity10 и бюджет1000, B без Work зависит от A. Browser manager идёт непосредственно в QA project, создаёт C через «Все» (quantity0.30); не меняет настройки списков реального manager. Затем WORKER делит A на30% MOUNTER: A700/D300, один group qty10/budget1000. B должен зависеть от A и D; C начисляет30. Повтор DONE не должен создать второй PayrollEntry.

C принимается только по единственному planned title + собственным project/work + manager creator + create ChangeLog. D и group — только через `task-split:<requestId>` receipt исходной A, QA actor/recipient и связь group.workId/parts. Не больше четырёх Task/одной group. Реальные C/D/group IDs берутся из ответов/receipt и возвращаются в `privatePayload.observations.tasks`; ничего не угадывается.

Ownership и успешность приложения разделены: неверная сумма в доказанном собственном PayrollEntry — `dataChecks=FAIL`, но запись остаётся безопасно очищаемой. Root дополнительно проверяет `settlementComplete` и реальные browser assertions: helper сам браузер не запускает. Чужой ID/связь, изменённые роль/имя/email/hash QA пользователя, неопознанная запись или уведомление — STOP.

Org notifications связываются с точными собственными статусными ChangeLog/DomainEvent либо фактическим собственным PayrollEntry (включая сумму, QA name и task/project body). Одной даты/префикса/project link недостаточно. `/my` допускается только для собственных QA users и ожидаемых templates. Existing manager prefs не восстанавливаются этим helper: их изменение — foreign drift; собственные `my.view` двух QA users удаляются только exact composite keys.

Registry изучен: `file-stages`0.1.0/API1 не имеет hooks; `demo` имеет onDomainEvent и создаёт PluginRunLog без eventId, поэтому включённый demo/неизвестный hook set блокирует helper. Disabled plugins сохраняются. Startup metadata Plugin исключена из hash, но IDs/enabled и все PluginSetting защищены.

Все 34 application tables fingerprint-ятся server-side (count + hash), без выгрузки email/passwordHash реальных User. Capture исключает только доказанные own keys. Новые Payment/Payout/File/Product или неизвестные связи остаются foreign и запрещают cleanup. DELETE использует exact IDs/composite keys и повторный ownership readback под транзакцией; существующие строки не обновляются.

Единственное исключение для ApiToken — колонка `lastUsedAt`: fingerprint использует `to_jsonb(t) - 'lastUsedAt'`. Штатный `recordUse` в `src/server/plugins/tokens.ts` обновляет её при API-запросах, поэтому concurrent usage не считается изменением конфигурации. Все строки, count, id, name, prefix, scopes, tokenHash, pluginId, createdById, createdAt, revokedAt и любые будущие поля остаются в проверке. Helper не меняет и не восстанавливает timestamps; ownership, write-пути и exact DELETE не расширены. Подписанный baseline должен быть получен текущей версией helper; старые envelopes с полной проекцией не переписываются и могут безопасно остановиться на несовпадении hash.

Write-операции: task advisory lock18435/55001, затем краткие application table locks SHARE ROW EXCLUSIVE, ReadCommitted для свежего снимка после ожидания; lock_timeout5s, statement_timeout30s, transaction timeout60s. После precheck таблицы остаются защищены до postcheck/commit. Browser стадия locks не держит. Read-only этапы — RepeatableRead. Это требует root внешней сериализации с refresh/deploy; helper её не имитирует.

## Проверки подготовки

`pnpm exec tsx --test tests/work-shares-owned-fixtures.test.ts`: in-memory/DI safety, без БД/Docker/remote. Покрываются HMAC tamper, production denial, durable plan, missing migration, partial prepare rollback, inspect после потерянного ответа, max4, foreign IDs/платежи/roles, receipt C/D/group, неоднозначные org notifications, exact cleanup и post-delete rollback. Содержательный RED: одно совпадение project link ошибочно принимало неатрибутированное org notification; после корреляции status receipt/event — GREEN.

Review P2 воспроизведён отдельным RED: `schema=other` достигал adapter до отказа. После фикса schema/protocol/fragment и duplicate options отклоняются до adapter; нормальные absent/public schema допускаются. Весь application SQL закреплён за public, включая locks и Role enum.

Коррекция ApiToken 28.09: DI RED на прежней полной проекции — **23 PASS / 1 FAIL**, изменение только lastUsedAt давало `FOREIGN_ROWS_CHANGED`. После вычитания ровно этой колонки — **24/24 PASS**. Проверены null→дата и дата→новая дата с сохранением актуального timestamp после cleanup; scopes/hash/revocation/identity и прочие поля, добавление/удаление токена по-прежнему останавливают до DELETE. Одноимённое поле другой таблицы не исключается. Фактические PostgreSQL/remote проверки здесь не выполнялись; тестовый adapter использует ту же политику проекции, что и SQL. Scoped ESLint и `tsc --noEmit --incremental false` — PASS.

Bundling root: ES module/Node22, external `@prisma/client` и `@node-rs/argon2`; JWT dependencies могут включаться в bundle. Импорт готового bundle не подключается к БД. Private plan/checkpoint/session artifacts, stdout SSH pipe, DTO и скриншоты не добавлять в Git. Unit/DI и bundle smoke не являются доказательством реального PostgreSQL rollback или local/staging UI приёмки — их выполнит root после review.
