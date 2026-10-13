# Tasks

## 1. Runtime

- [ ] 1.1 Добавить guard repo/run/service/endpoint до соединений; подтвердить pure tests отказа для чужой цели и local 5433.
- [x] 1.2 Дополнить существующий CI test job PostgreSQL17 и owned pinned MinIO с tmpfs; подтвердить metadata до миграций и reuse имеющейся сборки.
- [x] 1.3 Завершать owned tests/web и удалять owned MinIO-контейнер/образ через finally/always; подтвердить отсутствие контейнера/data volume и GitHub post-job удаление PG/network.

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
При локальной проверке подключений к БД/S3/HTTP и локального стенда не было; локальные проверки не заменяют CI/staging-приёмку.

[CI №237](https://github.com/navasiolau/pero_crm/actions/runs/38378700531/job/115233433714?pr=1), merge `af9cf126`: source MinIO `RELEASE.2025-09-07T16-13-09Z`, commit `07c3a429`, Go 1.24.2, guarded PG/S3 с tmpfs и одна Next-сборка подтверждены. Overall FAILED: 26 PASS / 4 PostgreSQL FAIL, финальная приёмка ожидается. Cleanup finally/always: tests/web liveMembers=0; MinIO containers/images/dataVolumes=0; PG `07191d700549209406b246a1f6424d210a547721b4be2af952cbcdc629411456` и `github_network_2b11e99a9eb243fca1f7e1af80fa8869` удалены в 10:00:15Z. Evidence: ignored `.playwright-mcp/task-169-ci-evidence/ci-237-run-38378700531.zip`, SHA256 `4a2b9467cc55fb95d1a6a3fa8b8c6eeb4f3fe249c05d5676d200342266b53d38`.

[CI №238](https://github.com/navasiolau/pero_crm/actions/runs/38383057470/job/115247989472?pr=1), head `c2084d50`, actual merge `cbb0dc93`: 30 cases — 29 PASS / 1 FAIL / 0 skipped/cancelled. Единственный FAIL: `percentage/adjustments-immutable-cas-replay-and-native-constraints`, «Изделие не найдено» в `queries.ts:22`, вызов `percentage-postgres.test.ts:128`; финальная приёмка остаётся pending. Cleanup finally/always: tests/web liveMembers=0, MinIO containers/images/dataVolumes=0; точные PG и job network удалены штатным `Stop containers` в 10:38:39Z без cleanup warning. Evidence: сохранённый ignored `.playwright-mcp/task-169-ci-evidence/ci-238-run-38383057470.zip`, SHA256 `d5d911cbdfeb66f2e97cd2bda551d9d4262a24c7857400f59f8d7d8b58960123`; исправление входит в следующий общий batch, отдельного CI нет.
