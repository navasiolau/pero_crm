# Verification

Дата: 18.10.2026. Ветка `feature/185`, исходная база `d918ab860ec5aab029c466a3b3c3b1ce06f0ec98`. Исторические срезы подготовки и root SQL-приёмки сохранены ниже. Текущий разрешённый local merge — `c9291d9dc04a34324fb62b3faaed60898b1cbc29`; новый результат staging-приёмки №185 не заявляется.

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

## Обновление от принятого upstream staging — local PASS

На чистой `feature/185` выполнен обычный `git merge --no-edit origin/staging` без конфликтов. Merge **`c9291d9dc04a34324fb62b3faaed60898b1cbc29`**, parents **`44cbee18d7248bf22c92e80151fdd123019ea110`** и **`0f8d38d6d0bba091786fb8b483a064d0f4fa9a97`**. Локальный remote ref точно совпал с переданным root staging SHA; сеть/fetch/push не использовались. Root сообщил для исходного upstream CI294 all7 success и здоровый runtime с выключенным КП; это не приёмка нового №185.

В последующей отдельной read-only проверке root остановился на `template_metadata` upstream web. Причина диагностируется владельцем №184; CI/приёмка №185 ожидают triage и возможного обычного merge исправления. Этот субагент не выполнял target actions, данные и конфигурация не менялись.

- Focused `kp-version-lifecycle`, `kp-render-worker`, `project-stage-core` — **23/23 PASS**. Полный `tsc --noEmit --incremental false --pretty false` после merge и после подготовки зависимостей — **PASS**.
- Семь собственных lifecycle/queue/worker/stage/helper файлов остались без изменений. Обе реальные save-first/stage-first гонки и `error.kind === "locked"` сохранены. В warehouse QA перед конкурентной парой сохранён `pids.clear()`; текущий working SHA256 `domain-postgres.test.ts` — `5e9456c5af0d7ef90e186657eca6aa49f0a2bb581fca848ca147533fb2caac6c`.
- Узкий procfs/SIG guard №184 и его fixtures совпадают с upstream. Дополнительные проверки только с моками: CI renderer **8/8**, runtime target/procfs **5/5 PASS**. Реальные Docker/HTTP/process signals не вызывались.
- Первоначальный renderer CI test не стартовал из-за отсутствующей workspace-ссылки `@pero/kp-template`. Выполнен только `pnpm --filter @pero/kp-renderer... install --offline --frozen-lockfile --ignore-scripts`: 2 workspace, 62 cached packages, 0 downloads, lockfile неизменён. После этого mock tests прошли; версии и source не менялись.

Предыдущий настоящий root-native PASS относится к исходному plan `0b928983…` и receipt SHA256 `50f2e4290196a2fd895483b551a0381f5437ad88e1fdf142737e687434c30530` выше; receipt сохранён без изменений. В этом обновлении native SQL и обе DB-гонки повторно **не запускались**. Новая actual runtime/renderer/S3/browser/staging-приёмка №185 остаётся pending; task3.3 не закрыт. После merge меняются source/HEAD guards прежнего private runner: старый plan не переисполняется без отдельного review. Reset/cherry-pick/squash, DB/Docker/S3/SSH/HTTP/production/push не выполнялись.

## CI297: селектор блокировки старого draft/stage сценария

По переданному root результату CI297 native domain suite на настоящем PostgreSQL 17 выполнил **76/77 PASS**: обе новые save-vs-stage гонки №185 прошли, а прежний `draft/create-contract-number-races-real-project-lock` остановился в порядке contract-first на `DISTINCT_BACKENDS_HELD_LOCK_AND_ACTUAL_WAITER`. Это не успешная приёмка всего suite или staging.

Причина подтверждена исходниками: общий test proxy `commandTx` вызывал `onHeld` на первой подходящей блокировке. Stage-core №185 берёт advisory mutex перед строкой Project, а создание изделия использует только строку Project. Поэтому contract-first останавливался до получения общей для этих операций строки, и создание изделия не становилось ожидающей транзакцией.

Исправление только теста: необязательный `lockProjectId` выбирает Project `FOR UPDATE` с точным ID из SQL-параметра; его задают только два overlap-вызова create-first/contract-first этого сценария. Без него прежний detector остаётся прежним. Production-блокировки, таймауты, `pg_blocking_pids`, требование разных PID, advisory tuple новых №185 гонок и проверки статусов/денег/начислений не изменены.

