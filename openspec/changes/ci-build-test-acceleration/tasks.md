# Tasks

## 10. Перестройка критического пути после CI271 — STAGING ACCEPTED / цель 7.6 OPEN

- [x] 10.1 Удалить scratch metadata export/cache, извлекать полные свежие metadata из immutable never-started runtime projection с прежним однократным OCI proof и cancel-safe owned cleanup.
- [x] 10.2 Передавать ранний exact-ID/hash-bound types artifact также для PR; перенести full tsc/type cache в backend, объединить bounded poll/download для types|bot-dist и сохранить оба publisher gates.
- [x] 10.3 Перекрыть host install/generate Docker через owned deps process GO handshake/status/300с timeout и merge-safe finally/always cleanup.
- [x] 10.4 Перенести целый navigation suite components-1→0, сохранить partition/isolation; отключить только Bake summary/build-record upload.
- [x] 10.5 После freeze выполнить один affected static/guard bundle и независимое review, Root — один итоговый local web без новых QA/files/benchmark.
- [x] 10.6 Root выполняет один ordinary CI и actual staging, фиксирует timing/OCI/DB/W07/GET/cleanup и inclusive code census; цель <180с закрывается только фактическим сопоставимым SUCCESS.

## 1. Независимые изменения CI

- [x] 1.1 Добавить совместимые Next/TypeScript build caches и перенести полный web tsc после свежего production build; проверить порядок и содержимое cache paths по workflow/config diff.
- [x] 1.2 Выключить встроенный повтор lint/types только в GitHub CI с обязательными внешними gates; проверить оба значения флага и отсутствие пропуска в локальной конфигурации.
- [x] 1.3 Разделить существующие suites и build/checks на независимые jobs с обязательным итоговым test gate; проверить сохранённые команды, process isolation и publication needs.
- [x] 1.4 Исправить manifest/source порядок Dockerfiles и раздельные web/bot GHA scopes; проверить Dockerfile/workflow syntax и diff без изменения зависимостей.

## 2. Интеграция принятого №169

- [x] 2.1 Подключить отдельно разрешённую разработческую зависимость feature/169=8a0f0ae обычным merge в feature/170; подтвердить merge commit bd02d42 и сохранённую ancestry, без staging/main.
- [x] 2.2 Передавать native job свежую Next-сборку только текущего run/SHA/Node/OS и кэшировать source-pinned MinIO отдельно; проверить trusted job, pins/digest, текущие run/attempt labels и неизменные guards/tmpfs/cleanup.
- [x] 2.3 Подключить fresh staging №169 ordinary merge в feature/170 и дождаться его реальной staging-приёмки; merge `62ed8e8` содержит `261fab2`, после приёмки подтверждено отсутствие изменений вне №170 в итоговом diff.

## 3. Проверка и передача

- [x] 3.1 После завершения кода один раз выполнить затронутые lint/types/config syntax и строгую валидацию OpenSpec; записать результаты и ограничения без новых QA/benchmark прогонов.
- [x] 3.2 Передать корневому агенту итоговый diff, ожидаемые выигрыши и ограничения; независимый review дал GO, финальное исправление cleanup получило NARROW_GO_170. После локального merge код №170 не менялся; корневой агент дал FINAL_PUBLICATION_GO170. Main/production исключены.
- [x] 3.3 Подтвердить ускорение по обычному обязательному CI и принять реальный staging: CI №248 — 356 с против 789 с №244, 2,22× быстрее, −54,9%; все обязательные gates прошли, точная ревизия/образ/здоровье/DB/W07/GET и удаление временного стенда подтверждены. Root дал FINAL170GOACHIEVED.

## 4. Следующая малая итерация: 180 секунд

- [x] 4.1 Сократить critical path объединением существующих build/checks и native на одном runner без повторной подготовки и передачи artifact, с независимыми unit suites. CI с двумя существующими флагами не создаёт standalone. Сохранить полный набор прежних проверок/suites, full tsc/lint/route types, SHA/run/Node/OS binding, последовательные native files, `always` cleanup и итоговый успех всех обязательных checks независимо от числа jobs; после review измерить полный обычный обязательный CI с целью не более 180 с и принять реальный staging. Отдельные benchmark/QA-прогоны не добавлять; цель подтверждена принятым CI256 **168 с**, `FINAL_GO_170_ACTUAL`, **ACHIEVED_THIS_WARM_RUN**, без гарантии такого времени для каждого запуска/cold cache.

## 5. Повторные Docker checks

- [x] 5.1 Только после успеха полной unit matrix и native пропустить повтор Next inline lint/types в web Docker CI, сохранив свежий standalone; отделить native no-standalone флаг от external-checks режима. Сохранить default local/Docker checks, build-stage-only ARG, полный tsc/lint и все gates; получить review и измерить эффект в следующем обычном обязательном CI без benchmark/нового QA. Actual ce0679/CI257 confirms duplicate-check removal/standalone/all gates; текущие 411 с не достигают180, отдельный общий выигрыш не приписывается новому шагу. Историческая 4.1/warm168 остаётся DONE.

## 6. One OCI build/test/promotion и tested bot — DONE (CI266/61f9)

