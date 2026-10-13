# Proposal

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
