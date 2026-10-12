# Фактическая приёмка №165

Base: `c6508448450813450b5dbb6a67d77494c37f6cdb`, `bugfix/165`, worktree `D:/Projects/pero_crm_worktrees/improvements-165`. После fetch выполнен обычный FF merge принятого origin/staging; копирование, cherry-pick, squash, reset отсутствуют. Main/production не менялись.

Согласованный production scope: шесть путей из design.md. Existing quantity/dependency functions, transaction lock `18435/55001`, ReadCommitted/maxWait5000/timeout15000, update/delete/status и финансовые факты не менялись. Новые canonical UUID/actor-bound receipt сохраняют одно будущее намерение; историческая Task при replay не загружается и не воссоздаётся.

Независимое DESIGN review нашло гонку delayed original → retry absence → fresh UUID. Root согласовал уточнение: после UNKNOWN только matching COMMITTED ACK освобождает UUID; absence/attempt rollback удерживают payload. Терминальные отказные tombstones не добавлялись. Actual-action/controller regression задерживает исходный запрос до transaction, получает отказ повтора при отсутствии receipt, затем допускает исходный commit и подтверждает одну Task тем же UUID.

| Проверка | Фактический результат |
|---|---|
| RED действующего createTask на исходной базе | actual action + existing guarded DI fixture: injected late audit failure после commit; retry создал2Task, quantity2 изwork10. Probe exit0 подтверждает дефект; это не native SQL |
| `pnpm --filter @pero/web exec tsx --test tests/task-creation.test.ts tests/task-work-required.test.ts tests/work-shares-settlement.test.ts tests/confirmed-action-effects.test.ts` | exit0,52/52; late audit/outbox/receipt rollback,10sameUUID→1ID/quantity1, independent UUID, conflicts/current actor, exact audit reader, loss-of-ACK, all optional effects. Старые имена/assertions сохранены |
| Финальный `tsx --test tests/task-creation.test.ts tests/task-creation-command.browser.test.ts` | exit0,11/11; strengthened delayed-original case + Chromium |
| `pnpm --filter @pero/web exec tsc --noEmit --incremental false` | exit0 после последнего native guard |
| Scoped ESLint six production/five test paths | exit0,0warnings после удаления unused import |
| `openspec validate atomic-idempotent-task-creation --strict`, `git diff --check` | exit0 |
| Actual TasksTab Chromium, trusted clicks | PASS при1440×900,390×844,360×800: loss→attempt-only/absence refusal→close/reopen/remount→matching replay; actor swap hides/retains original intent; сознательный следующий submit получает новый UUID |
| Normal visual baseline | Три before/after PNG byte-identical на реальных globals.css и общем Arial fallback; remote fonts/RPC запрещены. Изолированные unrelated closed sibling dialogs не заменяют inline create UI. Shallow CI выполняет full behavioral browser gate, visual comparison там обозначен NOT_RUN |
| Native readonly qualification | PASS: guard before constructors, existing `pero_crm_pg` ID `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`,127.0.0.1:5433/pero_crm/public;62tables/76ledger; unfinished ledger0 |
| Native atomicity/concurrency/cleanup | PASS, Root ONE на current source после independent review: PID720181/720180,10concurrent+sequential sameUUID→1ID/quantity1; новый independent UUID разрешён; changed payload rejected; late audit/outbox/receipt показывают uncommitted parts1/0/0,1/1/0,1/1/1 и полный rollback; реальный SQL COMMIT→injected ACK loss→matched receipt/replay. Всего три confirmed Task quantity3; exact cleanup0, all62original fingerprints/ledger/schema unchanged |
| Staging deployed/native/HTTP/browser acceptance | NOT_RUN, выполняет Root после ordinary merge/CI |

Browser evidence: ignored `.playwright-mcp/task-create-165/{1440,390,360}-{before,after,unknown}.png`, receipt.json. Каждый собственный Chromium context/browser закрыт через await; HTTP server не создавался, DB не использовалась. Скриншоты лично просмотрены; диалог прокручивается на мобильных разрешениях, кнопки доступны trusted actions.

