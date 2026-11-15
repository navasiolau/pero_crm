# Проверка №219

Дата: 15.11.2026, Europe/Moscow. Ветка `bugfix/219`; отдельный worktree `D:\Projects\pero_crm_worktrees\actions-storage-219`; исходный свежий staging `6b5742d85ee3fe135cbe6260ab6ff44f035aa324`.

## Согласованный объём

Владелец согласовал план диагностики, затем вариант передачи образов через приватный GHCR и 15.11 поручил реализацию. После локальных проверок прямо разрешены коммит №219, публикация ветки, обычная интеграция и приёмка на staging. Исходный checkout main и два чужих untracked owner-документа сохраняются. Перенос в main не разрешён. Production/БД/миграции/S3/restic/серверная конфигурация не затрагиваются.

## Реализовано

- Original OCI/provenance остаётся в producer и проходит прежние полные validators. После собственных проверок image сохраняется в том же приватном GHCR package под `ci-run-attempt-sha`, с проверкой private/owner до upload и remote digest после него.
- В Actions вместо трёх OCI tar передаётся по одному metadata JSON ≤2 MiB с SHA-256 в producer outputs. Filesystem layers исключены и отдельно запрещены consumer proof.
- Все required gates, существующие caches/DAG/cohorts и source/runtime identity сохранены. PR не выполняют registry шаги. Publisher делает только проверку digest и PUT исходного index для release tags; rebuild/download layers отсутствуют.
- Прежний release packet воспроизведён настоящим CLI `pipeline.mjs release` из двух metadata-only каталогов с fake registry, без Docker/БД/сети.
- Отдельный daily/manual cleanup строит полный список по allowlist, age72h, завершённым run/attempt и graph reachability. Неизвестные/release/shared/running версии защищены. Все exact-ID/run guards проверяются до удаления и повторно непосредственно перед каждым DELETE. Ручной запуск по умолчанию dry-run.

## Локальные проверки

1. `pnpm install --offline --frozen-lockfile`: PASS, зависимости взяты из существующего store; lockfile не изменён.
2. `node --test apps/web/tests/ci-registry-transport.test.mjs apps/web/tests/ci-image-candidates.test.mjs apps/web/tests/ci-scheduling.test.mjs apps/web/tests/integration/runtime/target.test.mjs apps/kp-renderer/test/ci.test.cjs`: **39/39 PASS**, skipped0. Передача всех трёх видов, immutable graph, negative SHA/run/attempt/kind/layer/provenance/private checks, gating, paired packet CLI, cleanup/dry-run/pagination/drift/shared preservation, прежние OCI/runtime/renderer guards.
3. Синтетический filesystem layer1MiB дал handoff web4003B, bot4818B, renderer5863B; web с renderer binding4583B. Это проверка отсутствия зависимости размера пакета от layer, **не измерение production образов**.
4. `actionlint v1.7.12 -shellcheck= -pyflakes= .github/workflows/ci-cd.yml .github/workflows/ci-image-candidates.yml`: PASS. Официальный Windows archive сверён с upstream SHA-256; инструмент размещён во временном каталоге вне проекта, dependencies не менялись.
5. ESLint затронутых JS helpers/tests и pipeline: PASS; Node syntax и Git Bash `bash -n .github/scripts/setup-regctl.sh`: PASS. Для файлов вне web использован существующий eslint wrapper из root; предупреждения Next о pages/React относятся к root-based lint, не к ошибкам кода.
6. `openspec validate ci-ghcr-image-transport --strict` и `git diff --check`: PASS.

## Ограничения фактической приёмки

- Реальная запись/приватность/permissions GHCR, реальные размеры метаданных, scheduled cleanup dry-run, полный CI elapsed и фактический staging SHA/image/health **ещё не проверены**. Fake registry tests и статический DAG этого не заменяют.
- Обычный CI/staging выполняется после прямого указания на commit/staging. Замедление/ускорение и снижение месячного расхода сейчас не заявляются как измеренные.
- Default-branch cleanup активируется только при последующем разрешённом выпуске в main; main сейчас отстаёт от staging также на чужие задачи214–218, которые нельзя выпускать этим поручением автоматически.
- В соседнем `D:\Projects\pero` read-only проверены workflows: обычный release-report JSON хранится30дней; release archive выгружается лишь при failure и opt-in `UPLOAD_ARCHIVE_ON_FAILURE`, срок3дня. Этот репозиторий и публичные сайты не изменялись; фактическое состояние artifacts аккаунта по-прежнему требует отдельной инвентаризации.
- Исторические Actions artifacts и контейнерные versions не удалялись, budgets/платный лимит не менялись. Уже накопленный ноябрьский учёт этим кодом не обнуляется.

## Первый staging CI и исправление

Владелец прямо разрешил commit/push/обычный merge/staging-приёмку. Коммит `d27830e1b59bedf93529e7a75b396a294e48a990` опубликован в `bugfix/219`, merge staging `40a1cce731cd25f1a1b586a37041489ba00e0d72` запустил [CI376](https://github.com/navasiolau/pero_crm/actions/runs/43732602543). Renderer job остановился на `CI_TARGET_REFUSED:registry-private-package`; оба component jobs PASS, native/backend/release jobs SKIPPED, выпускные теги не менялись.

Read-only package API подтвердил: `pero_crm`/`pero_telegram_bot` private, прежний `pero_kp_renderer` public. Коррекция сохраняет public release package и создаёт отдельный private `pero_kp_renderer_ci`. До handoff проверяется private/owner, а publisher выполняет только GHCR cross-repository mounts и PUT исходных manifests; при отказе mount GET/PUT filesystem layers запрещены. Renderer готовится до web discovery tag. Очистка исключает public release package.

Мониторинг CI переведён на существующий `GITHUB_ACTIONS_READ_TOKEN` из ignored root.env, без чтения/печати значения в чате/отчётах. Доступ к status/jobs/logs/artifacts через API подтверждён. Прежний заход в браузер был лишним; дальнейшая приёмка использует API.

Коррекция прошла **41/41** профильных tests (включая отказ mount без layer GET, private bootstrap с повторным чтением и порядок renderer→web), ESLint/actionlint/OpenSpec/diff checks. Служебный `pero_kp_renderer_ci` входит в cleanup allowlist вместо публичного renderer package.

## Следующий этап

После разрешения владельца: commit №219 → обычный merge/push staging → штатный CI и metadata/digest/time evidence → фактический staging revision/health. Перенос всего принятого staging в main — отдельное прямое указание. Обновить этот файл фактическими SHA/run/размерами/временем; до этого пункт3.2 остаётся открытым.
