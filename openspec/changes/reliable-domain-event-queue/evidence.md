# Evidence

Дата: 11.10.2026. Задача 135, change `reliable-domain-event-queue`, branch `bugfix/135`, baseline `5a7f01ab4445f4d0cd57d76e221bb2424eaff1b2`, worktree `D:/Projects/pero_crm_worktrees/improvements-129`.

AGENTS.md и `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md` перечитаны перед protocol v2. СТОП при guard mismatch; restic/infra/main/prod запрещены. Root и независимый reviewer выдали DESIGN_GO/RELEASE_IMPLEMENTATION135; отдельный root GO расширил scope только на shared `tests/helpers/event-queue-fixture.ts`.

## Source/local checks

- RED настоящего прежнего dispatcher: 3 cases, 2 FAIL / 1 PASS; healthy за 2 цикла 0 вместо 1, parallel hook 2 вместо 1, completed preservation PASS.
- GREEN `pnpm --filter @pero/web exec tsx --test tests/event-queue.test.ts tests/event-worker.test.ts tests/event-queue-http.test.ts tests/product-sketch-cleanup.test.ts`: **23/23 PASS**, включая lease loss после original erase: thumb и ACK не выполняются.
- Scoped ESLint source/test paths: PASS, 0 errors / 0 warnings. Повторный `pnpm --filter @pero/web exec eslint tests/event-queue-store-native.ts` после v2/actual wait witness: exit 0, 0 errors / 0 warnings.
- `pnpm db:generate`: PASS, Prisma 6.19.3; только типы, без DB connection/migration.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: **Final v2 PASS**, session 88625 exit 0, output пустой; core/store/worker/HTTP/cleanup/native v2 проверены в отдельном согласованном typing-окне, процесс завершён.
- Source schema/additive migration authored, **НЕ ПРИМЕНЕНЫ**. Actual worker/DB/native/staging этой задачей не запускались.

Fake memoryStore/clock доказывает управляемые core/wrapper/timer сценарии. Он не доказывает PostgreSQL concurrency/SQL/fencing. Native ниже mandatory, **NOT_RUN** до отдельного reviewer/root GO.

## Concrete local native/migration protocol v2

Native entry: `apps/web/tests/event-queue-store-native.ts`; import не выполняет действий. Запуск после отдельного root approval/exclusive window: `--authorized-local --mode prepare|verify|inspect|cleanup`, exact UUID `--run-id`, full64 approved Docker `--container-id` и `--source-hash`.

Current source closure SHA: `544c5091e86ac8ace7cbef0c11171e54f2cc650887769a17ebf3324c16de3739`. Старый00ef относится только остановленной попытке ниже.
Current native entry SHA: `3df12482595c6e9ea1c462c0efd972c7a0aa5a1edefdf4446e4889f32b1c48a9`.
DDL SHA: `ab60ba2ac3e03aece98856a1fdd4a3ddb65bd2114ecf2fca835e2e3e5e037306`.
Migration: `apps/web/prisma/migrations/20261011120000_domain_event_queue/migration.sql`.

Source closure включает schema/migration/store/contract/core/internal intent contract/lockfile/native entry. Source hash считается по JSON ordered map этих file SHA и проверяется до подключения к БД; любое изменение требует нового review/pin.

Target guard: только readonly Docker inspect `.Id/.State.Running/Paused/Restarting/.NetworkSettings.Ports` `pero_crm_pg`; exact approved container ID и binding `127.0.0.1:5433`. DATABASE_URL только в памяти: host localhost/127, port 5433, db `pero_crm`, schema public, options override запрещён. Каждое соединение проверяет current_database/current_schema/primary. Docker lifecycle и infra действия отсутствуют.