- Полный `pnpm --filter @pero/web exec tsc --noEmit --incremental false --pretty false` — **PASS**.
- `pnpm --filter @pero/web exec eslint tests/integration/domain-postgres.test.ts` — **PASS**.
- `openspec validate kp-version-lifecycle --strict` и `git diff --check` — **PASS**.
- SHA256 исправленного `domain-postgres.test.ts`: **`a2d06e820fcbbf72d3d4bf15177c6e8d65f16995aa24bd389e5cbd21ec38cb0f`**.

После исправления native domain suite **не запускался**: существующий local5433 не использовался как scratch. Root отдельно выполнит review, commit и следующий CI. DB/Docker/SSH/S3/HTTP, commit и push этим субагентом не выполнялись; task3.3 остаётся открытым.

## Actual staging UI/runtime — 20.10.2026

Root принял покомпонентные API/browser результаты на staging `acbd164cb6e79194b7fe87a0469d60d745dead1a`, web image `sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`, renderer image `sha256:ec35d0956e41d55f7d21cac46c5ea07430bde99d920a9538791899cc75dac5a8`; CI306/run39290284146. Прежние CORE4, Lead23 Save/private PDF и API operations72/72 остаются отдельными принятыми evidence; повторный прогон ими не заявляется.

UI34: Locked8/8 PASSED на390/1366 px — private images/layout, свежие client defaults и история договора, pricing/quantity двух КП; две фактические contract operations имеют native VERIFIED. Root readback22/25 и inspect26 ACK. Mixed-role revocation APPLIED; старые bearer/session получили401/401. Manager deactivation не отправлялся: local405 reserve отказал до dispatch. Bell сохраняет FAILED_UNRELATED_BELL/UNKNOWN/accepted=false; приёмка Bell не заявляется.

Classification: `kp-188/.playwright-mcp/kp-188/ui34-locked-mixed-closure-classification-b3752198-55f8-4058-ac4f-12cc62bce04d.json`, SHA `33147ab14ee7c19b0344f799002224c42f1bee32b61b5f42581e37cd599b5ac0`. Проверены14 full76 и14 narrow snapshots: каталоги/history84/83 и OrgSetting exact; разрешённые own contract/audit/credential изменения отделены от foreign preservation, весь RAW сохранён. Единственная legacy telemetry projection — ApiToken.lastUsedAt по прежнему40bf/5289/ff7ac profile. Original finish подтвердил foreign RAW/BUSINESS exact,11inactive/22revoked; daemon ORIGINAL_FINISH_OBSERVED/alive=false, flags000/rendererSTOPPED. Пять собственных PURGE_MEDIA/PENDING сохранены; global pending0 и physical cleanup не заявляются.

Manager принят только как composition5+1: прежние пять browser behaviors и отдельный actual download шестого, с закрытием UI34. Proof `kp-187/.playwright-mcp/kp-187/manager-draft-browser-download-only-4e244c2d-final-composition-dc70be54-8c60-4b80-86c2-b983841bc80c.json`, SHA `46d068629c5cbfd34c61ece90228d2f032c156c65fa929d1a2f6e905fac87f81`. Исходный full-program FAILED и все прежние HOLD сохранены; они не переименованы в PASS.

DB/runtime/staging часть3.3 подтверждена: CORE4 версии/реальный PDF/restore, принятые stage/API receipts, desktop/mobile Lead и Locked UI. Полный3.3 остаётся открытым до actual №188: возврат сохранённого принятого PDF после физического удаления изображений и restore410 без изменения CRM ещё требуют собственного physical evidence. Подготовленный singleLEAD100/source review не является таким прогоном. Main/production и общий cutover не приняты.

## Actual retained PDF и restore410 после cleanup — PASS, 21.10.2026

Остаток пункта 3.3 фактически принят на staging `ab5b243f1e3cddd5c915ebdb70b6bff7be3a815e`, CI308/run39462920003: web `sha256:8ef7b45095850afc19f8283f110d732a7cc968323f8cc69fbcdc96003eb74822`, renderer `sha256:4a8b8c63ee6ad2d98e75459be6dbfe6dc601da9551285212707fd83c14c76d44`. Исторические открытые статусы выше относятся к прежним срезам.

