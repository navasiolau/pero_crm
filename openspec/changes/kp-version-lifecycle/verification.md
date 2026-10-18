# Verification

Дата: 18.10.2026. Ветка `feature/185`, исходная база `d918ab860ec5aab029c466a3b3c3b1ce06f0ec98`. Собственные изменения №185 не закоммичены. Разрешённая локальная интеграция зависимостей описана отдельным срезом ниже; собственные commit/push не выполнялись.

## Настоящая локальная SQL-приёмка root — PASS

Root выполнил `verifyKpVersionNative` на существующем `pero_crm_pg`, `127.0.0.1:5433/pero_crm`, user `pero`, internal PostgreSQL port 5432. Run ID **`faf674f0-7e25-48a5-b590-07d6eb630207`**. Это проверка actual SQL после интеграции №180–183 и **до** последующего merge №184.

- [Root JSONL receipt](D:/Projects/pero_crm_worktrees/kp-185/.playwright-mcp/kp-185/native185-root-8bf7c76d-b367-48ca-b099-934173872cff.jsonl), SHA256 **`50f2e4290196a2fd895483b551a0381f5437ad88e1fdf142737e687434c30530`**.
- [Frozen source plan](D:/Projects/pero_crm_worktrees/kp-185/.playwright-mcp/kp-185/source-plan-0b9289833b0a8a3415c51506c3e786087bb0fa7cc3858879ecc8c0b404b80572.json), sourcePlan SHA **`0b9289833b0a8a3415c51506c3e786087bb0fa7cc3858879ecc8c0b404b80572`**, manifest SHA256 **`bb96dd2b978eda5df4e6a21f296d2ec72974ecc3fd1a82afe976191010e3152f`**. Проверенный HEAD в плане — `0b788bf9bc9f2ff43768b0a6e788a60c1c446d66`; защищены 392 runtime/tooling файла и 83 миграции.
- Контейнер: `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`. Все 76 таблиц после обязательного rollback имеют исходный digest **`afd3a5a3feb4e6029c8ca298804d713f6b778b05da403194380adee268ee9bec`**; полный catalog — **`805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`**. Все 83 успешных migration receipt и четыре точных прежних checksum exceptions сохранены. Все 11 KP-таблиц пусты после rollback.

Receipt подтверждает SQL lease/чужого owner, точный UUID replay, реальный SQL failure с полным откатом публикации, READY immutable release, stage receipt replay, принятие и retention epoch, fence cleanup-kind, reuse принятого PDF, восстановление через настоящий полный №181 save и отказ отозванному пользователю. Actual №182 Decimal pricing проверен на quantity2, ценах 100.75/90.68 и поправке −0.01; actual №183 media sync проверен только для пустого состава изображений.

Все QA-записи выполнялись в одной mandatory rollback-транзакции. В receipt: `exactRollbackVerified:true`, `allFixturesRolledBack:true`, `permanentWrites:false`, `externalIo:"blocked"`, `notifications:false`. PDF bytes/template identities были явно объявленными SQL fixtures: **`rendererAndS3Accepted:false`**, **`physicalDocumentAcceptance:false`**, **`templateAcceptance:false`**, `actualRenderer:false`, `actualS3:false`. Это не принимает рендер, байты настоящих документов, S3, изображения, browser/API/MCP или staging. Субагент лишь прочитал безопасную root-квитанцию и записал evidence; самостоятельных DB/Docker/S3/SSH/network действий не выполнял.

## Первоначальные локальные проверки до native

- `pnpm --filter @pero/web exec tsc --noEmit --incremental false --pretty false` — PASS на базовом Prisma-клиенте этой ветки. Его генерация выполнялась только в собственном node_modules kp-185; другие worktrees и схемы не копировались.
- ESLint затронутых серверных модулей, stage-core и тестов — PASS.
- `pnpm --filter @pero/web exec tsx --test tests/kp-version-lifecycle.test.ts tests/kp-render-worker.test.ts tests/project-stage-core.test.ts` — 21/21 PASS: 14 новых DI-сценариев и 7 существующих проверок переходов.
- `openspec validate kp-version-lifecycle --strict` — PASS; `git diff --check` — PASS.

