# Tasks

## 1. Runtime

- [ ] 1.1 Добавить guard repo/run/service/endpoint до соединений; подтвердить pure tests отказа для чужой цели и local 5433.
- [ ] 1.2 Дополнить существующий CI test job PostgreSQL17 и owned pinned MinIO с tmpfs; подтвердить metadata до миграций и reuse имеющейся сборки.
- [ ] 1.3 Завершать owned web и удалять owned MinIO через finally/always; подтвердить отсутствие контейнера/data volume и GitHub post-job удаление PG/network.

## 2. Contract adoption

- [ ] 2.1 Перенести выбранные PostgreSQL контракты на общую синтетическую fixture с protected baseline; подтвердить real-PG cases на CI.
- [ ] 2.2 Перенести HTTP/S3 доступ и замену файлов на настоящие endpoints; подтвердить защищённые записи, точечную очистку и сохранность соседних объектов.
- [ ] 2.3 Зафиксировать case map и итоговый подсчёт тестов/QA, удалить заменённый boilerplate только после GREEN; проверить полноту coverage/adoption-map.md и фактическое сокращение.

## 3. Acceptance

- [x] 3.1 Пройти local type/lint/pure guards и `openspec validate ci-integration-test-runtime --strict`; записать результаты.
- [ ] 3.2 Пройти draft PR CI на точном SHA, записать contracts и удаление стенда; обычным merge принять feature/169 в staging и проверить фактический образ/здоровье. Main/production только по отдельному прямому поручению владельца.

### Локальная проверка — 13.10.2026

Рабочее дерево №169 от `e986e2900f9a7911b4863ec3e6e3ecae3715545a`: собственные зависимости `pnpm install --frozen-lockfile --ignore-scripts`, Prisma Client 6.19.3; версия и lockfile сохранены.
GREEN: web `tsc --noEmit --incremental false`, ESLint всей `tests/integration` и изменённых queue/runtime после исправлений; pure target guard 2/2, включая 17 отрицательных подмен; OpenSpec strict и `git diff --check`.
Подключений к БД/S3/HTTP и локального стенда не было. Реальные CI-контракты, очистка после job и staging ещё NOT_RUN; локальные проверки их не заменяют.