- Physical10 принят отдельным index `closed55-physical-ten-factual-classification-8395810a-20261021.private.json`, SHA `51573967f5063bdd4a1b600bb919759ef089eba20b4aa1d503df953230633d12`; исходный журнал CLOSED55 восстановлен отдельным supplement `d04eee569ddef5c9ba69416bd5c1167bd5550a55392a76030c3855c9f1c962c9`. В этом остаточном вызове physical/Core и уже принятый SDK №186 `01aaf5a4021e9f9a1c56258dc78efb8dc634d5ea11590b94dc78976f6a3c8589` не повторялись.
- Настоящий Manager POST stage вернул `saved/LEAD`, operation `771b4ab3-a185-4faa-9c7a-e95e9d3bd259`, revision11/epoch2; завершённый PRUNE остался неизменным. GET version вернул200 и читаемое состояние. Поле `restorable` отсутствует в реальном ответе и не синтезировалось.
- Единственный restore POST operation `38d57c78-d192-4ab7-bafc-a0e0aa9ad071` вернул **410 `KP_MEDIA_UNAVAILABLE`**; повторной отправки не было. Текущий документ и его GET body SHA до/после отказа одинаковы; внутренние RAW/BUSINESS/catalog/key guards отказа также exact.
- Сохранённый принятый PDF скачан настоящим HTTP200: **314719 bytes**, SHA `544242540d6db1b3a93dbb192909fdd94d1902bbf44177887f76926fb16e1360`. Собственный журнал уведомлений этого вызова восстановлен штатно, `restored:true/repeated:false`.

Основной [actual result](D:/Projects/pero_crm_worktrees/kp-180/.playwright-mcp/kp-integration/physical55-23b0e4e4-8c8e-47bf-8783-f6e97a2bf14a/postannual-restore410-remaining-once/008-final.private.json), SHA `a426ab766ff6cf54cf0afa8cab684b4d96999a6ae854fe67d6f91f2dec1df8ef`, содержит `PASSED_POSTANNUAL_RESTORE410`, восемь actual HTTP exchanges, private capture/execute и full76+narrow BEFORE/AFTER refs. Execute RAW SHA `a4ea1b232f37324924d83eff0a5177bb0cf4e8e88a9891b7bc11691025cd7880` сохранён без изменений.

Новые акторы `f694072b-ebdc-4191-8e3d-d4c39a1d4f7c` закрыты до исходного expiry09:11:25.338Z: OFF flags000/rendererSTOP, original FINISH `208395fecd977f7df87b1aea3938f8b969e4ffc3a30cc7af6402262a00cf0370`, keeper `6a3a33284ab2fd25dd41e7a80b81509b5e74d831b06658cd9c8cb64b9f2fad8e` подтвердил11 inactive/22 revoked/`ORIGINAL_FINISH_OBSERVED`/`alive:false`. [Completion](D:/Projects/pero_crm_worktrees/kp-180/.playwright-mcp/kp-integration/closed55-restore185-only-actor4-envelope-20261021/run-45a909b5-257e-452a-ae8b-254087b6d99f/completion-faab1c20-25e1-45ee-9e9a-cdfd6f1d2d1a.private.json), SHA `b2725bb163fcc4c24adf4527a8e03794fdad103dcd6c105805136437f09e832f`; закрытый actor context SHA `1991e8c51032775c7ec52c32eb5ca9609467c6a23503cf0511a5ab57d951dfe8`. Старые CLOSED/HOLD и SDK-акторы сохранены, ключи не реактивировались. После этого функциональные проверки остановлены; новые тесты, main и production этой записью не заявляются.

Итоговый независимый index: `D:/Projects/pero_crm_worktrees/kp-187/.playwright-mcp/kp-187/closed55-final-existing-cases-acceptance-20261021.private.json`, SHA `05257a9bf7a00ee0bc9302d3ea4bb4acd06d28850d464d84ee90d48aae2b8e11`. Для restore410 полные76RAW/BUSINESS/catalog и22keydigests exact. SETUP foreign76RAW/BUSINESS exact; FINISH foreign BUSINESS76/catalog exact, RAW содержит только сохранённое согласованное8bb4/e454lastUsedAt. Это не новая нормализация и не повтор теста.
