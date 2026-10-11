# Evidence

Задача130, дата11.10.2026. Worktree D:/Projects/pero_crm_worktrees/improvements-131, ветка bugfix/130 от staging4b6c2b92f9bc77deaddc5b8cc6e18a4e7a165847. Статус: LOCAL + NATIVE PASS, независимый FINAL_CODE_REVIEW_GO принят оркестратором; staging NOT_RUN. Commit HOLD до явного разрешения владельца.

## Implemented contract

Core перечитывает INCOME fixed BYN turnover, текущую ставку/схему/роли и prior accrual history внутри existing TaskTransaction. Adapter сохраняет общий18435/55001, ReadCommitted/maxWait5s/timeout15s. Decimal-delta>0, audit basis snapshot с точным row ID и durable event сохраняются одной командой. Public action/month/UI/role/FX/history остаются прежними, UUID/receipt134 не добавлены. После confirmed core return постэффекты не портят money ACK; UNKNOWN commit outcome протокол133 этим не решён.

Общий Decimal reader также обслуживает прежний numeric UI DTO. Basis хранит start/end/totalByn/count/percent/prior/expected/delta, event сохраняет прежний payload плюс payrollEntryId, не рассылает лишние финансовые basis поля.

## Local regression

- Deterministic baseline RED0/2:10independent calls создали3000 вместо300; failed audit оставила1payroll row.
- Corrected core GREEN2/2, расширенная concurrency/atomicity/topup/role/Decimal/known-postcommit coverage12/12.
- Existing combined-role/fixedforeign/month adapters сохранены; first adapter run34/36 из-за отсутствующего нового dispatchEvent stub, исправление interfaces→36/36PASS, assertions не удалялись.
- Typecheck первого adapter FAIL required globalThis.prisma cast; исправлен boundary unknown cast. Далее full tsc PASS и scoped lint9paths PASS0errors/0warnings до добавления последних read-only диагностик. Это исторический промежуточный результат; окончательный rerun после всех диагностик описан ниже и прошёл.
- Expanded relevant suites130+131+cash/history/percentage/task settlement+SSR+calendar:105/105PASS после sanitizer/read-only diagnostic units. Дополнительный plugin inspection inert case→15/15 dedicatedPASS, Это исторический промежуточный результат; окончательный total107/107PASS указан ниже.
- Root ограничивает full web suite/Next build координацией ресурсов; здесь не выполнялись, не заменяют runtime/SQL/staging.

## Native protocol and observed STOP

Независимые DESIGN/PROTOCOL_GO получены для existing local5433 exact containerbf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5/dbpero_crm/userpero. Root независимо наблюдала отсутствие local Next/event/native runtime/listeners/5433clients и дала exclusive HOLD. Exact manifest включает owned actor/payees/account/incomes и distinct money/audit/event IDs для10requests; durable prebaseline доsetup, two PrismaClient, late SECONDpayee fault обязательно проверяет PRIMARY payroll/audit/outbox внутриtx, full outside-owned fingerprints beforecleanup и подlock защищают cascade.

Первый approved native attempt: **STOP**, mutationStarted=false. Только private stop.json существует, manifest/baseline/captures не создавались, setup/financial SQL writes0. Соединения закрылись. Старый sanitizer слишком строго проверял полный multiline AssertionError и сохранил generic QA130_SCENARIO_FAILED; причина из утраченного exception не угадывалась. Повтор/cleanup не выполнялись.

После отдельно reviewed source-bound `operation:diagnostic` root разрешила один readonly probe с SET TRANSACTION READ ONLY. Actual result: QA130_ENABLED_PLUGIN_STOP, stageplugins; identityMatches=true, outsidePayees=0, outsideIncome=0, enabledPlugins=1; readOnly=true/mutationStarted=false. Это текущее observed guard evidence, не реконструкция original exception и не native PASS.

После отдельного concrete review и root `operation:plugin-inspection` выполнен один readonly SELECT только enabled Plugin.id, без settings/config/hook execution. Observed result:file-stages, registered=false, hasDomainEventHook=false в source-pinned registry/demo/SDK; enabledCount1, readOnly=true/mutationStarted=false. Existing Plugin row/config не изменялись. SDKdefinePlugin только возвращает manifest object, hook callbacks не вызываются metadata lookup.

Исторический initial plugins0 gate дал STOP без writes и был сохранён; затем отдельный source-pinned narrow protocol update прошёл DESIGN/CONCRETE_PROTOCOL_GO и fresh root approval. Никаких Plugin/config изменений не делали. Новый gate допускает только exact enabled[file-stages] сregistered=false/hook=false; empty/demo/extra/registered/source/runtime drift negative capsules отказывают. Новое observed правило потребовало fresh runId/manifest/sourcehash/approval/rootno-runtimewindow и негативные tests unknown/registeredhook/source/runtime drift; успешный отдельно разрешённый run описан ниже. Старый STOP/private artifact сохраняется.

