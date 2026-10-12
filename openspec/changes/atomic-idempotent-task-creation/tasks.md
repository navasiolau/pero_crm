# Tasks

## 1. Согласованный scope и исходный RED

- [x] 1.1 Получить независимый DESIGN_GO exact6production/5test paths и root source release; проверить planning strict и отсутствие source edits до release. Review выявил delayed-original race; root согласовал удержание UUID после UNKNOWN, final CODE_REVIEW_GO422043 подтвердил исправление.
- [x] 1.2 Дождаться actual staging acceptance133, fetch и обычным merge включить принятый origin/staging в bugfix/165; записать base SHA и отсутствие copy/cherry/squash, при conflict STOP.
- [x] 1.3 Зафиксировать исходный actual-action RED: Task quantity1/work10, поздний audit failure и retry дают2Task/quantity2; сохранить test fixture seam и baseline assertions существующих task-work-required/work-shares-settlement без native/production claims.

## 2. Атомарное серверное намерение

- [x] 2.1 Добавить creation-receipts UUID/actor/command fingerprint и strict compact ACK; тестами проверить canonical UUID, defaults/decimal/date/dependency normalization, malformed/foreign actor/payload/action receipts и отсутствие writes без UUID.
- [x] 2.2 Подключить receipt/replay в прежний createTask callback с текущим actor guard, Task/dependencies/audit/outbox/receipt в одной transaction; actual-action tests должны дать GREEN для late audit/outbox/receipt rollback,10sameUUID→oneID/quantity1, changed payload conflict и2newUUID→twoIDs/quantity2 без изменения остальных action functions.
- [x] 2.3 Использовать confirmation133 с SELECT-only exact receipt proof и post-commit task-create operation; проверить committed-ACK loss recovery, absent/read-failed proof→UNKNOWN, attempt-only против verified-absent marker с UUID binding, no automatic mutation retry и каждый optional dispatch/notify/cache fault без изменения confirmed ACK.
- [x] 2.4 Исключить только внутренний create receipt из global audit reader до take200; actual-reader cases должны сохранять обычный create audit, все старые/несовпадающие action/id rows, filters/order и status receipt exclusion133.

## 3. Клиент и регрессии

- [x] 3.1 Добавить один create-specific pinned intent/controller/hook и TasksTab wiring; pure tests проверяют sameUUID/payload, coalesced clicks, changed-payload block, success UUID mismatch→UNKNOWN, actor generation/stale ACK/retained hidden original actor intent, обязательный lostACK→not-started retry→sameUUID→matching ACK; после UNKNOWN отсутствие под lock также сохраняет UUID.
- [x] 3.2 Проверить настоящий TasksTab в Chromium: trusted submit, injected lostACK→attempt-only retry refusal без fresh UUID, close/reopen/remount той же работы, immutable fields/«Проверить», actor switch и сознательно новое одинаковое назначение; сохранить1440×900/390×844/360×800 before/after без необъяснённых отличий обычного состояния, await own browser/server cleanup; missing binary — BLOCKED/failure.
- [x] 3.3 Адаптировать только UUID/actor/receipt fixtures двух existing suites; подтверждение по AST/value assertions и прежним quantity/Decimal/dependency/historical outcomes, без уменьшения покрытия/дублирования business functions.
- [x] 3.4 Выполнить targeted action/client/retained suites, coordinated strict typing и scoped lint/strict/diff; записать реальные команды/exit/count, source allowlist и изменение LOC/исполняемого кода без ложного обещания экономии от type-only переносов.

## 4. Реальный PostgreSQL и независимое ревью

- [x] 4.1 Подготовить inert native runner реального createTask и конкретный reviewed source/target/ownership protocol на существующей разрешённой БД с двумя clients/PIDs; до SQL writes получить independent PROTOCOL_GO/root window, durable owned ID/UUID/baseline и actual current catalog/ledger proof, без dump/seed/reset/newDB/restic. Readonly qualification отдельно разрешена Root.
- [ ] 4.2 Выполнить10concurrent/sequentialsameUUID,2newUUID,changedpayload/actor, audit/outbox/receipt late-fault rollback и committed-SQL→injected ACK loss→replay через реальные соединения; доказать oneTask/oneaudit/oneevent/onereceipt/quantity1 и protected fingerprints, отдельно пометив auth/external-delivery/ACK-loss seams. Все перечисленные local native cases кроме отдельного negative actor выполнены; negative actor/expectedActor доказан actual-action DI, native AUTH — owned-manager seam. Отдельный native/HTTP actor case остаётся NOT_RUN.
- [x] 4.3 Подтвердить exact owned cleanup с narrow PK locks/all foreign refs и original fingerprints before deletion/inside transaction/after; UNKNOWN/guard mismatch сохраняет evidence и означает HOLD без автоматического replay/cleanup, persistent owned rows0 обязательны для PASS.
- [x] 4.4 Получить независимый FINAL_CODE_REVIEW_GO по фактическому diff/local/native/browser evidence; atomic commit толькоexact165scope, source hash proof и main/production unchanged. CODE_COMMIT_GO18679b принимает native CLOSED63f0748; scope-manifest.json перечисляет6production/5tests, включая native runner.

## 5. Приёмка staging

- [ ] 5.1 Parent выполняет обычный merge/CI API; подтвердить actual deployed SHA/image/health/W07/source pins, не подменять acceptance push/build или локальными DI receipts.
- [ ] 5.2 На этом SHA выполнить reviewed actual native/HTTP/browser lossACK/reopen/roles/quantity/atomicity scenarios и protected snapshot/visual comparison; записать каждую row PASS/NOT_RUN/BLOCKED с настоящим результатом/cleanup, завершить165 только после всех требуемых staging proofs; main/production не переносить.