- [x] 6.1 В existing Docker/config/workflow/runtime собрать один shared Bake DAG full immutable OCI/provenance + no-attest test projection + fresh metadata; проверить config/diff_ids/SHA/run/attempt/BUILD_ID/source binding и испытать именно Alpine runtime без cross-ABI host-copy.
- [x] 6.2 После полного успеха unit matrix/native/main+fault cleanup promote original immutable OCI/referrers pinned regctl без rebuild/early tags; failure/skipped/cancelled блокируют оба publishers.
- [x] 6.3 Backend-tested plain-JS bot dist bound to same SHA/run/attempt/source inputs reuse guarded minimal Alpine named context без второго install/tsc; сохранить обычный Docker fallback, zero runtime deps и .dockerignore env protections/actual bot test exclusion.
- [x] 6.4 После source freeze один affected proof/review/ordinary CI; записать actual time/cache limits/OCI identity/health/DBW07GET/owned cleanup, не закрывать pending по source/config и не запускать benchmark/docs-only CI.

Финальная приёмка: `FINAL_GO_61f9`, staging61f9bc14/CI266 all6SUCCESS; native91/web1441/bot38/watch53/guards2, FAIL/SKIP0, both parallel0/0 и owned cleanup0. Actual OCI/health/GET200/DB/start/volume/W07 подтверждены, source/main/production unchanged. **196 с, ≤180 NOT_MET**; receipt `.playwright-mcp/application-improvements/dead49-delivery-61f9bc14/acceptance.json`.

## 7. Follow-up после CI266 — APPROVED / OPEN

- [x] 7.1 Задать id compiler-cache restore и пропускать extract только при exact primary cache hit; inject, fallback/miss и failure guards сохранить.
- [x] 7.2 Кэшировать Chromium по OS/architecture/установленной Playwright version/lockfile; обязательную установку browser/system dependencies сохранить.
- [x] 7.3 Перераспределить только существующие browser files по CI266 durations без новых jobs, пропусков/повторов и изменения file isolation/default concurrency.
- [x] 7.4 Выполнить локальную read-only OCI/log inventory; prune только по доказанному allowlist, иначе сохранить весь runtime/Prisma CLI/migrations и записать ограничение.
- [x] 7.5 После freeze один affected static check, evidence и передача Root/независимому reviewer без новых tests/benchmarks/CI/DB/infra.
- [ ] 7.6 Следующий ordinary required CI и actual staging подтверждают exact OCI/все gates/cleanup/time; цель180с не закрывается по оценкам или cold/warm предположениям.

CI269/e0ae9a10 принят Root функционально: all6 SUCCESS, 283 с, exact OCI/DB/W07/GET/cleanup сохранены. Временная цель пункта7.6 остаётся OPEN; исторические failed267/268 и warm168 не заменяют её.

## 8. Metadata cache records after CI269 — DONE (CI271; цель 7.6 OPEN)

- [x] 8.1 Только в существующем workflow поставить dedicated metadata cache importer первым и сохранить промежуточные records через mode=max; Dockerfile/BUILD_CONFIG, graph inputs и все checks/guards не менять.
- [x] 8.2 Один affected YAML/Bake static check, source freeze и независимый review; без повторных suites/benchmark/DB/CI со стороны исполнителя.
- [x] 8.3 Root выполнил ordinary required CI и actual staging; metadata materialization/cache/timing, exact OCI, все gates и cleanup зафиксированы в CI271. Измерение завершено, но временная цель 7.6 <180 с не достигнута и остаётся OPEN.

## 9. Tested bot OCI packaging after CI270 — DONE (CI271; цель 7.6 OPEN)

- [x] 9.1 Bounded readiness проверяет current backend producer SUCCESS и exact run/attempt/SHA tested-dist, затем existing native Buildx упаковывает no-push bot OCI; без сериализации native за unit matrix.
- [x] 9.2 Общая OCI proof/promotion обвязка сохраняет truthful web/bot identity, source/config/provenance/digest binding; bot publisher переносит original OCI только после прежних gates. Root ACK включает ровно existing runtime/target.mjs с optional закрытым web|bot kind и прежним web default.
- [x] 9.3 Один affected static check после freeze, независимое review; без новых files/framework/jobs/tests/build/CI/DB/hosts со стороны исполнителя. Получены GO_170_TARGET_BOT_OCI и GO_170_WORKFLOW_BOT_OCI.
- [x] 9.4 Root выполнил обычный required CI/actual staging и зафиксировал bot readiness/packaging/promotion/общий wall time в CI271. Source/runtime приняты; измерение завершено, цель7.6<180с остаётся OPEN.


CI271/484e15b9 принят по [receipt](D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/deep-test-reduction-20261014-45186c70/acceptance-484e15b9.json): все шесть заданий SUCCESS, exact OCI, GET 200, DB/W07 и cleanup подтверждены. Bot readiness 1 с, packaging 4 с, publisher 13 с без второго Buildx; весь CI 299 с (4:59). Пункты 8.3 и 9.4 завершают измерение и приёмку; временная цель 7.6 <180 с остаётся OPEN. Metadata 62 с/414,58 MB сохраняется; подтверждённая минимальная дальнейшая правка не найдена, новых bench/изменений нет. История CI266/269/270 сохранена.

Раздел10 реализован и принят на exact staging812be24e, CI272 all6SUCCESS/360с. Измерение и runtime-приёмка выполнены; **цель7.6<180с НЕ ДОСТИГНУТА**. Первый Dockerfile/BUILD_CONFIG запуск: compilerMISS, freshNext65.6с/materialization42.3с/Bake152с; warmCI не измерялся, rerun/benchmark отсутствует. Точный OCI/DB/W07/GET/cleanup — [receipt](D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements/ci-under180-20261015-4a7156d4/acceptance-812be24e.json). Acceptance tracking сохранён локально для следующего реального code batch, отдельного docs-onlyCI нет.
