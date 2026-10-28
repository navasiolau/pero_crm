# Design

## Context

См. proposal.md. Docker29/containerd возвращает manifest digest в image.Id и Descriptor.digest; classic store возвращает config digest. Ошибка воспроизведена read-only на Docker29.6.1 и видна в CI29.4.2. Renderer bake exports имеют одинаковые manifest/config, поэтому повтор без изменения проверки не устраняет несовместимость.

## Goals / Non-Goals

**Goals:** точное соответствие immutable OCI и загруженного runtime при обоих stores.
**Non-Goals:** изменение Docker daemon, production watcher, зависимостей, образов базы, средств защиты или business code.

## Decisions

1. Общая pure-проверка требует полные digests, точный runtime ID, платформу и упорядоченные diff IDs. Containerd допускается только с Id=Descriptor.digest=проверенный manifestDigest и известным manifest media type; index как runtime ID не разрешается.
2. В readWebArtifact добавить узкий graphOnly режим только для web без receipt: полный прежний OCI/provenance/labels/hash обход выполняется до metadata, но metadata/BUILD_ID пока не читаются. Обычный режим и строгая проверка финального receipt остаются прежними.
3. Metadata extraction связывает env с проверенным actual image.Id. Renderer smoke, web-template smoke, web и migrations запускаются по нему; guards контейнеров/cleanup сравнивают тот же ID. В OCI receipts configDigest остаётся digest конфигурации, значения не переименовываются и не подменяются runtime ID.

## Risks / Trade-offs

- Разрешить произвольный manifest → проверять descriptor и весь OCI-граф, сохранять отрицательные tests.
- Остался configDigest как Docker run аргумент → проверить все callers; configDigest нужен только для чтения OCI blobs/receipts.
- Преждевременный PASS → фактический CI и staging остаются pending до успешного нового кандидата.
