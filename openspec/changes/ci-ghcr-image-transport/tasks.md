# Tasks

## 1. Передача проверенного OCI

- [x] 1.1 Реализовать ограниченный metadata handoff и producer upload исходного OCI в GHCR; проверить SHA/run/attempt/kind/config/layers/provenance и отказ на подмене unit-тестами.
- [x] 1.2 Реализовать продвижение remote digest и paired release без layer download/rebuild; проверить команды fake registry и совместимость release packet.
- [x] 1.3 Перевести workflow на handoff artifacts, сохранить PR без registry writes, gates/cache/DAG и сроки хранения; подтвердить scheduling/workflow tests и YAML parsing.

## 2. Жизненный цикл кандидатов

- [x] 2.1 Реализовать полный план очистки кандидатов старше 72 часов, reachability и повторные guards; проверить shared/release/unknown/running/drift/partial inventory тестами без реального удаления.
- [x] 2.2 Добавить отдельный scheduled/manual cleanup с dry-run, package allowlist и журналом точных IDs; проверить workflow guard и отсутствие cleanup на критическом пути выпуска.

## 3. Проверки и передача владельцу

- [x] 3.1 Обновить документацию/verification, выполнить затронутые тесты, синтаксические проверки и openspec validate --strict; проверить сохранность чужих файлов и отсутствие новых зависимостей/миграций.
- [ ] 3.2 После прямого разрешения на commit/staging выполнить обычный CI, зафиксировать размеры handoff, исходные/remote digests, время и реальный staging SHA/health. До этого runtime/скорость не считать принятыми.
