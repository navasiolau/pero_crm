# Проверка №219

Дата: 15.11.2026, Europe/Moscow. Ветка `bugfix/219`; отдельный worktree `D:\Projects\pero_crm_worktrees\actions-storage-219`; исходный свежий staging `6b5742d85ee3fe135cbe6260ab6ff44f035aa324`.

## Согласованный объём

Владелец согласовал план диагностики, затем вариант передачи образов через приватный GHCR и 15.11 поручил реализацию. После локальных проверок прямо разрешены коммит №219, публикация ветки, обычная интеграция и приёмка на staging. Исходный checkout main и два чужих untracked owner-документа сохраняются. Перенос в main не разрешён. Production/БД/миграции/S3/restic/серверная конфигурация не затрагиваются.

## Реализовано

- Original OCI/provenance остаётся в producer и проходит прежние полные validators. После собственных проверок image сохраняется в приватном GHCR package под `ci-run-attempt-sha`; для renderer используется отдельный `pero_kp_renderer_ci`, прежний public release package не меняет видимость. Проверяются private/owner и remote digest.
- В Actions вместо трёх OCI tar передаётся по одному metadata JSON ≤2 MiB с SHA-256 в producer outputs. Filesystem layers исключены и отдельно запрещены consumer proof.
- Все required gates, существующие caches/DAG/cohorts и source/runtime identity сохранены. PR не выполняют registry шаги. Publisher проверяет digest и передаёт только metadata manifests; renderer blobs монтируются внутри GHCR до изменения web discovery tag. Rebuild/download filesystem layers отсутствуют.
- Прежний release packet воспроизведён настоящим CLI `pipeline.mjs release` из двух metadata-only каталогов с fake registry, без Docker/БД/сети.
- Отдельный daily/manual cleanup строит полный список по allowlist, age72h, завершённым run/attempt и graph reachability. Неизвестные/release/shared/running версии защищены. Все exact-ID/run guards проверяются до удаления и повторно непосредственно перед каждым DELETE. Ручной запуск по умолчанию dry-run.

## Локальные проверки

1. `pnpm install --offline --frozen-lockfile`: PASS, зависимости взяты из существующего store; lockfile не изменён.
2. `node --test apps/web/tests/ci-registry-transport.test.mjs apps/web/tests/ci-image-candidates.test.mjs apps/web/tests/ci-scheduling.test.mjs apps/web/tests/integration/runtime/target.test.mjs apps/kp-renderer/test/ci.test.cjs`: финальные **41/41 PASS**, skipped0. Передача всех трёх видов, immutable graph, negative SHA/run/attempt/kind/layer/provenance/private checks, private bootstrap/mount refusal, gating, paired packet CLI, cleanup/dry-run/pagination/drift/shared preservation, прежние OCI/runtime/renderer guards.
3. Синтетический filesystem layer1MiB дал handoff web4003B, bot4818B, renderer5863B; web с renderer binding4583B. Это проверка отсутствия зависимости размера пакета от layer, **не измерение production образов**.
4. `actionlint v1.7.12 -shellcheck= -pyflakes= .github/workflows/ci-cd.yml .github/workflows/ci-image-candidates.yml`: PASS. Официальный Windows archive сверён с upstream SHA-256; инструмент размещён во временном каталоге вне проекта, dependencies не менялись.
5. ESLint затронутых JS helpers/tests и pipeline: PASS; Node syntax и Git Bash `bash -n .github/scripts/setup-regctl.sh`: PASS. Для файлов вне web использован существующий eslint wrapper из root; предупреждения Next о pages/React относятся к root-based lint, не к ошибкам кода.
6. `openspec validate ci-ghcr-image-transport --strict` и `git diff --check`: PASS.

## Фактическая staging-приёмка

