# Tasks

## 1. Planning

- [x] 1.1 Проверить clean bugfix/135 от5a7f01a, перечитать task135/preservation/SAFETY-RULES и подготовить proposal/spec/design/tasks; подтвердить strict OpenSpec validation.
- [x] 1.2 Получить независимый design GO и root RELEASE_IMPLEMENTATION до исходных правок; exact allowed paths/defaults записаны в design.

## 2. Queue implementation

- [x] 2.1 Добавить RED с injected clock: 50failed+1healthy, два worker, crash/expiry/staleACK, heartbeat/timeout и exhausted-last-crash; зафиксировать прежнее голодание/неисключительное владение.
- [x] 2.2 Добавить additive DomainEvent migration и индекс; сохранить old ID/payload/actor/createdAt/processedAt/attempts; подтвердить dbgenerate/типизацию и migration preservation native в выделенном окне.
- [x] 2.3 Реализовать узкие claim/renew/complete/fail store и core с DB clock/token/lease CAS, ordering/backoff/budget; подтвердить GREEN матрицу без Promise exactly-once.
- [x] 2.4 Подключить ordinary events и internal cleanup executor к общей аренде/ACK; сохранить manual retry/историю и старые invalid/live-reference/current-winner guards; подтвердить существующие и новые cleanup тесты без реального удаления.

## 3. Runtime and diagnostics

- [x] 3.1 Подключить opt-in singleton/non-overlap/unref worker к existing instrumentation.register; проверить import/build no-start, live-disable и runtime config bounds соответствующими behavioral tests.
- [x] 3.2 Добавить защищённые queue aggregates/age на существующий dispatch API и docs/env examples; проверить Bearer write auth до DB и отсутствие payload/секретов в diagnostics.

## 4. Local acceptance

- [x] 4.1 В root-выделенном existing5433 native окне доказать two-session claims/expiry/staleACK/последний crash/миграцию на exact owned fixture IDs; before/after protected data fingerprints и exact cleanup, no dump/newDB/reset/seed/storagepurge.
- [x] 4.2 Выполнить targeted tests/scopedlint/typecheck/OpenSpec strict; записать actual outputs и source/SHA/target, полный build/suite координирует root.
- [x] 4.3 Пройти независимое code review и исправить замечания в этой ветке; commit только после CODE_REVIEW_GO/root разрешения и exact staged allowlist.

## 5. Staging acceptance

- [ ] 5.1 После root normalmerge/CI/migration принять actual deployed SHA/image/health и preservation completed/pending/internal fixtures; worker до isolation proof остаётся disabled.
- [ ] 5.2 После root DB/storage/side-effect isolation proof проверить настоящий background tick без ручного REST dispatch, singleton/metrics/50+1/lease-recovery/staleACK/exhaustion/internal cleanup на owned staging fixtures; записать PASS/NOT_RUN/BLOCKED, main/production не трогать.

## 6. Staging adapter (QA-only)

- [x] 6.1 Подготовить exact54-owned producer и переиспользовать native cases без расширения local target guard.
- [x] 6.2 Cold negative scope/worker isolation/active lease/FK/Date fingerprints; необходимые typing/lint.
- [ ] 6.3 Независимый source/protocol review, current shared163 catalog/runtime/source map binding.
- [ ] 6.4 Root-approved actual stage prepare/verify/observe/exact cleanup, original fingerprints unchanged, foreign pending untouched; global activation NOT_RUN.