DI проверяет фиксацию источника и строковых денежных значений; UUID replay и отказ при другом авторе/содержимом; отзыв роли/ключа; гонку ревизии; PENDING ledger/orphan intent до upload; отказ при неверном readback и полном откате финала; потерю lease; привязку artifact к попытке; gate без обхода флагом; accepted/epoch/cancel; восстановление исторического client/FX/state и ошибку 410; frozen PDF после истечения срока картинок; выключенный worker, поддержанные виды, heartbeat и timeout.

## Интеграционные интерфейсы

- `lifecycle-store.ts` экспортирует InTransaction wrappers freeze/request/pending/publish/complete/restore и чтения. `publishSourcePdfInTransaction` не завершает job: №186 объединяет все PDF, DOCX, версии договоров, переходы и завершение одной внешней транзакцией.
- `LifecycleSecurity.authorizeSource(tx,binding)` обязателен для операций авторизации. SQL store отдельно проверяет свежего активного User/roles/sessionVersion; API использует сохранённый tokenId без Bearer. №187 восстанавливает проверку actual ApiToken/scopes при каждом вызове, включая worker после рестарта.
- `LifecyclePorts.mediaIds` использует parser №183; pricingSnapshot — расчёт №182; templateIdentity — getter №184. `PdfWorkerIO` передаёт реальные assets/renderer/upload/readback, а handler повторно сверяет SHA/size изображений и templateHash. Отсутствие production composition не заменяется фальшивым renderer/storage.
- `RestoreSave` — callback в той же транзакции к №181 с обязательными pricing/media hooks и явным историческим FX без повторного НБРБ-запроса.
- Global mutex: `pg_advisory_xact_lock(18435,55001)` перед Project/CommercialProposal. Stage gate не использует PERO_KP_ENABLED. Worker запускается только явным вызовом, при обоих `PERO_KP_ENABLED=1` и `PERO_KP_WORKER_ENABLED=1`.
- №188 получает PRUNE payload `{schema:1,kind:ACCEPTED_RETENTION,proposalId,acceptedVersionId,retentionEpoch}`. Возврат в LEAD увеличивает epoch и отменяет только PRUNE, включая активный lease; physical executor повторно проверяет epoch/lease перед удалением.
- PDF reservation создаёт точный ORPHAN_ARTIFACT intent с доступностью через 24 часа. №186 вызывает общий `registerPendingArtifactCleanupInTransaction` для PENDING DOCX до upload. Объекты READY/ссылки опубликованных документов исполнитель сохраняет.

## Ограничения приёмки

Локальная SQL-приёмка выполнена root и описана выше. Runtime/renderer/S3/визуальная и staging-приёмка не заявляются. №180–183 интегрированы обычным разрешённым merge; публичные маршруты и runtime composition принадлежат №187. Наличие renderer dependency №184 само по себе не является повторной native или physical-приёмкой.

`tests/helpers/kp-version-native.ts` запущен root внутри guarded rollback-транзакции существующего local5433, на собственных User.name и CommercialProposal.sourceId `__qa185_<runId>`, с actual №181 save adapter. Stand-in PDF в этом helper не доказывает renderer/S3. Task 3.3 остаётся открытой: реальная save-vs-stage concurrency, runtime, physical documents и staging SHA/образ проверяются отдельно.

## Независимое review и исправления root

Два P1 исправлены: Prisma `$queryRaw` теперь читает `SELECT 1 AS locked FROM pg_advisory_xact_lock`, без неподдерживаемого void; клиент версии фиксируется из сохранённого `state.client.crmSnapshot`, а не из свежей карточки CRM. Restore передаёт historical state/clientId/FX без приоритетного explicit clientSnapshot: №181 сам восстанавливает реквизиты из state, а служебный «Временный» не получает запрещённую попытку изменения. Добавлены сценарии независимой правки CRM и восстановления временного клиента. На этом первоначальном срезе targeted запуск — 23/23; full base TypeScript, ESLint, OpenSpec strict и diff check прошли. Последующая actual SQL-приёмка root приведена выше.

## Разрешённая локальная интеграция №180–183 — 18.10.2026

