# Design

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
3. В Docker все workspace manifest-файлы предшествуют install, а исходники следуют после install. Root `.dockerignore` исключает только каталоги `apps/web/tests` и `apps/telegram-bot/tests` из production context; CI checkout сохраняет все suites и полный tsc, отдельный MinIO context не меняется. Отдельные scopes web/bot/MinIO предотвращают вытеснение взаимно разных build-графов. Runtime образов не получает CI skip-флаг; самостоятельные Docker build сохраняют проверки.
4. Unit suites выполняются штатным `tsx --test` с process isolation, а pnpm запускает независимые workspace scripts. Следующий YAML-шаг разделяет прежние web globs на три unit matrix группы без пропусков/повторов: `backend` — 260 TS, `components-0` — 32 и `components-1` — 31 MJS/browser TS, всего 323 файла; component files чередуются в прежнем glob order. Полный lint и прочие workspace suites выполняются один раз в backend группе. Default file concurrency не меняется, matrix `fail-fast: false`. Успех unit gate требует успеха всех трёх групп, одновременно выполняемых со свежим build/native.
5. Для разработки владелец отдельно разрешил normal merge `feature/169=8a0f0ae` в `feature/170`; это не является приёмкой №169 и не переносит его в staging. Принятая зависимость затем приходит обычным merge свежего staging. MinIO Dockerfile собирается Buildx с закреплёнными source/Go pins и отдельным GHA scope. Runtime принимает только текущий локальный image ID с проверенными labels; контейнер получает новые run/attempt labels при каждом запуске. Существующие digest-проверки, tmpfs, guard и `always` cleanup остаются.
6. CI выполняет существующие build/checks и native на одном runner: свежий production build и полный web tsc предшествуют native `next start`, без повторной сборки и передачи artifact между jobs. Независимые unit suites могут выполняться параллельно. Exact checkout SHA, repository/run/attempt, Node/OS и native target/ownership guards сохраняются. Если artifact передаётся между jobs, прежний manifest/SHA256/BUILD_ID binding остаётся обязательным. Оба publisher jobs напрямую требуют `success` полной unit matrix и native job с cleanup; только push и успех обеих зависимостей допускают публикацию, failure/skipped/cancelled блокируют её. Native files сохраняют последовательное исполнение: общий warehouse state и protected snapshots не допускают неподтверждённого параллелизма.
7. Только сочетание `GITHUB_ACTIONS=true` и `PERO_CI_EXTERNAL_CHECKS=1` допускает сборку без ненужного CI standalone. Полная `.next`, свежие route types, native `next start`, отдельные lint/полный tsc и source/run binding сохраняются. Локальная и production Docker сборки создают прежний standalone.

## Risks / Trade-offs

- Ускорение на cache miss зависит от runner и внешних загрузок → фактическое время фиксируется только по обычным разрешённым CI-прогонам; benchmark не запускается.
- Next не проверяет все test-файлы → полный web `tsc` остаётся отдельным обязательным шагом после build.
- GHA cache может вытеснить слои → отдельные scopes; miss влияет на время, но не на корректность.
- Разработка следующей итерации идёт от принятого staging `567192b4`; прежняя приёмка №169/170 и её receipts сохраняются, новый код требует обычной staging-приёмки.

## Migration Plan

Следующая малая итерация №170 проверяется локально по затронутым конфигурациям и проходит независимый review. Корневой агент выполняет обычную staging-интеграцию и измеряет полный обязательный CI; отдельные benchmark или дополнительные QA-прогоны не создаются. Публикация требует прямого успеха полной unit matrix и native job, fresh source/run binding и `always` cleanup. Main/production и миграции БД в эту задачу не входят.