1. **Durable PRE до первого SQL write.** `prepare` проверяет отсутствие пяти новых columns и collision 0 для всех 54 IDs. PRE содержит exact три legacy blueprint (id/type/payload/actor/createdAt/processedAt/attempts/lastError), все 51 future order ID, root container identity, source pins, protected legacy hash/count и internal mutation UUID. До INSERT публикуется immutable `<run>.pre.json`: exclusive `wx`, mode 0600, file fsync, close и byte-hash readback. Protected реальные данные остаются только в памяти; в artifact сохраняются hash/count, не их строки или dump. Если запись PRE неуспешна, SQL writes не начинаются.
2. Одна transaction вставляет ТРИ legacy fixture: completed с attempts 5 и фиксированным processedAt; pending с attempts 999; internal valid sketch intent с attempts 5. Actor `qa135:<runUUID>`, исходные entity/storage IDs intent инертны и относятся только к QA. Затем отдельный readonly RepeatableRead observation и immutable `<run>.prepared.json`. Lost INSERT ACK / observation publish failure сохраняет PRE, приводит к HOLD; автоматического retry/cleanup нет.
3. ALTER + CREATE INDEX связаны BEGIN/COMMIT по review, чтобы index failure не оставлял partial DDL. Root применяет отдельно reviewed exact additive migration на существующем guarded local 5433. Native runner DDL не выполняет. Новый стенд/БД, reset/seed/dump отсутствуют. Before/after legacy protected facts сравниваются; completed state и исторические attempts сохраняются, новый queueAttempts начинает с 0.
4. **Реальная одновременность.** Два interactive transaction получают свои `pg_backend_pid()`; первая claims pending и удерживает uncommitted row lock/JS gate. Вторая с отличным PID выполняет scoped SKIP LOCKED claim во время `firstHeld=true` и получает null. Gate всегда освобождается, оба promises/ошибки обработаны. Receipt фиксирует два PID и held overlap witness. Затем expire/reclaim даёт новый token, старые complete/renew/fail false, новый ACK true.
5. **Expiry во время доказанного row wait.** Scoped internal получает lease 2 секунды. Первая pinned transaction берёт FOR UPDATE, вторая pinned transaction с отличным PID начинает complete. Locker через readonly `pg_locks` наблюдает `NOT granted` для второго PID **до leaseUntil**, фиксирует DB-clock observed/leaseUntil и PID witness; затем lock удерживается до expiry + 150 ms. После release ACK обязан вернуть false, processedAt остаётся null. Witness неуспешен/получен после expiry — HOLD, а не PASS. Такой сценарий проверяет observed DB clock после locked subquery / MATERIALIZED CTE; callbacks не маскируются одними двумя PrismaClient instances.
6. Last-crash: owned queueAttempts=12 + expired lease паркуется exhausted без delivery. Trusted internalRetry создаёт новый budget 1, исторические attempts растут; active lease не крадётся, completed не открывается. Старый completed blueprint также не claimается; scope [] не становится глобальным.
7. Все 51 future order ID уже объявлены в PRE. После миграции создаются ровно `qa135:<run>:order-0..50`; isolated native core + actual PostgreSQL store бросает controlled failure для первых 50 и успешно доставляет 51-е за два цикла 50→1. Ни plugin, ни physical executor/S3/FS не вызываются. Terminal наблюдение требует exact 54 owned rows, activeClaims 0 и неизменный protected hash/count. Отдельный immutable verify receipt содержит cases/PID/wait witness/terminal hashes.
8. **Inspect/reconciliation.** При UNKNOWN или guard mismatch — STOP/HOLD и доклад root. `inspect` только читает authoritative current rows в RepeatableRead, сверяет PRE immutable facts и protected hashes, публикует новый immutable `<run>.observe-<UUID>.json`. После UNKNOWN inspect является данными для отдельного root/reviewer reconciliation, а не автоматическим разрешением cleanup/retry.
9. **Cleanup как транзакция с current observation.** Нужен reviewed current `--observation-file` из fixed private results root с тем же run/pre/source, activeClaims 0. До DELETE durable immutable cleanup-intent (`wx`/fsync/readback). В одной RepeatableRead transaction: FOR UPDATE всех exact 54 possible IDs, immutable ownership/actor check, post-lock DB clock, rejection future lease, полный mutable owned-state hash и exact observed ID order, rejection undeclared same-actor IDs, protected baseline hash/count. Только после всех checks DELETE exact observed IDs AND actor; count и protected hash проверяются ещё внутри transaction. После commit — current observation 0 owned + protected original и immutable cleanup-ack. Lost ACK / state drift / active lease — HOLD, PRE и intent остаются, blind cleanup отсутствует.

Artifacts только ignored `apps/web/test-results/event-queue-native/<run>.<part>.json`, private part-name / absolute path / reparse guards. Полный owned state сравнивается по хешу; реальные строки не сохраняются. Секреты/URL/token не выводятся. Script ошибки имеют sanitized F135/P-code/phase/sourceHash, не raw Prisma stack.