По явному поручению root выполнен обычный fast-forward merge точного `feature/183` SHA **`0b788bf9bc9f2ff43768b0a6e788a60c1c446d66`** в `feature/185`. Предыдущий HEAD — `aff6c105bbf17c39036ff2b3d123eb5fdbba6233`, подтверждённый ancestor. Новый HEAD — тот же `0b788bf9bc9f2ff43768b0a6e788a60c1c446d66`. Новый commit не создавался, история сохранена; конфликтов и изменений чужой семантики не было. Feature-файлы не копировались, cherry-pick/squash/reset не применялись.

Перед merge все 17 dirty/untracked файлов №185 сохранены в exact retained stash **`0c3a25d078fa75a3170e9bc987cef0f3ea29a719`** с сообщением `kp-185-preserve-before-183-a5dcac6e-bc7d-4707-8072-7771854d4ee8`. После merge выполнен `git stash apply --index` по этому SHA. Все 17 исходных файлов восстановлены побайтно: SHA256 до/после одинаковы. Stash не удалён и не pop-нут. Единственный tracked diff — прежний stage-core hook №185; остальные собственные source/tests/OpenSpec остаются untracked. После восстановления добавлен только документ native ports и этот integration evidence.

Проверки после merge:

- Prisma validate/generate объединённой схемы №180–183 — **PASS**, Prisma Client 6.19.3. Использовался заведомо нерабочий schema-only DSN `127.0.0.1:1/schema_only`; env процесса восстановлен, env-файлы не менялись. Generated client находится внутри собственного `kp-185/node_modules`, другие worktrees не затронуты.
- Полный `pnpm --filter @pero/web exec tsc --noEmit --incremental false --pretty false` на настоящей объединённой схеме — **PASS**.
- `tsx --test tests/kp-version-lifecycle.test.ts tests/kp-render-worker.test.ts tests/project-stage-core.test.ts` — **23/23 PASS**.
- ESLint 11 собственных lifecycle/stage/test файлов — **PASS**. OpenSpec strict, tracked diff и whitespace собственных файлов — **PASS**.

Изменять lifecycle source после merge для совместимости не потребовалось. Фактические mandatory порты, wrappers №186 и требования к callback полного save перечислены в `native-ports.md`; SQL native caller обязан использовать настоящие №181/182/183 adapters в своей guarded rollback-транзакции.

На срезе этого dependency merge actual native ещё не выполнялся; последующая root-квитанция приведена выше. **Остаются NOT RUN:** renderer/S3/визуальная проверка, реальная save-vs-stage concurrency и staging SHA/образ. Runtime composition №187 и дальнейшие обычные merges принимаются отдельно; task 3.3 остаётся открытым. Type/DI PASS не является native или staging-приёмкой.

## Подготовленная проверка save-vs-stage

В `apps/web/tests/integration/domain-postgres.test.ts` подготовлены два реальных multi-transaction сценария `kp185/proposal-save-vs-lead-exit-save-first-real-advisory-waiter` и `kp185/proposal-save-vs-lead-exit-stage-first-real-advisory-waiter`. В них используются настоящие №181 create/save и stage-core №185, metadata-only release через wrappers №185, два PID, `pg_blocking_pids`, точный advisory tuple, отдельные SQL fences и trace настоящего Project `FOR UPDATE`. Проверяются stale release rejection, принятие текущей версии, запрет save вне LEAD, состав/soft delete/история и точные replay snapshots.

Независимый review нашёл неверный discriminator в predicate отказа save: исправлено `error.code` → **`error.kind === "locked"`**, соответствующее `ProposalWriteError`. Это исправление только теста; production source не менялся. Сценарии **не запускались на БД** в этом срезе и не покрываются локальным native helper выше. Их TypeScript/ESLint проверяются отдельно; успешная статическая проверка не доказывает overlap/rollback PostgreSQL.

Перед разрешённым commit №185 повторены focused lifecycle/worker/stage tests — **23/23 PASS**, полный web TypeScript, ESLint 12 файлов (включая concurrency integration test) и OpenSpec strict — **PASS**. SHA256 исправленного `domain-postgres.test.ts` на этом срезе: `f58e7e0f3e9bcb63ef7d2bc53d68ffedd43b961c371ded93e0a8e415e83d397e`. Это проверки до последующего dependency merge №184; нового native/post-merge результата они не заявляют.