## Preservation and remaining evidence

Schema/migration для130 отсутствуют. Не выполнялись dumps/reset/seed/new DB/restic/production actions. Native preliminary SQL было толькоSELECT, mutationStartedfalse. Main/production не изменялись; commit/push для130 не выполнялись. Unit не заменяют native/staging: нативный успешный повтор описан ниже. OpenSpec3.4 завершена после независимого финального code review;4.1 остаётся открытой до фактической staging-приёмки.
## Successful fresh native run

Новая namespace/runId:`af699a65-8480-4338-9654-829e41d2be10`. Старый private STOP `6b511ab8-01cf-4ce2-a527-59c47a711b4d` не изменялся. Root перед новым запуском независимо наблюдала отсутствие local Next/event/native runtime/listeners/5433clients, dispatcherflag absent, exact PG loopback identity и объявила exclusive DB/runtime/DDL HOLD другим агентам.

CONCRETE_PROTOCOL_GO и ONE_NATIVE_EXECUTE_GO использовали sourceHash **a243bb4520135c5334461d3d5681e7932abf18e1db1ab7a3a06807877f4a7a23**. Hash включает actual native runner/target guard/registry/demo/SDK/core/query/roles/month/calendar/format/workshares/lock/config. Root-created approval и before baseline прочитаны/сохранены durably с fsync/readback до setup. URL/credentials не выводились.

Команда: `CRM_LOCAL_CONTAINER_ID=<exact observed bf45...> pnpm --filter @pero/web exec tsx tests/turnover-accrual-native.ts --execute-reviewed-local <root-approved-native130-af699a65-approval.json>`.

Результат: **NATIVE_PASS**,10 independent requests через2 отдельных PrismaClient, первая общая сумма300.00, lawful topup60.00,3late faults у SECONDpayee. Перед каждым forced payroll/audit/outbox throw нативно подтверждены уже созданные PRIMARY payroll/audit/outbox строки внутри той же transaction; после rollback full fingerprints совпали. Replay и снижение не создают новых сумм, original300 сохраняется.

Exact owned ID/actor/relations/month/currency cleanup выполнялась только после captured own rowset и pre-cleanup original fingerprints excluding ownedIDs, с повторной проверкой под общим lock перед cascade. После cleanup все original public table/constraint fingerprints равны beforebaseline, persistentFixtureRows0, outbound0. Existingusers/plugins/config/realdata не изменялись; оба клиента finallydisconnected. Exclusive local window освобождена.

Private durable artifacts сохранены в `C:/Users/admin/AppData/Local/Temp/pero-crm-qa130/af699a65-8480-4338-9654-829e41d2be10`:approval.json,manifest.json,baseline.json,initial-capture.json,final-capture.json,cleanup-proof.json. Их rawfinancial/user payload не включается в репозиторий/публичный ответ.

## Final verification and source provenance

Final dedicated tests16/16PASS; full relevant subset107/107PASS (130+131/combined roles/BYN/cash/retry/percentage/historical task settlement/SSR/calendar). Final `pnpm --filter @pero/web exec tsc --noEmit --incremental false` PASS; scoped eslint9paths0errors/0warnings; diffcheck PASS. OpenSpec strict PASS.

После actual nativea243 обнаружено только TypeScript narrowing в QA guard: assert.equal(legacy,undefined) сужало legacy доnever перед?.hooks. Runtime работал, финансовый core/reader не менялись. Согласованная type-only эквивалентная проверка Boolean(legacy)==false для pinned getManifest(object|undefined) проходит16negativecaps иfinaltyping. Final QA sourceHash **85010049850840379c1c04df0b324e8734b1b3f276726bbfb0e7ea8fee9c7c5e** отличается от executed a243; прежние manifest/receipt/result не перепривязываются и не редактируются. Независимый reviewer подтвердил эквивалентность; новые SQL runs не делались радиtype-only правки.

Production core/query source inputs у успешно проверенного native остаются неизменными. Full web suite/Next build выполняет интеграционный/CI контур оркестратора. Actual deployed staging131/130 HTTP/CSV/browser/native проверки остаются отдельными и не закрываются localpure/SQL результатами.
Независимый FINAL_CODE_REVIEW_GO получен и принят оркестратором11.10.2026: проверены итоговый diff, exact allowlist, native cleanup proof и эквивалентность QA typing-only правки. Замечания historical DST131 и late partial-write fault130 закрыты соответствующими regression/native доказательствами. Commit130 остаётся запрещён до явного human-разрешения; technical review GO не заменяет Git-разрешение.

## Owner explicit commit authorization11.10.2026

Владелец ответил «Разрешаю коммиты по всему плану», после чего root отдельно разрешил atomic commit этого FINAL_CODE_REVIEW_GO кандидата. Прежние HOLD записи выше являются историческими. Source/test/native evidence неизменны, main/production запрещены. Actual staging ещё NOT_RUN; parent выполняет normal merge/CI и отдельную приёмку.