Readonly qualification baseline SHA256: `6f82f00e5ddec0fdf0daf766913e8c387724752ead4e0a9d23d958a5880c3671`; ledger digest `91449bf2428ecc13c21bad35a4de88550245493a9cd2749bb77e513e81690752`. FINAL native source digest explicit17files `386574f35bc226ed02d014ebd848e9ede90a3ac3d129c094676ef1603667b046`, runner byte SHA256 `2593db18e79b0d8ff1e702291d5410ef68f93632d2299109511686cee6247a50`. Независимый CODE_REVIEW_GO + INERT_NATIVE_PROTOCOL_GO `422043`; Root дал один execute GO по этим hash и baseline. Выполнение9.6s/exit0; ignored native journal `.playwright-mcp/revision-acceptance/d4d40ab2-4d37-4a55-9044-e75c9d640165/closed.json` записан после обоих successful disconnect. Post-source hash совпал с разрешённым.

Production physical LOC на принятой базе→current: tasks/actions526→560, new creation-receipts0→50, new use-task-create-command0→78, TasksTab541→556 (включая конкретный P2 draft-preservation fix), post-commit18→18, changelog/queries23→26; net+180 protection LOC. Это добавленная гарантия, не обещание экономии JS и не type-only сокращение. Existing private quantity/estimate/dependency functions не копировались.

Native CLOSED receipt SHA256: `63f0748e7955cab86837564adc6e703ef9cf170151be739523b010051d258284`. Separate native negative actor остаётся NOT_RUN; actual-action DI actor/expectedActor/malformed-receipt cases PASS. До завершающей staging приёмки не заявляется полный status accepted. Root освободил local5433 после CLOSED; повторных local SQL/actor-matrix запусков нет.

Root ACTUAL_LOCAL_GO + CODE_COMMIT_GO `18679b` подтвердил фактический CLOSED и разрешил один atomic commit exact6production/5tests+OpenSpec. Native runner входит в эти5tests. Узкий `scope-manifest.json` хранит11 file hashes/LOC; отдельные deployment/staging/actor-negative proofs остаются pending. Main/production не переносились.

CI интеграционного `ed04cfec` run38242899375 выявил один существующий stale assertion: journal-admin-only.test.ts42 ожидал только status receipt exclusion. Denial loop/reads0 для всех non-ADMIN и ADMIN reads1 до этой строки прошли; фактического ACL regression не обнаружено. По поручению Root обновлено только ожидаемое NOT/OR двух точных receipt exclusions, все role/filter/order/take assertions сохранены. Scope дополнен одним existing affected test (production6/tests6); новый source/runtime/SQL не добавлялся. Native byte/source hashes остаются прежними. Normal business audits/internal hiding отдельно защищены actual-reader test task-creation.

Affected correction verification: `tsx --test tests/journal-admin-only.test.ts tests/task-creation.test.ts` exit0,12/12; scoped eslint journal-admin-only и diff check exit0. Никакой повторной native/SQL/browser приёмки для test-only изменения нет.
Независимый correction CODE_GO `bcfd0b` разрешил exact3 paths: existing Journal test, evidence и scope manifest; production/native diff0.

Никаких local/staging dumps, seed/reset/newDB, restic, original person/account preferences или глобального worker. Native AUTH и optional network/cache effects изолированы и будут отдельно помечены; строки native сценария должны закрыться0 exact-owned rows и сохранностью всех original fingerprints. UNKNOWN/guard mismatch — HOLD без автоматического cleanup/replay.

Latest d339 CI run38248960083 failed existing Chromium assertion79 (#est disabled after actor change), while prior same SHA run38248941946 passed165. «Создать» visibility precedes completion of previous async transition; added one exact DOM enabled await before the unchanged assert. Production/UNKNOWN/actor checks unchanged, no sleeps/timeouts/new scenario/native rerun.
Affected Chromium rerun: exit0/29.4s,3viewports/normal baseline pairs PASS; all contexts/browser awaited CLOSED. Scoped eslint/diff0. Native source digest386574f35bc226ed02d014ebd848e9ede90a3ac3d129c094676ef1603667b046 unchanged after ordinary FF merge freshorigin d339. Scope-manifest remains the prior implementation/test snapshot; this subsequent test-only timing delta is identified by its Git diff, not declared a new native proof.
Independent tiny timing correction CODE_GO1a7ede verified presence-required predicate matches disabled===false and preserves every actor/UNKNOWN/UUID/count assertion; approved2test/evidence paths only.
