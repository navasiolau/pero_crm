# Design

## Одобренный follow-up после CI266

Baseline — принятый61f9bc14, CI266196с/native155с/promotion32с, цель180с OPEN. Compiler-cache restore получает id; inject остаётся обязательным, extract пропускается только при `cache-hit == 'true'`. Miss/fallback/failure сохраняют прежний `always`/prepare-success guard. Browser binaries cache использует OS/architecture/реальную установленную Playwright version и lockfile, без restore fallback; `playwright install --with-deps chromium` остаётся обязательным для системных зависимостей и проверки нужной версии. По CI266 TasksTab/status suite имеет сумму case durations39,10с против8,62с global-kanban; меняются местами только эти два файла между прежними cohorts60,4/24,2с. File isolation/default concurrency/commands и все gates сохраняются; суммы пересекающихся case durations не обещают whole-run выигрыш. OCI runtime pruning без per-file/usage proof не выполняется: Prisma CLI/engines/migrations и остальные runtime packages остаются.

## Context

Исходная ветка №170 создана от `origin/staging=e986e290`; там ещё нет runtime №169. Мотивация описана в proposal.md. В установленном Next 15.5.20 встроенная типизация исключает `*.test.*` и `__tests__`, поэтому она не заменяет полный web `tsc`.

Исторический полный private-run №238 занял 887,77 с: приложения 367,60 с, Next 141,93 с, native 232,78 с, включая source build MinIO 209,45 с. Public-run №239 attempt 3 завершился ошибкой старого pixel assertion: 261 с всего, приложения 142,102 с; Next/native не выполнялись. Из этих двух прогонов нельзя выводить полный коэффициент ускорения №170 или приписывать смену runner изменениям кода.

Прежняя цель принята; Root затем подтвердил обычный CI №249 на staging `2f6573b7b8ffe52ad12c364ac9df9e8ed1a39fdc`: 293 с против 789 с №244, 2,69× быстрее. По новому поручению владельца следующая малая итерация остаётся OPEN до фактического результата обычного обязательного CI.

Обычный CI №251 занял 485 с; Root принял staging `a3e5194d78e934f4e824675e718e6e60b2a16686`, native 73/73 и полное удаление временного стенда. Это фактическая приёмка сохранённых проверок; цель 180 с остаётся OPEN. Следующий шаг устраняет повторную подготовку runner и передачу build artifact объединением build/checks и native.

## Goals / Non-Goals

**Goals:** Сократить повторную работу и последовательный critical path существующего CI, сохранив строгие gates, свежие route types и guards №169. Цель следующей итерации — полный обычный обязательный CI не более 180 с; фиксируются фактический SHA, длительность и cache/runner условия, без гарантии такого времени при cold cache.

**Non-Goals:** Новый QA framework, дополнительные benchmark-прогоны, локальные HTTP/DB/S3-стенды, смена runner/settings/billing, зависимости/lockfile, main/production.

## Decisions

