# Tasks

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
