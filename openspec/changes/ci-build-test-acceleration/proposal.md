# Proposal

## Узкое исправление регрессии CI273 — APPROVED / OPEN

Реальный CI273 выявил повторную установку node_modules перед Prisma/Next после перехода install на /pnpm-store. Разрешено привести store path последующих pnpm команд к тому же значению через поддерживаемый pnpm11 build-stage ENV, сохранив install layer, runtime suffix, проверки зависимостей и все gates. Исправление требует одного ordinaryCI с проверкой отсутствия повторного install; CI273428с не выдаётся за ускорение, размер dependency layer/store savings NOT_MEASURED.

## Слои и compiler compatibility после CI272 — APPROVED / OPEN

Владелец разрешил следующую малую итерацию №170: принятый CI272/staging812be24e завершился за360с, цель<180с остаётся OPEN. Compiler key v2 учитывает нормализованный Dockerfile только до единственной границы `FROM base AS runner`, отдельный config hash, реальный base digest, linux/amd64 и действующие CI flags; runtime-only Docker изменения больше не сбрасывают compiler cache. Frozen filtered pnpm install использует cache mount store с copy import, оставляя node_modules в образе. Test projection и MinIO загружаются Docker exporter непосредственно в Engine; промежуточные runtime tar/load удаляются, исходный OCI/provenance и полный proof/gates/cleanup сохраняются. Экономия размера/времени не заявляется до единственного обычного CI; первый v2 MISS допустим, прогрев и benchmark запрещены.

## Ускорение после CI271 — APPROVED / OPEN

Владелец утвердил продолжение №169/170 от принятого `484e15b9`: CI271 299 с, цель полного CI <180 с OPEN. Убирается scratch metadata export и его тяжёлая материализация builder: полные `.next/types` входят в тот же standalone RUN, metadata извлекается из проверенной незапущенной runtime projection. Полный tsc переходит в existing backend через ранний hash-bound artifact; Native выполняет прежние интеграции параллельно и ждёт целиком успешный backend перед bot packaging. Host install/generate перекрывает Docker через existing owned-process cleanup. Сохраняются все gates/сценарии/OCI proof, Prisma CLI и миграции; меняются только группировка одного browser файла и необязательные build-history artifacts. Никаких новых jobs/files/framework/стендов, main/production. Один итоговый local web, независимое review и один ordinary CI; cold и warm результаты различаются, повтор ради прогрева запрещён.

## Why

CI последовательно повторяет lint и часть типизации внутри Next build, каждый раз собирает закреплённый исходный MinIO и теряет Docker-слой зависимостей при изменении исходников workspace-пакетов. Задача №170 сокращает время существующих проверок, сохраняя их объём и условия публикации. После прежней приёмки владелец разрешил следующую малую итерацию с измеряемой целью обычного обязательного CI не более 180 секунд; достижение подтверждается фактическим run, а не обещается для cold cache.

## What Changes

- Кэш `.next/cache` привязан к ОС, Node, lockfile, конфигурации и исходникам; кэш приложения и данные фикстур не сохраняются.
- CI выполняет полный web `tsc` после production build и свежих `.next/types`; отдельный обязательный lint позволяет выключить их повторный запуск внутри Next только в CI.
- Docker устанавливает зависимости после manifest-файлов и до исходников; web, bot и MinIO используют отдельные Buildx GHA cache scopes.
- Production Docker context исключает только каталоги web/bot tests, сохраняя suites и полную типизацию в CI checkout; изменения тестов не инвалидируют Next build layer.
- После принятия №169 его закреплённый MinIO используется через Buildx cache с проверкой исходных pins и текущего владельца запуска до DB/S3 операций.
- Независимые существующие suites и production build могут работать параллельно; process isolation, сценарии и cleanup сохраняются.
- CI объединяет существующие build/checks и native на одном runner: native использует только что собранную `.next` без повторной подготовки и передачи artifact, перекрывая время независимых unit suites. Отдельный `PERO_CI_NATIVE_BUILD=1` вместе с внешними CI checks отключает standalone только для native build; Docker CI после успеха полной unit matrix/native пропускает лишь повторные встроенные Next lint/types и сохраняет standalone. Полная `.next`, route types, `next start` и все обязательные checks сохраняются; обычная local/Docker сборка выполняет встроенные проверки.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `crm-autodeploy`: ускоренные CI-проверки сохраняют полный набор обязательных gates, свежесть генерируемых типов и принадлежность кэша.

