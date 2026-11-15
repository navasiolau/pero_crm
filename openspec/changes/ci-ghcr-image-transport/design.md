# Design

## Context

См. proposal.md. Полные `readWebArtifact`/`readRendererArtifact` уже проверяют каждый локальный blob, provenance, config/diff IDs, receipt и SHA архива. Producers используют Linux hosted runners, publisher jobs прямо зависят от всех required jobs. Source identity/metadata helpers и paired release требуют сохранить принадлежность run/attempt/revision. Существующее требование «без ранних tags» уточняется только для уникального служебного `ci-*`: выпускные теги остаются за всеми gates.

## Goals / Non-Goals

**Goals:** исключить image layers из квоты Actions, сохранить исходный OCI и весь общий gate, не добавлять последовательные сборки/скачивание layers, ограничить жизненный цикл новых служебных кандидатов.

**Non-Goals:** менять версии инструментов, схему БД, watchers или production; удалять исторические artifacts без списка; менять публичные сайты. Другие репозитории сначала проверяются read-only: изменение их собственного CI при необходимости оформляется отдельной атомарной задачей.

## Decisions

1. После собственных тестов producer повторно использует прежний полный validator и переносит original OCI layout в тот же приватный пакет GHCR под `ci-run-attempt-sha`, проверяя remote index digest. Для PR этот шаг отсутствует. `regctl` остаётся v0.11.6 с прежним pinned SHA256. `GITHUB_TOKEN` используется только с permissions соответствующего job; новые PAT/secrets не создаются.
2. Один metadata handoff JSON ≤2 MiB содержит исходный receipt и полный граф OCI metadata (indexes, manifests, configs и attestation payloads), но ни одного filesystem layer. Его SHA-256 передаётся через outputs успешного producer. Consumer отдельно проверяет размер/hash/identity, каждый metadata blob и соответствие config/layers/attestations receipt. Прежние полные runtime validators не получают режима пропуска layers и не ослабляются.
3. Publisher после общего gate читает handoff, проверяет registry digest и назначает теги в том же registry repository, без скачивания images на runner. `pairedRelease` получает те же проверенные records/config из handoff; release packet сохраняет прежний формат. Это заменяет upload/download tar и повторную полную OCI-проверку в publisher; сборочные DAG/cache/parallelism не меняются.
4. Метаданные хранятся 1 день, маленький release packet — прежние 30 дней. Полные образы PR не выгружаются. Ограничение handoff предотвращает случайное возвращение больших artifacts.
5. Отдельный scheduled/manual cleanup workflow использует package allowlist и 72-часовой запас. Сначала получает все GHCR versions, классифицирует root tags, проверяет завершённые CI runs и рассчитывает graph reachability. Только доказанные candidate roots и их собственные незащищённые descendants входят в план; неизвестные orphan сохраняются. Полная предварительная проверка плана и повторная проверка каждого version/run защищают от drift. Режим dry-run доступен; удалений по broad patterns нет.
6. Уже накопленное месячное использование не обнуляется этим изменением. Проверка скорости — обычный разрешённый CI на staging с сопоставлением до/после; отдельные benchmark/DB QA не создаются. До такой приёмки доказано только отсутствие крупных upload и сохранение DAG.

## Risks / Trade-offs

- [Metadata подменены] → независимый job output SHA-256, исходный digest и полный metadata graph; отрицательные тесты на identity/hash/graph/layers.
- [Служебный тег ошибочно развёрнут] → watchers используют только прежние release tags, publisher требует все success; PR не пишет в GHCR.
- [Очистка задела выпуск или shared child] → все неизвестные/выпускные tags и их достижимые manifests защищены, полностью собранный план, точные version IDs и повторные guards.
- [GHCR недоступен/нет прав удаления] → CI/cleanup явным образом падает; fallback в Actions tar или расширение scopes отсутствует.
- [Различие длительности из-за сети/кэша] → измерение и staging acceptance остаются обязательными; обещание скорости до измерения не даётся.

## Migration Plan

Pure helper/protocol/workflow tests и проверка OpenSpec локально. Затем по разрешению владельца commit и обычная интеграция в staging, штатный CI с контролем original digests, размеров artifacts, времени и фактической ревизии/health. Main получает весь принятый staging только по прямому указанию владельца. Откат — обычный новый коммит workflow/helper, без сброса истории и изменений данных. Cleanup включается только с этим кодом на default branch; для первого запуска доступен dry-run.
