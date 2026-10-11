# Tasks

## 1. RED и proof contracts

- [x] 1.1 Зафиксировать RED отдельно для dispatch/person/org/cache после confirmed task/payment commit; baseline tests показывают ошибочный ACK/исключение, а сохранённые IDs/деньги/status не меняются.
- [x] 1.2 Зафиксировать фазы actual pinned transaction protocol и faults callback-abort/lost commit ACK/failed fresh proof; tests запрещают candidate→success и reject→automatic rollback.
- [x] 1.3 Зафиксировать actual lawful START→DONE→oldSTART_UUID исторический ACK без нового timer/audit/payroll/current status apply; engineering reassignment reject/no-write и ordinary reassignment keepsIN_PROGRESS проверены реальным action/core. SUPERSEDED unreachable reset не используется как proof.

## 2. Shared confirmation и эффект

- [x] 2.1 Реализовать narrow confirmation helper с fresh same-lock SELECT-only proof; phase/fence negative matrix подтверждает COMMITTED/ROLLED_BACK/UNKNOWN и настоящий error, source не меняет shared transaction lock/options.
- [x] 2.2 Реализовать независимые post-commit effects и safe diagnostic codes; sync/async/diagnostic faults не меняют confirmed result ID и не мешают следующим эффектам.

## 3. Task status и payment

- [x] 3.1 Реализовать optional task-status UUID и атомарный actor/type/normalized-payload receipt; actual core tests подтверждают exact replay, mismatch/foreign/deleted-context negatives, неизменность payroll/audit/event/timer при старом START retry после lawfulDONE.
- [x] 3.2 Подключить7webcallers через один pinned-intent helper; actual component/browser UNKNOWN/transport-loss→sameUUID/payload, account swap/cross-tab no-receipt negative +stale-generation ACK ignore, confirmed rejection rollback и valid new intent проходят без изменений layout/styles.
- [x] 3.3 Подключить payment confirmation к existing receipt/candidate proof, additive IDs/outcome; preserve fingerprint/FX/history/deleted-payment tests и route/bot tests подтверждают sameUUID ACK/UNKNOWN без второго payment.

## 4. Остальные confirmed wrappers

- [x] 4.1 Подключить указанные product/work/warehouse wrappers к common effect runner; actual DI tests для каждого cache/event/notify fault оставляют success и прежние business/financeState payloads.
- [x] 4.2 Перенести mandatory removeWork/projectMaterial3audit в их existing transaction; real-module tests показывают full rollback при audit fault, прежние payload/source и role/quantity constraints сохраняются.

## 5. Local/native/review

- [x] 5.1 Выполнить relevant task/payment/cash/BYN/history/percentage/work/warehouse/route/bot suites, согласованный tsc/scoped lint/diff/OpenSpec; evidence содержит команды, конкретные уровни и результаты.
- [x] 5.2 Подготовить inert existinglocal5433 native runner с exact source/target/owned manifest, outbound deny и cleanup/fingerprint protocol; получить independent PROTOCOL_GO/root execution GO до любого SQL write.
- [x] 5.3 Выполнить reviewed native через реальные connections, injected ACK loss после real SQL commit и rollback/fence cases; exact owned cleanup/protected full fingerprints подтверждены, unproven/failed run остаётся STOP/UNKNOWN, без seed/reset/dumps/new DB.
- [x] 5.4 Пройти независимый финальный code review и relevant reruns замечаний; FINAL_CODE_REVIEW_GO записан с exact allowlist/source pins.

## 6. Actual staging

- [ ] 6.1 После явного owner commit permission и normal merge/CI оркестратор фиксирует actual staging SHA/image/health/W07; real app/route/component/browser/native receipt/effect/outcome scenarios, protected money/history и viewport visual comparison проходят. Main/production не изменены; pure/DI/local proof не заменяют stage acceptance.