## Impact

`.github/workflows/ci-cd.yml`, `apps/web/next.config.ts`, Dockerfiles web/bot и после обычной интеграции принятого №169 — его существующий runtime контейнеров. Версии зависимостей, lockfile, бизнес-логика, рабочие БД и production не меняются. №170 начинается от свежего `origin/staging`; зависимость №169 переносится только обычным merge после её приёмки.

## Tested bot OCI packaging after CI270 — APPROVED / OPEN

Root разрешил убрать повторную подготовку Buildx в bot publisher: CI270 прошёл за378с, из143с setup141,5с занял pull `moby/buildkit:buildx-stable-1`. Bot OCI упаковывается без push существующим native Buildx; прежний bot publisher после всех gates только проверяет и переносит исходный immutable OCI/provenance. До упаковки обязательны bounded readiness, SUCCESS backend producer и exact tested-dist текущего run/SHA/attempt; native не ставится за всей unit matrix. Registry write/credentials остаются только в gated publishers, новые jobs/files/framework/стенды не вводятся. Root отдельно включил существующий `apps/web/tests/integration/runtime/target.mjs` в allowlist: закрытый optional kind web|bot, неизменный web default и общий строгий OCI verifier; ложные web labels/.next metadata и второй validator не допускаются. Цель180 OPEN.

## Metadata cache follow-up after CI269 — APPROVED / OPEN

Владелец разрешил следующий workflow-only шаг от принятого `e0ae9a10`: CI269 прошёл все шесть jobs за 283 с, поэтому цель менее 180 с остаётся OPEN. В существующем Bake log metadata vertex `#52` занял 53,2 с на загрузку/распаковку builder layers, включая 414,58 MB, хотя три финальных metadata COPY были CACHED.

Только metadata target сначала импортирует собственный `pero-web-metadata`, затем прежний production fallback; его exporter сохраняет `mode=max` для промежуточных cache records. Dockerfiles, BUILD_CONFIG, build inputs, свежие types/BUILD_ID/action manifest, immutable OCI/provenance, полный tsc/lint, все suites/gates и cleanup сохраняются. Результат измеряется следующим обычным required CI после независимого review; новых jobs/helpers/checkers/benchmark/стендов и гарантии экономии 53,2 с нет.

## Следующий single-build/test/promotion scope — ACCEPTED CI266 / 61f9bc14

Принятый CI266196с подтверждает all6SUCCESS/native91/web1441/bot38/watcher53/guards2, оба parallel exit codes0, exact tested/promoted/deployed OCI и owned cleanup. Цель180с остаётся OPEN; прежний scope принят функционально.

Follow-up одобрен владельцем: пропуск повторного compiler-cache extract только на exact primary hit с сохранением inject/failure guards; Chromium binaries cache по OS/architecture/установленной pinned Playwright version/lockfile с обязательной установкой системных зависимостей; балансировка существующих browser files по CI266 durations без новых jobs/потери cases/смены isolation. OCI/log inventory выполняется только read-only; runtime pruning допускается лишь по доказанному allowlist, иначе runtime сохраняется. Prisma CLI/migrations/API/provenance/same-image publish обязательны; новый результат измеряется одним обычным CI, без benchmark/DB/infra/main/production.

Одно shared Buildx Bake DAG выпускает полный immutable OCI runner с provenance max, Docker test projection без attestations и scratch fresh-build metadata. Проверяются actual runtime image config/diff_ids, revision/BUILD_ID и source inputs; полный OCI bindится к SHA/repository/run/attempt и публикуется после всех required gates без rebuild/early tags, с сохранением attestations/referrers. Backend уже проверяет plain-JS bot dist без runtime deps; тот же bound artifact передаётся минимальным named context в Alpine packaging, без второго tsc/install. Default local Docker fallback/checks и все env exclusions сохраняются, .dockerignore исправляет только actual bot/test path. Никаких app/schema/deps/version/framework/runner/новых repo files и дополнительного benchmark.