Приняты исходные изменения коммита `6f375ecd`, обычный merge staging `5276d9e86295fa84139b06b188b93388153f8e91` и [CI377](https://github.com/navasiolau/pero_crm/actions/runs/43734342304): **7/7 jobs SUCCESS**. Штатный watcher самостоятельно развернул web/renderer этой ревизии. Оба healthy, внутренний `/api/health`200. Внешний HTTPS сохраняет Basic boundary401 с действительным TLS; обход авторизации не выполнялся.

| Метрика | CI375 до изменения | CI377 |
|---|---:|---:|
| Все artifacts, bytes | 572373730 | 893467 |
| Полный elapsed от run start до последнего job | 548с (9:08) | 377с (6:17) |
| Размер renderer image artifact | 299169252 | metadata ZIP27901 |
| Размер web image artifact | 210897597 | metadata ZIP27686 |
| Размер bot image artifact | 61486903 | metadata ZIP17903 |

Сокращение artifacts **99,8439% / 640,62 раза**. Raw metadata JSON: renderer101888B, web118616B, bot47156B; каждый существенно ниже2MiB. Архивные SHA GitHub API сверены со скачанными ZIP, затем проверены SHA handoff; run/attempt/revision/index совпадают с успешным producer и promotion logs. В обычном принятом прогоне замедления нет; разница длительностей также зависит от кэшей/runner и не является обещанием постоянного выигрыша171с.

Registry promotion сохранил исходные indexes/provenance. Независимо проверены `image.Descriptor`, ordered diff IDs и SHA projection полей image.Config (User/WorkingDir/Entrypoint/Cmd/Env/Labels) относительно исходного OCI config. Remote pull Docker/containerd хранит image.Id как OCI index, тогда как native Docker export испытывается по manifest: эти два пути различены, native validators не изменялись. Web label связывает именно принятый renderer index. Public renderer package сохранился public, CI renderer package private; web/бот private.

DB ID `27b8f734…`, image, StartedAt и mounts совпали с before; proxy ID/образ/StartedAt и mounts также сохранены. Mounts web uploads и renderer spool не менялись. Никаких прямых SQL, DB test writes, server configuration changes или ручного запуска watcher не было. Полный безопасный receipt — [staging-acceptance.json](staging-acceptance.json); подробные API/SSH snapshots и metadata-only handoffs находятся в ignored `.playwright-mcp/task219/`.

## Ограничения и следующий выпуск

- Scheduled cleanup dry-run на default branch ещё не выполнялся: workflow пока опубликован только в staging. Pure dry-run/guard/pagination/drift/reachability tests проходят; запуск на main относится к будущему отдельно разрешённому выпуску.
- Default-branch cleanup активируется только при последующем разрешённом выпуске в main; main сейчас отстаёт от staging также на чужие задачи214–218, которые нельзя выпускать этим поручением автоматически.
- В соседнем `D:\Projects\pero` read-only проверены workflows: обычный release-report JSON хранится30дней; release archive выгружается лишь при failure и opt-in `UPLOAD_ARCHIVE_ON_FAILURE`, срок3дня. Этот репозиторий и публичные сайты не изменялись; фактическое состояние artifacts аккаунта по-прежнему требует отдельной инвентаризации.
- Исторические Actions artifacts и контейнерные versions не удалялись, budgets/платный лимит не менялись. Уже накопленный ноябрьский учёт этим кодом не обнуляется.

## Первый staging CI и исправление

Владелец прямо разрешил commit/push/обычный merge/staging-приёмку. Коммит `d27830e1b59bedf93529e7a75b396a294e48a990` опубликован в `bugfix/219`, merge staging `40a1cce731cd25f1a1b586a37041489ba00e0d72` запустил [CI376](https://github.com/navasiolau/pero_crm/actions/runs/43732602543). Renderer job остановился на `CI_TARGET_REFUSED:registry-private-package`; оба component jobs PASS, native/backend/release jobs SKIPPED, выпускные теги не менялись.

Read-only package API подтвердил: `pero_crm`/`pero_telegram_bot` private, прежний `pero_kp_renderer` public. Коррекция сохраняет public release package и создаёт отдельный private `pero_kp_renderer_ci`. До handoff проверяется private/owner, а publisher выполняет только GHCR cross-repository mounts и PUT исходных manifests; при отказе mount GET/PUT filesystem layers запрещены. Renderer готовится до web discovery tag. Очистка исключает public release package.

Мониторинг CI переведён на существующий `GITHUB_ACTIONS_READ_TOKEN` из ignored root.env, без чтения/печати значения в чате/отчётах. Доступ к status/jobs/logs/artifacts через API подтверждён. Прежний заход в браузер был лишним; дальнейшая приёмка использует API.

Коррекция прошла **41/41** профильных tests (включая отказ mount без layer GET, private bootstrap с повторным чтением и порядок renderer→web), ESLint/actionlint/OpenSpec/diff checks. Служебный `pero_kp_renderer_ci` входит в cleanup allowlist вместо публичного renderer package.

## Следующий этап

Разрешённые commit/push/обычный merge и staging-приёмка выполнены; пункт3.2 закрыт по фактическому CI377 и runtime5276d9e8. Документальное закрепление этой приёмки публикуется обычным merge с повторным штатным CI и проверкой итоговой ревизии. Перенос всего принятого staging в main остаётся отдельным прямым указанием владельца.
