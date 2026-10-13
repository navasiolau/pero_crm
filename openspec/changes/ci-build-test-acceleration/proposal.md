# Proposal

## Why

CI последовательно повторяет lint и часть типизации внутри Next build, каждый раз собирает закреплённый исходный MinIO и теряет Docker-слой зависимостей при изменении исходников workspace-пакетов. Задача №170 сокращает время существующих проверок, сохраняя их объём и условия публикации.

## What Changes

- Кэш `.next/cache` привязан к ОС, Node, lockfile, конфигурации и исходникам; кэш приложения и данные фикстур не сохраняются.
- CI выполняет полный web `tsc` после production build и свежих `.next/types`; отдельный обязательный lint позволяет выключить их повторный запуск внутри Next только в CI.
- Docker устанавливает зависимости после manifest-файлов и до исходников; web, bot и MinIO используют отдельные Buildx GHA cache scopes.
- Production Docker context исключает только каталоги web/bot tests, сохраняя suites и полную типизацию в CI checkout; изменения тестов не инвалидируют Next build layer.
- После принятия №169 его закреплённый MinIO используется через Buildx cache с проверкой исходных pins и текущего владельца запуска до DB/S3 операций.
- Независимые существующие suites и production build могут работать параллельно; process isolation, сценарии и cleanup сохраняются.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `crm-autodeploy`: ускоренные CI-проверки сохраняют полный набор обязательных gates, свежесть генерируемых типов и принадлежность кэша.

## Impact

`.github/workflows/ci-cd.yml`, `apps/web/next.config.ts`, Dockerfiles web/bot и после обычной интеграции принятого №169 — его существующий runtime контейнеров. Версии зависимостей, lockfile, бизнес-логика, рабочие БД и production не меняются. №170 начинается от свежего `origin/staging`; зависимость №169 переносится только обычным merge после её приёмки.
