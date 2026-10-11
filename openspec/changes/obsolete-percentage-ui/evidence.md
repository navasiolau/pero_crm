# Evidence

## Result

Задача156 реализована в feature/156 от d121f0798e963f32d13f52c9bde57c0aa82b7929 после независимого DESIGN_GO60cc и ROOT_RELEASE_IMPLEMENTATION. Состояние — independent CODE_REVIEW_GO; root разрешил атомарный коммит156 по прямому разрешению владельца коммитов всего плана. Фактический SHA фиксируется Git и передаётся root после commit; push/merge и staging-приёмка не выполнены.

Exact source/test allowlist остался прежним: удалены lib/inline-percentage-projection.ts, components/engineering-fund.tsx и два obsolete test files. В inline-engineer-fallback удалены ровно две строки: import canRebaseSuggestedParticipants и одна dependent assertion. Оба query/compatibility blocks остались; первый block дословно равен baseline, второй отличается только указанной assertion. Cryptographic UUID block перенесён дословно в новый request-id.test.ts, AST SHA0e048375cc22dd78f4f66f510470f2275f7635e888c9d5c8c1c46f1281c1c2e3 сохранён.

## Source and consumer proof

- Перед cleanup повторно выполнен fresh AST/text inventory1236files/1199AST; три импорта targets были только в tests, production/bot/packages/scripts consumers не найдены. Snapshot совпал с planning SHA762f16ff1e3f05b63f1a331dd0e8bd6b23384a0f50702ae8b3bd3621cbb408cd; это fresh execution с одинаковыми детерминированными bytes, не повторное использование old PASS.
- До изменений зафиксированы1233 public source/test/schema/migration files и пять узких source snapshots. Удаления выполнялись по четырём literal absolute paths с проверкой prefix/realpath/reparse/source SHA; каталоги и foreign files не удалялись.
- После cleanup проверено1228 остальных файлов: все physical bytes равны baseline. Financial readers, engineering-fund-view/percentToStageUnits, frozen settlement DTO, preview, schema и migration SQL сохранены. Это source/schema proof, не native fingerprint реальных строк БД.
- Post inventory1233textfiles/1196AST: target imports/reexports/literal dynamic edges0, unknown production dynamic imports0 для обхода; orphan target files отсутствуют. Отрицательный EngineeringFund guard в product-single-page сохранён как text-only reference.
- Actual source delta: два модуля / девять exports /108 physical LOC /8447 UTF-8 bytes удалены. Actual test delta:145→32 physical LOC, −113 LOC;13→3 retained blocks, десять obsolete blocks удалены. Новое request-id test8lines и mixed file24lines. Production chunks/actual executed-JS delta NOT_MEASURED; browser latency или исправление iMac не заявляются.

## Local checks

- Единственная owned offline frozen install: session77703, pnpm11.10.0,16.6s,724added/721reused/0downloaded, ignore-scripts, exit0. Lockfile до/после b33d80beda2a48e643e96a09640fca98d3b1d88570c3af0eba21b84eb1c1c9cc.
- Own static Prisma6.19.3 generate --no-engine:356ms/exit0, только для mocks/types; autoinstall/внешний binary download отключены, existing cached6.19.3 binaries unchanged. Это не native/runtime DB proof.
-13 existing/live test files: inline-engineer-fallback, request-id, single-percentage-controller, single-percentage-action-transport, single-product-percentage-ui, product-percentage-visibility, global-percentage-defaults-ux, product-engineering-view, single-product-percentage-schema, single-product-percentage-core, product-stage-pay, product-percentage-pay, product-single-page. Фактически109/109PASS,0fail/0skip,1937.02ms, exit0. Проверены meaningful lost ACK/dirty/null-zero/frozen/privacy, historical snapshots/settlement и schema assertions; assertions protected suites не менялись.
- Test process DATABASE_URL временно указывал на forbidden loopback1 URL; реальная БД и реальные финансовые строки не использовались. Financial writes внутри in-memory fixtures не объявляются native transactions.
- Full web TSC --noEmit --incremental false: session72044/exit0,09:08:33.138Z→09:08:55.708Z, source frozen, собственный compiler5.9.3/static client6.19.3. Во время и после typing application source не менялся.
- Targeted ESLint двух оставшихся изменённых test paths с max-warnings0: exit0/0errors/0warnings. Удалённые files не передавались lint как существующие.
- strict OpenSpec и git diff --check PASS. Exact six source/test paths и protected source proof закреплены source packet5c01b3c1e91be4207119441174af087ded5f43bfedc53738ef3a2e20b73c423d.

## Proof artifacts

Ignored apps/web/test-results/percentage156 не входят в будущий коммит. Пустой stdout TSC/lint может не создать Tee logfile; реальные status/exit/time/source bindings сохранены непосредственно выполнявшей их shell-командой в JSON results. Прошедшие команды ради logfile не повторялись.

| Artifact | SHA256 |
|---|---|
| planning-inventory.json and fresh before-delete-inventory.json | 762f16ff1e3f05b63f1a331dd0e8bd6b23384a0f50702ae8b3bd3621cbb408cd |
| before-all-source.json | dafff01359518af8764230cd4953f5071acab6707b514227f5834696da9ed276 |
| cleanup-applied.json | 1eb30e961aac4d478afdb00e6054c7350766ffe40e31649949172e67505fd529 |
| after-consumers.json | e30b73951d7d7a037bc326ec54f15ffc98301f719a8dfe19a4e54a897fef3889 |
| verified-cleanup.json | e9aae81c8ecfdcd9b99632413cb3cf78435e0378ab10d317212be6b0d6ea0292 |
| targeted-live-tests.log | 9a09c2a0f2edd450c1901f6139c3eee7f71165739f9c65536cb6208819ed1a57 |
| typecheck-result.json | b904b389052f0fb0debbdb60057f645d05a992236c68fcc07714d56b27b36d7f |
| lint-result.json | 0bf95756f221918bd4ae35263e2973eca85ab40b2a558d82c7fca438442b7f55 |
| local-result.json | aea5cb9719dc75f65006f99c68f01297abfc356edca908ff7c36224be0def3f6 |

Original approved design60cc сохранён separately как approved-design-60cc.md; текущие proposal/design обновляют только phase/status, allowlist и решения не расширены.

## Limits and delivery

- Independent CODE_REVIEW_GO получен для source packet5c01b3c1e91be4207119441174af087ded5f43bfedc53738ef3a2e20b73c423d и proof e9aae81c8ecfdcd9b99632413cb3cf78435e0378ab10d317212be6b0d6ea0292: exact scope,1228 protected files, UUID literal, mixed queries и109/TSC72044 приняты без замечаний. Root разрешил atomic156commit; его SHA фиксируется Git после commit, push/merge NOT_RUN.
- Actual browser/product-card visual/runtime и staging SHA/image/health acceptance NOT_RUN; этот этап выполняет root после normal merge/CI. Source/DI/typing не объявляются actual visual/native acceptance.
- DB/native SQL, models/rows/migrations changes, MinIO/storage, dumps/restic, Next full build, main/production — не выполнялись. Bundle/latency savings NOT_MEASURED.
- Outbound network traffic отдельно не инструментировался: NOT_MEASURED. Ноль downloads install и blocked external engine mirror не являются доказанным сетевым counter для всего test-run; no-egress/native-row claims не делаются.
- Работа153 commit761b0fc остаётся в её отдельной ветке неизменной;156 не копирует её или Finance147 WIP. Интеграция между ветками — обычным root merge.