1. `PERO_CI_EXTERNAL_CHECKS=1` действует только вместе с `GITHUB_ACTIONS=true`. CI lint остаётся обязательным, полный `tsc --noEmit` запускается после production build. `.next/types` и готовая сборка не кэшируются; допускаются `.next/cache` и отдельный совместимый incremental state после проверки его поведения.
2. Next cache имеет ключи ОС, Node, lockfile, build-конфигурации и исходников. Restore fallback ограничен совместимыми зависимостями и конфигурацией; каждый run заново строит Next. Только `.next/cache` входит в архив.
3. В Docker все workspace manifest-файлы предшествуют install, а исходники следуют после install. Root `.dockerignore` исключает каталоги tests из production context; CI checkout сохраняет все suites и полный tsc, отдельный MinIO context не меняется. Отдельные scopes web/bot/MinIO сохраняются. Только web publisher после успеха полной unit matrix и native передаёт build-stage ARG `GITHUB_ACTIONS=true`/`PERO_CI_EXTERNAL_CHECKS=1`, пропуская повтор Next inline lint/types, но создавая свежий standalone. ARG defaults — false/0; обычные local/Docker проверки сохраняются, runner stage не получает flags, ABI/artifact copy не добавляется.
4. Unit suites выполняются штатным `tsx --test` с process isolation, а pnpm запускает независимые workspace scripts. Следующий YAML-шаг разделяет прежние web globs на три unit matrix группы без пропусков/повторов: `backend` — 260 TS, `components-0` — 32 и `components-1` — 31 MJS/browser TS, всего 323 файла; component files чередуются в прежнем glob order. Полный lint и прочие workspace suites выполняются один раз в backend группе. Default file concurrency не меняется, matrix `fail-fast: false`. Успех unit gate требует успеха всех трёх групп, одновременно выполняемых со свежим build/native.
5. Для разработки владелец отдельно разрешил normal merge `feature/169=8a0f0ae` в `feature/170`; это не является приёмкой №169 и не переносит его в staging. Принятая зависимость затем приходит обычным merge свежего staging. MinIO Dockerfile собирается Buildx с закреплёнными source/Go pins и отдельным GHA scope. Runtime принимает только текущий локальный image ID с проверенными labels; контейнер получает новые run/attempt labels при каждом запуске. Существующие digest-проверки, tmpfs, guard и `always` cleanup остаются.
6. CI выполняет существующие build/checks и native на одном runner: свежий production build и полный web tsc предшествуют native `next start`, без повторной сборки и передачи artifact между jobs. Независимые unit suites могут выполняться параллельно. Exact checkout SHA, repository/run/attempt, Node/OS и native target/ownership guards сохраняются. Если artifact передаётся между jobs, прежний manifest/SHA256/BUILD_ID binding остаётся обязательным. Оба publisher jobs напрямую требуют `success` полной unit matrix и native job с cleanup; только push и успех обеих зависимостей допускают публикацию, failure/skipped/cancelled блокируют её. Native files сохраняют последовательное исполнение: общий warehouse state и protected snapshots не допускают неподтверждённого параллелизма.
7. `hasExternalCiChecks` требует `GITHUB_ACTIONS=true` и `PERO_CI_EXTERNAL_CHECKS=1`; отдельный `PERO_CI_NATIVE_BUILD=1` отключает standalone только в native CI. Docker CI с внешними checks создаёт standalone; обычные local/Docker сохраняют встроенные checks и standalone. Полная `.next`, свежие route types, native `next start`, обязательные lint/полный tsc и source/run binding сохраняются. Успешная приёмка CI256 168 с остаётся историческим warm-run результатом; выигрыш нового Docker шага ещё не измерен.

## Risks / Trade-offs

- Ускорение на cache miss зависит от runner и внешних загрузок → фактическое время фиксируется только по обычным разрешённым CI-прогонам; benchmark не запускается.
- Next не проверяет все test-файлы → полный web `tsc` остаётся отдельным обязательным шагом после build.
- GHA cache может вытеснить слои → отдельные scopes; miss влияет на время, но не на корректность.
- Разработка следующей итерации идёт от принятого staging `567192b4`; прежняя приёмка №169/170 и её receipts сохраняются, новый код требует обычной staging-приёмки.

## Migration Plan

Следующая малая итерация №170 проверяется локально по затронутым конфигурациям и проходит независимый review. Корневой агент выполняет обычную staging-интеграцию и измеряет полный обязательный CI; отдельные benchmark или дополнительные QA-прогоны не создаются. Публикация требует прямого успеха полной unit matrix и native job, fresh source/run binding и `always` cleanup. Main/production и миграции БД в эту задачу не входят.

## Текущая OCI/provenance архитектура после 259f

Этот follow-up заменяет прежнюю host-build/native-no-standalone delivery shape; прежние DONE receipts не меняются. Shared Bake DAG (docker/bake-action v6 pinned5be5f02ff8819ecd3092ea6b2e6261c31774f2b4) собирает fullOCI(provenance max), Docker projection(no attest) и fresh metadata одним graph. Native/HTTP запускаются в той же Alpine runtime config/layers; equality actual config/diff_ids и revision/BUILD_ID/source input binding обязательна, cross-ABI .next/node_modules copying запрещён. Полный immutable OCI artifact SHA/run/attempt/repository-bound; только после full unit matrix/native/fault cleanup SUCCESS registry promotion regctl v0.11.6 с pinned SHA2568e0e62a497fcdb8048d18aa927a139613176ba0531f412bc541044e28f9856bd переносит original OCI и referrers, без rebuild/ранних tags. Bot uses backend-tested plain-JS dist того же SHA/run/attempt/source inputs через guarded minimal named context; default local Docker builds нормально, runtime deps/versions/env protections не меняются. Native main web production CMD/migrate и fault child direct server/no migration согласованы с169: тот же PG/network, unique NOSUPERUSER ci_fault_run_attempt LOGIN5/minimal plugin DML/User SELECT, real boot health200 перед POSTBOOT role-only CONNECTION LIMIT0/exact role+pero_ci session termination. Health503/session null/my307 assertions/main role/PG/S3/protected data сохраняются, оба owned children проходят cleanup; mocks/NEXT_PHASE bypass/PG stop-reset запрещены. Cache reuse допускается только совместимый/Alpine, не host ABI. Speed фиксируется ordinary CI, прежние168warm/411cold — history, нового обещания нет.
