# Design

## Context

Исходная ветка №170 создана от `origin/staging=e986e290`; там ещё нет runtime №169. Мотивация описана в proposal.md. В установленном Next 15.5.20 встроенная типизация исключает `*.test.*` и `__tests__`, поэтому она не заменяет полный web `tsc`.

Исторический полный private-run №238 занял 887,77 с: приложения 367,60 с, Next 141,93 с, native 232,78 с, включая source build MinIO 209,45 с. Public-run №239 attempt 3 завершился ошибкой старого pixel assertion: 261 с всего, приложения 142,102 с; Next/native не выполнялись. Из этих двух прогонов нельзя выводить полный коэффициент ускорения №170 или приписывать смену runner изменениям кода.

## Goals / Non-Goals

**Goals:** Сократить повторную работу и последовательный critical path существующего CI, сохранив строгие gates, свежие route types и guards №169.

**Non-Goals:** Новый QA framework, дополнительные benchmark-прогоны, локальные HTTP/DB/S3-стенды, смена runner/settings/billing, зависимости/lockfile, main/production.

## Decisions

1. `PERO_CI_EXTERNAL_CHECKS=1` действует только вместе с `GITHUB_ACTIONS=true`. CI lint остаётся обязательным, полный `tsc --noEmit` запускается после production build. `.next/types` и готовая сборка не кэшируются; допускаются `.next/cache` и отдельный совместимый incremental state после проверки его поведения.
2. Next cache имеет ключи ОС, Node, lockfile, build-конфигурации и исходников. Restore fallback ограничен совместимыми зависимостями и конфигурацией; каждый run заново строит Next. Только `.next/cache` входит в архив.
3. В Docker все workspace manifest-файлы предшествуют install, а исходники следуют после install. Root `.dockerignore` исключает только каталоги `apps/web/tests` и `apps/telegram-bot/tests` из production context; CI checkout сохраняет все suites и полный tsc, отдельный MinIO context не меняется. Отдельные scopes web/bot/MinIO предотвращают вытеснение взаимно разных build-графов. Runtime образов не получает CI skip-флаг; самостоятельные Docker build сохраняют проверки.
4. Unit suites уже выполняются штатным `tsx --test` с process isolation, а pnpm запускает независимые workspace scripts. Ручное увеличение concurrency без подтверждённой пользы не требуется. Независимые CI jobs позволяют перекрыть время suites и Next build без объединения процессов тестовых файлов.
5. Для разработки владелец отдельно разрешил normal merge `feature/169=8a0f0ae` в `feature/170`; это не является приёмкой №169 и не переносит его в staging. Принятая зависимость затем приходит обычным merge свежего staging. MinIO Dockerfile собирается Buildx с закреплёнными source/Go pins и отдельным GHA scope. Runtime принимает только текущий локальный image ID с проверенными labels; контейнер получает новые run/attempt labels при каждом запуске. Существующие digest-проверки, tmpfs, guard и `always` cleanup остаются.
6. `native-tests` зависит от успешных unit/build jobs и получает тар-архив свежей `.next` без compiler cache/standalone, плюс `public`. Artifact скачивается только из текущего run; manifest проверяет checkout SHA, repository, run/attempt, точную Node, платформу, архитектуру и ImageOS, SHA256 tar и BUILD_ID. Native повторно не собирает Next и запускает прежний `next start`. Итоговый `test` требует `success` всех трёх jobs, включая native и его cleanup.

## Risks / Trade-offs

- Ускорение на cache miss зависит от runner и внешних загрузок → фактическое время фиксируется только по обычным разрешённым CI-прогонам; benchmark не запускается.
- Next не проверяет все test-файлы → полный web `tsc` остаётся отдельным обязательным шагом после build.
- GHA cache может вытеснить слои → отдельные scopes; miss влияет на время, но не на корректность.
- Непринятый runtime №169 отсутствует в staging → разработческая зависимость подключена только обычным merge в feature/170; staging/main остаются вне этого действия, приёмка и merge свежего staging ожидаются.

## Migration Plan

№170 проверяется локально по затронутым конфигурациям и проходит независимый review. Корневой агент выполняет push и обычную staging-интеграцию после приёмки №169. Публикация сохраняет обязательный gate `test`. Main/production и миграции БД в эту задачу не входят.