## Independent review follow-up

Reviewer обнаружил три protocol blockers прежнего draft: PRE после INSERT; cleanup без owned row locks / mutable state / active lease guard; два PrismaClient без PID/overlap proof. Reviewer подтвердил, что v2 source закрывает все три blockers, и не нашёл новых production findings. Выдан conditional NATIVE_PROTOCOL_GO: final v2 tsc PASS, root exclusive outbox-inactive window и fresh source pins обязательны. Review также предложил atomic DDL BEGIN/COMMIT; принято до применения. Эти исправления не исполнялись на БД.

## Required staging

**STAGING NOT_RUN.** Root normal merge/CI/current image/migration/health и DB/storage/side-effect isolation proof до opt-in. Worker default false. Actual register tick/singleton/diagnostics, реальные 50 invalid-internal + healthy owned manifest без physical erase, lease/reclaim/stale ACK/exhaustion/internal retry и original-data preservation нужны в reviewed window. Unit/native controlled delivery не подменяют настоящий stage worker.

129 actual app fixture/browser protocol отдельно в ignored `test-results/safe-file-response/actual-staging-protocol.md`, через common 163 source pins clean accepted integration. WIP 135 не используется для 129 stage proof. Producer/execution ещё не разрешены; borrowed 113 author129 не удаляет.

## Remaining

- LOCAL_NATIVE / MIGRATION: NOT_RUN; conditional reviewer protocol GO получен; final typing / fresh pins / root exclusive window pending.
- FINAL V2 TYPING: PASS, session 88625 exit 0; slot освобождён.
- CODE_REVIEW: final 135 pending; early SQL/runtime review идёт.
- STAGING: NOT_RUN.
- COMMIT/PUSH/MERGE: NOT_RUN автором135; все NEW commits HOLD до прямого разрешения владельца после root auto-review rejection. Main/prod prohibited.
## Superseded operator packet: first STOP attempt, не повторять

Source worktree: `D:/Projects/pero_crm_worktrees/improvements-129`; fresh full source pins выше. Suggested run UUID `bb6de6fc-c566-4efd-a8f2-10c51861eb38`; protected namespace actor `qa135:bb6de6fc-c566-4efd-a8f2-10c51861eb38`. Exact IDs: `<actor>:completed`, `<actor>:pending`, `sketch-cleanup:<PRE mutation UUID>` и `<actor>:order-0..50`. Все 54 описаны durable PRE до first INSERT. Default sandbox readonly Docker inspect отказал в запуске docker.exe; guard не исполнялся, DB connections/writes 0. Root самостоятельно даёт fresh full64 container ID/target proof в разрешённом launcher.

Before GO root подтверждает existing PG identity/loopback5433, отсутствие Next/queue/других outbox consumers и связанных clients; `_prisma_migrations` ровно74 finished/no unresolved, исходные migration names/checksums согласованы, пять новых queue columns/queue index/check отсутствуют. Source содержит75 migration directories, включая только reviewed135 additive migration. Expected after: ровно75 finished, new name `20261011120000_domain_event_queue` и checksum `ab60ba2ac3e03aece98856a1fdd4a3ddb65bd2114ecf2fca835e2e3e5e037306`; five columns + exact index/check, legacy facts unchanged. Миграцию обратно не откатывать: approved additive schema остаётся в local.

