# Tasks

## 1. Независимые изменения CI

- [x] 1.1 Добавить совместимые Next/TypeScript build caches и перенести полный web tsc после свежего production build; проверить порядок и содержимое cache paths по workflow/config diff.
- [x] 1.2 Выключить встроенный повтор lint/types только в GitHub CI с обязательными внешними gates; проверить оба значения флага и отсутствие пропуска в локальной конфигурации.
- [x] 1.3 Разделить существующие suites и build/checks на независимые jobs с обязательным итоговым test gate; проверить сохранённые команды, process isolation и publication needs.
- [x] 1.4 Исправить manifest/source порядок Dockerfiles и раздельные web/bot GHA scopes; проверить Dockerfile/workflow syntax и diff без изменения зависимостей.

## 2. Интеграция принятого №169

- [x] 2.1 Подключить отдельно разрешённую разработческую зависимость feature/169=8a0f0ae обычным merge в feature/170; подтвердить merge commit bd02d42 и сохранённую ancestry, без staging/main.
- [x] 2.2 Передавать native job свежую Next-сборку только текущего run/SHA/Node/OS и кэшировать source-pinned MinIO отдельно; проверить trusted job, pins/digest, текущие run/attempt labels и неизменные guards/tmpfs/cleanup.
- [ ] 2.3 После приёмки №169 выполнить ordinary merge свежего staging в feature/170; подтвердить, что итоговый diff относительно принятого staging содержит только №170.

## 3. Проверка и передача

- [x] 3.1 После завершения кода один раз выполнить затронутые lint/types/config syntax и строгую валидацию OpenSpec; записать результаты и ограничения без новых QA/benchmark прогонов.
- [ ] 3.2 Передать корневому агенту итоговый diff, ожидаемые выигрыши и ограничения; получить независимый review перед его push/staging merge. Main/production исключены.
