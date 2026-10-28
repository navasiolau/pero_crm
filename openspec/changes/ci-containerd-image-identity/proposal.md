# Proposal

## Why

CI40784784669/afb4c7bc отказал до запуска renderer: Docker29 с containerd возвращает OCI manifest ID вместо config ID. Оба bake export имеют одинаковые manifest/config digests, но прежняя проверка предполагает classic store. Локальное read-only metadata подтверждает новый формат.

## What Changes

- Проверять runtime projection по точному config ID classic store или точному manifest ID containerd с обязательным совпадением слоёв и платформы.
- Связать metadata extraction, smoke, image migrations, запуск и cleanup с проверенным runtime ID.
- Сохранить полный OCI/provenance proof и отрицательные проверки несовпадений.

## Capabilities

### New Capabilities

- `ci-containerd-image-identity`: совместимое подтверждение идентичности OCI и Docker runtime в CI.

### Modified Capabilities

Нет: production watcher и его спецификация crm-autodeploy не меняются.

## Impact

CI-only helpers web/renderer, одно место вызова в workflow и tests. Приложение, зависимости, БД и рабочая инфраструктура не меняются. Задача199/bugfix/199 и реализация отдельно согласованы владельцем29.10.2026; commit согласуется после проверок.