Root сообщил readonly preflight: approved full64 container `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, pero_crm / pero, 74 finished / 0 unresolved, last20261010200000_product_status_optional_assignees, new5columns0. Fresh exclusive/outbox-inactive execution GO всё ещё нужен; secrets отсутствуют в argv/output. Команды из source worktree; root private guarded launcher передаёт только разрешённый local DATABASE_URL в process memory.

```powershell
$qa135CommonArgs = @('--authorized-local','--run-id','bb6de6fc-c566-4efd-a8f2-10c51861eb38','--container-id','bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5','--source-hash','00ef886f9a179e9466af92013058bd79d551118eedf95240b36f1f474122ba82')
pnpm --filter @pero/web exec tsx tests/event-queue-store-native.ts @qa135CommonArgs --mode prepare
```

Author prepare только после root GO; root принимает PRE/prepared ACK и fresh guards перед своим единственным DDL шагом `pnpm db:deploy` (74→75, reviewed SQL BEGIN/COMMIT). Native runner DDL не делает. UNKNOWN DDL/INSERT ACK — HOLD, no replay/cleanup до reviewed inspect/reconciliation.

```powershell
pnpm --filter @pero/web exec tsx tests/event-queue-store-native.ts @qa135CommonArgs --mode verify
pnpm --filter @pero/web exec tsx tests/event-queue-store-native.ts @qa135CommonArgs --mode inspect
```

Verify ожидает distinct backend PIDs/held overlap, pg_locks-before-expiry witness, stale ACK-renew-fail false/current ACK true, exhausted-last-crash/manual internal retry, 50→1 native cycles, terminal owned54/active0/protected unchanged. Private durable PRE `apps/web/test-results/event-queue-native/bb6de6fc-c566-4efd-a8f2-10c51861eb38.pre.json`, ACK `.prepared.json`, `.verify.json`; readonly inspect публикует `.observe-<UUID>.json`. Root просматривает current observation/intent policy перед exact cleanup:

```powershell
pnpm --filter @pero/web exec tsx tests/event-queue-store-native.ts @qa135CommonArgs --mode cleanup --observation-file 'ROOT_CURRENT_REVIEWED_OBSERVE_PART.json'
```

Cleanup ожидает exact own54→0, original protected count/hash unchanged, durable `.cleanup-intent-<UUID>.json` / `.cleanup-ack.json`, disconnected clients. Никакого storage/plugin/external вызова. Любой конфликт/UNKNOWN — state/receipts сохраняются и root решает recovery отдельно.
## Reconciliation and compatibility follow-up

1. Historical74 checksum audit: root/reviewer нашли exact applied bytes для прежних migrations, расхождение только mixed CRLF/LF; normalized bytes равны Git. Ledger/old SQL не менялись. Root actual readonly catalog02:57:23Z подтвердил8 legacy columns/PK/processedAt-createdAt index, new5 absent,74finished/0unresolved. Это prerequisite, не migration PASS.
2. Первая разрешённая PREPARE_ONLY попытка run `bb6de6fc-c566-4efd-a8f2-10c51861eb38`, frozen00ef/nativeb836, exec `require_escalated`: approval binding PASS, runner exit1 без native receipt/early reason. Немедленный STOP/HOLD, без replay/DDL/cleanup. Root authoritative readonly reconciliation: actorRows0/prefixRows0/newQueueColumns0/newMigrationRows0; exact PRE/prepared/verify/cleanup-ack files отсутствуют. До INSERT путь не дошёл, schema/ledger unchanged. Original baseline fingerprints не были captured, их PASS этой попытке не присваивается.
3. Root scoped parse-only diagnostic: processEnvPresentfalse, root.env lineFoundfalse/urlParsedfalse, DB0. Это подтверждённый недостаток launcher inputs; формат/другие env keys не угадывались. Native early errors теперь охвачены sanitized F135/errno/Pcode/phase/hash, без rawmessage/URL/stack. Pure secret-bearing error capsule PASS. Accepted existing `tests/helpers/local-crm-database.ts` будет использован только reviewed private memory launcher; env/ACL/config не менялись. Новый run/source pins/launcher/window требуют нового reviewer/root GO, старый run не повторяется.
4. Reviewer расширил coupled regression review: прежний upload SQL stub always[] дал actual RED12PASS/7FAIL. Root разрешил ровно additional `tests/upload-route-reliability.test.ts`; reused existing shared memory queue factory/defaults/clock, rollback row sync, stale intent ждёт backoff due. Никакие прежние assertions не ослаблены.
5. Truthful fixture выявила реальную duplicate POST regression[200,503] вместо[200,200]. Root и reviewer CONCRETE_MANUAL_OBSERVER_API_GO: readonly DB-clock observe + bounded same-intent wait. Observer не claim/renew/ACK/fail/remove; processedAt true только после strict immutable identity check. Active historical lastError неterminal; failure/released/missing/exhausted/expiry/changedpendingtoken/abortfalse. Deadline race охватывает даже hung read; background/nested/generic dispatch не ждёт. Intent сверяется и перед executor, и на terminal read.
6. Final targeted command: `pnpm --filter @pero/web exec tsx --test tests/upload-route-reliability.test.ts tests/event-queue.test.ts tests/event-worker.test.ts tests/event-queue-http.test.ts tests/product-sketch-cleanup.test.ts`: **50/50 PASS**, включая original19 upload cases, concurrent200/200, observer historicalerror/ownerfailure/leaseexpiry/reclaim/changedcompleteintent/deadline/abort and no-mutation guards. Scoped ESLint9 changed paths PASS0errors/0warnings; strict OpenSpec и gitdiffcheck PASS.
7. Current source/native hashes выше; DDLab60 unchanged. Native source дополнен readonly SQL observe active/expired/durable-complete probes, НЕ ИСПОЛНЕН. Нужна новая final typing/review после этих исходных изменений. Все new commits продолжают HOLD до прямого разрешения владельца.

Current acceptance: LOCAL_NATIVE / MIGRATION NOT_RUN (first STOP reconciled zero effects); final typing/review/new launcher/new run/root exclusive window pending; actual worker/STAGING NOT_RUN. Main/prod/restic/infra untouched.
## New review-only operator packet

Reviewer FORMAL_SOURCE_CODE_REVIEW_GO / UPDATED_NATIVE_PROTOCOL_GO для current544c/native3df после final `tsc --noEmit --incremental false`, session94207 exit0/no output. Previous88625 относится к предыдущей версии, не к latest observer. Source tests50/50, scopedlint9 paths0errors/0warnings, strictOpenSpec/diffcheck PASS. DDLab60 unchanged. Actual native/SQL clock/stage всё ещё NOT_RUN.

Proposed fresh run: `03825ccd-3a4f-48b4-84bd-663b82237817`. Ignored root-only launcher `apps/web/test-results/event-queue-native/private-memory-launcher.ts`, SHA `3f275d53cbcda7d78e9ea60f150691d24544c3a8f726645fe29bb68bd9610a9f`; unchanged accepted `apps/web/tests/helpers/local-crm-database.ts`, SHA `0b426214023931ca573eccbaafdbe59ca21374f5a64a8519ac06e5b468c8fc47`.

Reviewer PRIVATE_MEMORY_LAUNCHER_PROTOCOL_GO: before helper/DB exact approved phase/run/target/CID/worktree/db/port/source/native/DDL/helper/self hashes; guarded existing local helper constructs URL in memory; process DATABASE_URL/CRM_LOCAL_CONTAINER_ID restored finally. No env/config/ACL copy or mutation; no DDL branch. Native/launcher failure logs sanitized only. Launcher/helper/native functions not executed; coordinated full web static typing, including the ignored private launcher, PASS: session41681 exit0/no output. TSC slot released to root/finance133. Source544c/native3df/DDLab60 and launcher3f275d53 pins unchanged; actual DB/native/staging remain NOT_RUN.

Root creates phase-specific approval only after fresh current target/schema74/no outbox consumers and exclusive window; initial exact file:
`D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/native135-03825ccd-3a4f-48b4-84bd-663b82237817-prepare-approval.json`.

```powershell
pnpm --filter @pero/web exec tsx test-results/event-queue-native/private-memory-launcher.ts --authorized-local --mode prepare --run-id 03825ccd-3a4f-48b4-84bd-663b82237817 --container-id bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5 --source-hash 544c5091e86ac8ace7cbef0c11171e54f2cc650887769a17ebf3324c16de3739 --approval-file D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/native135-03825ccd-3a4f-48b4-84bd-663b82237817-prepare-approval.json
```

Это review packet, **НЕ разрешение выполнения**. Root отдельно разрешает prepare→свой atomicDDL74→75→verify→inspect/current observation→exact cleanup. Каждая phase требует своего approval-file с соответствующей operation; cleanup дополнительно exact reviewed observation part. Prepared/PRE/verify/observe/cleanup artifacts сохраняются для нового full UUID в fixed ignored event-queue-native directory. Старыйbb6 STOP packet/история не переписываются и не переиспользуются.
## Refreshed operator packet: queue-only prerequisites

Root read-only163 warehouse-readiness отказал ACTIVE_WAREHOUSE_REQUIRED до его catalog/body fixtures. Это НЕ dependency135: очередь не инициализирует склад и не требует full163PASS. Source/launcher/native/migration код неизменён. Root fresh existing-target/schema74/catalog/quiescence/outbox-inactive proof и отдельное фазовое разрешение всё равно обязательны; warehouse initialization/freeze/seed запрещены.

Read-only reconciliation: source guard native.ts140 использует sha(JSON.stringify(pins)) в insertion order sourcePaths, а НЕ sorted canonical digest. Exact standalone Node8-source probe дал544c5091e86ac8ace7cbef0c11171e54f2cc650887769a17ebf3324c16de3739. Тот же map с sorted keys даётce6a47a42fbc4305f2baeefb281f84760a5887f053cbb89616537b8985c58527. Initial manual PowerShell mismatch был ошибкой порядка, не изменениемphysicalsource; pins/SQL/ledger не правились.

Frozen packet:
- Run03825ccd-3a4f-48b4-84bd-663b82237817: PRE отсутствует, runner/DB effects этого run0.
- Native3df12482595c6e9ea1c462c0efd972c7a0aa5a1edefdf4446e4889f32b1c48a9.
- DDLab60ba2ac3e03aece98856a1fdd4a3ddb65bd2114ecf2fca835e2e3e5e037306.
- Private launcher3f275d53cbcda7d78e9ea60f150691d24544c3a8f726645fe29bb68bd9610a9f/helper0b426214023931ca573eccbaafdbe59ca21374f5a64a8519ac06e5b468c8fc47.
- CIDbf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5; loopback5433/pero_crm/userpero. Current schema74 finished/0 unresolved/new5 columns0 — ROOT должен подтвердить заново непосредственно перед фазой.
- Source compile94207PASS, private launcher static41681PASS,50targetedPASS/scopedlint0/0; не повторяем безизменений.

Preflight ожидает те же8 legacy DomainEvent columns/PK/index и atomic additive74→75: queueAttempts0/claimTokenNULL/leaseUntilNULL/nextAttemptAtDBclock/exhaustedAtNULL +pending index/budgetCHECK. Old IDs/payload/actor/createdAt/processedAt/attempts/lastError сохраняются. Исторические миграции/ledgerchecksums не меняются; mixedCRLFLF semantic0 уже независимо объяснены.

Exact prepare command /phase approval path выше остаются теми же. Durable private PRE:
D:/Projects/pero_crm_worktrees/improvements-129/apps/web/test-results/event-queue-native/03825ccd-3a4f-48b4-84bd-663b82237817.pre.json
и corresponding prepared/verify/observe-UUID/cleanup-intent-UUID/cleanup-ack parts в том же fixed directory. PRE wx/fsync/readback до3legacyownedINSERT; неизвестный ACK STOP безreplay.

Последовательностьauthority: reviewer currentpacketGO→ROOT fresh exclusive PREPARE_ONLY→rootinspect receipt/PRE/3owned/clients0→ROOT atomic DDL only→separate VERIFY_ONLY (2PID/heldclaim/expiry-wait/fencing/exhaustion/batch50/internalboundedobserver)→separate INSPECT/CURRENT_OBSERVATION→reviewed exact PK-locked/mutable-hash/noactiveclaim cleanup54→root independent own0/originallegacyhash/schema75/clients0. Каждаяфаза отдельный exactapproval; автор не запускаетDDL.

Oldbb6de6fc STOP/reconciliation остаются immutable, никаких retry старогоattempt. Staging activation/egress/originalpendinginventory — отдельный gate, не native local proof. Human all-plancommit permission получена, но actualnative/migration/stage acceptance не заявлена и rootfinalcommit/integration signal ещё требуется. Main/production forbidden.

135 cleanup label clarification from independent reviewer: runner locks exact DomainEvent PK IDs and validates actor/static+mutable state/active lease/protected legacy fingerprint. Generic all-incoming-FK catalog scanning отсутствует; такой proof не заявляется. Actual PRE/migration/verify/current observation выполняет root в exclusive window; author source/SQL/DDL0. Finalown0/cleanup stillpending rootphase.

## CURRENT LOCAL ACCEPTANCE — root actual run03825 (supersedes historical NOT_RUN/HOLD)

11.10.2026 root operator исполнил prepare→atomic migration→verify→fresh observation→exact cleanup на существующем bf45…/5433/pero_crm, автор SQL/DDL0. Independent FINAL_SOURCE_NATIVE_GO и ROOT_ATOMIC_COMMIT135_GO получены; direct human all-plan commit authorization действует. Исторические HOLD/74/PREabsent выше описывают свои прошлые фазы, не текущее состояние.

- Prepare3ee950 exit0: durable PRE8622895f3330b50c54cbaa7d8ef66700a80704166e5909b3ab84654ff036a7dc, prepared80dacf3c64502f3fda157c7531d7b3165c0513c5b398a4f81c8080da09669577; own3/protected12. PRE-beforeINSERT independently verified.
- Atomic migration bcee57 exit0: actual migration75 checksumab60…/0unresolved/13columns, ready_queue_idx and nonnegativeCHECK verified byroot0a72d3.
- Verify5f7000 exit0: distinctPGPID581598/581599, heldclaim and pg_locks wait-before-expiry/postlock DBclock fencing, staleACK/exhaustedlastcrash/manualretry/50fails+healthycycle2 PASS. Receipt95cbaccdb0be2144d87a194622aa803a48e49675de2b1c31d20d744e60ee53d9, canonicalf25ddb85… independently checked.
- Fresh observation9c39688c:8344a76d0608f47a46cfc88eb0dd7a2e9b5caefdac347fd7494a0864c91ae956 /semantic4b4165c8… owned54/active0/protected12same.
- Exact PK-locked cleanupc88735 exit0/deleted54: immutable/mutable/actor/activelease/protectedlegacy checks; ACK68be57acebb530314e5ba2b9f20af467f504c32904a874aab0a3930ba902127d /semanticcda75b5…. Generic incomingFK scan отсутствует вrunner; root separately verified actualincomingFKcount0 beforecleanup.
- Independent post165a65 07:56: schema75/13columns, original12events unchanged, own0/clients0. Oldcompleted/history retained, additive queue budget independent. No warehouseinit/seed/reset/dump/restic/S3/infra/main/production.
- Current source ordered8 SHA544c/native3df/DDLab60/launcher3f/helper0b unchanged. Final source+native/receipts/cleanup independently accepted.

Root phase approval guards correspond to time: prepare approval74/pre-own0; fresh cleanup approval75/owned54/active0. Old signed parts/approval files не переписывались. All signed checkpoints remain ignored/private; only related source/tests/docs/OpenSpec enteratomiccommit.

Staging/actual enabled backgroundworker/HTTP and sideeffectisolation **NOT_RUN**. Flags не переключались; source/local PASS не закрывает task5.1/5.2. Root normalmerge/push/deployment+ownedstageacceptance separately. Production/main forbidden.

## QA staging preparation — source-only, 11.10.2026

Новый adapter: 6/6 cold tests PASS (последний63f5fa); прежний local native body переиспользуется одним helper. Full web TSC41484 exit0; scoped lint579881 exit0, позднее изменение Date hash относится только к .mjs. First sandbox wrappers не запустили tsc/eslint; это не code failure. Corrected lint after QA variable/import fix — PASS.

SQL/HTTP/staging/config/session/storage effects:0. Ни global activation, ни staged native cases, ни stage original fingerprints этими cold-тестами не доказаны. Original applied135 migration/native/cleanup evidence выше остаётся историческим фактом для исходных6077 bytes. Перед actual stage нужен current shared163 policy/source/CJS packet и отдельный Root ONE.

### Independent scope blocker — RED to GREEN

Actual shared validator source SHA907a43d40fe5427faee9d55c2e5faccec13e6191f6a6b17a2dda327d2b17110a. RED6a11ad reproduced SCHEMA_IDENTIFIER_INVALID at post-prepare (cold mock had inserted3 owned rows); negative pre-effect case already passed. After exact two-scope fix, GREENed9500 exit0/2testsPASS; original6 checks067031 exit0/6PASS. Scoped lintbbe437 exit0/0warnings. No typed source change; full TSC41484 remains applicable to shared extraction. Canonical dependency must be available by normal163 integration before CI-ready/135commit qualification.

Temporary artifact: D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/stage135-snapshot-preintegration.test.mjs SHA5272bf8935f07aa3cb7a50a2ef473bd8c71b6a7b024e9e11d067f537312c7d42. Canonical test SHA92a2a2558e28e1f788e765596bbee68afd06b693a9f8cd0a105a9d053356f032. It changes only import URLs, does not embed/copy/relax the actual helper. Real SQL/S3/HTTP/stage/session effects remain0. Module-type warning concerns the existing source package format; no package/version changes made.

### Canonical dependency integration — 11.10.2026

Reviewed QA commit695d2b1947ef12d9211da745b48c60b72e93dfa0 preserved exact8paths90ee. Normal no-ff dependency merge16c2f618f41ef067fb9ece13897328d7b611f57b has parents695d2b1 and approved clean local staging7ee9e0057278d6627a9acb0e1f9299a30b9d2848; no conflicts/copy/cherry-pick. Current helper raw SHA8f95eac167b7073a09b9882e4c32978fafe405aff5e760aec1ec306dd335dbe8 (6924 bytes/62CRLF), canonical Git7ee9/LF SHA907a43 (6862 bytes/62LF). Read-only704bff proved exact LF equality/semantic delta0; evidence stage135-helper-eol-provenance.json SHA2b9b9e1c23ca82d775af12b02d024e2c82acc1044b5a5998645b77a3a4a46db5. Old907 raw is not claimed equal to current CRLF raw. The previous temporary bound import is historical only.

Actual canonical command `node --test tests/event-queue-stage-snapshot.test.mjs tests/event-queue-stage.test.mjs`: d15ea2 exit0/8PASS (2shared-scope +6stage isolation). Scoped lint d12d1f exit0; strict OpenSpec5c715e exit0. Pre/post reviewed QA code hashes remained unchanged. This closes local helper availability/portable canonical test qualification; actual staged runtime/source-map/policy/PG concurrency/storage/browser acceptance remains NOT_RUN.

No push, staging configuration/SQL/session/storage/HTTP effects. Independent integration review and separate Root ONE remain required.


## Minimal staging caller and accepted pre-migration snapshot — 12.10.2026

Готовый factory/nativeCases/store/core переиспользованы двумя thin CLI файлами. Пять аргументов nativeCases используют существующие два scoped cycles, без private-loader/глобального worker. Ordinary Node22/esbuild0.28.1 CJS external public Prisma/Zod из actual app anchor; namespace/validators/locales не подменяются, версия Zod4.4.3 проверяется до Prisma constructor. Wrapper cap262144 сохранён, source grammar32618bytes PASS7997c6; scoped syntax/lint PASS871634. Новые tests/suite и local native50 не запускались. Structured HOLD/parts сохраняются перед статусным отказом host; итог печатается после awaited disconnect, disconnect failure остаётся HOLD.

Существующий nativeSnapshot исправлен только в трёх literal catalog queries: pgname t.relname/c.conname/g.tgname и internal-char g.tgenabled явно приводятся к text перед конкатенацией. Алгоритм, ordering, output и owned/foreign-reference guards не меняются. Source helper807814de reviewed; исторические local proofs с прежним8f95/907a не переименованы.

Три readonly HOLD attempt05124240/fdc9dcb4/bc9a898a сохранены отдельно. Последние дали protected/P2010/SQLSTATE42725, никаких fixtures/DML. После casts ONE fresh run bba03c06-62d9-4a68-bad2-2ede91cd3794, tool7c393f/exit0, на actual df05aa623ada3e2e4a747cbc33e21a27da1ac049/image24c4445c с прежним DB27/volume/W07: RR READ ONLY, DomainEvent8, old61 rows hash22e5b3b2cf36d6030f83efe1eb70d043, protected Payment/PayrollEntry/StockMovement/StockPurchase/WarehouseBalance/WarehouseMovementValuation/WarehouseAccountingState fingerprints, workerfalse/outbound0. Receipt .playwright-mcp/event-queue-stage/bba03c06-62d9-4a68-bad2-2ede91cd3794/receipt.json SHA75ad4d49571101dada107986d7d7f689fec9febaa6dbd5d6092e6a38db68d4b3; sourceHash9a9f921d666a485c46667093096a74b072ded6f733ac3184dfb0d7d9797ae2c6.

Команда до migration: из apps/web node tests/event-queue-stage-runner.mjs snapshot <currentSHA> <identity.json>. После Root normal merge/CI/actual13-column deployment: node tests/event-queue-stage-runner.mjs run <acceptedSHA> <identity.json> <beforeReceipt>. Последний запуск создаёт только54 собственных nonce-events через существующий adapter, delivery literal, compare old8/financial/stock до/после migration и fresh full original baseline внутри lifecycle, exact CAS/FK cleanup. Его actual stage run, migration13/check/index/checksum, post snapshot и queue acceptance пока NOT_RUN; отдельный RootGO обязателен. Global worker activation запрещён и не заявлен. Main/production/restic/dump/newDB не затрагиваются.
