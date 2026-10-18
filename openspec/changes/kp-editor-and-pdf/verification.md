# Проверка №184

Дата: 18.10.2026. Ветка `feature/184`, исходный staging `d918ab860ec5aab029c466a3b3c3b1ce06f0ec98`. Код не коммитился, не отправлялся и не разворачивался. Раздел по умолчанию выключен. Рабочие БД, S3 и инфраструктура в этой задаче не изменялись; контейнеры и новые стенды не запускались.

## Исходник и совместимость

Выбранные 12 файлов перенесены из текущего `D:/Projects/pero_kp`, включая локальные доработки договора. Повторная проверка SHA каждого исходного файла дала `files=12, drift=[]`; источник оставлен без изменений. `source-manifest.json` фиксирует именно прочитанные рабочие байты, а не только Git commit. Печатные CSS, ContractModel, `furniture.docx`, contractors и генератор DOCX сохранены. Изменение SheetRender ограничено переносом `crmKind` при normalizeState, без изменения расчётов и HTML печати. Проверен исходный результат `100.75 × 0.9 = 90.68`.

22 локальных WOFF2 и font-face CSS закреплены контрольными суммами и лицензиями. Сохранены только заявленные исходником веса Manrope 200/300/400/600/700, JetBrains Mono 400/500/700, Spectral 500/600. Сборка/печать не загружает шрифты из сети.

Текущая идентичность шаблона:

| Поле | SHA-256 |
|---|---|
| templateHash | `3dbe1a6836471812476971fff264d8257393b21e37c653ac5e3d9570e64fbefd` |
| sourceManifestHash | `cc35ac24621412e902f563d92037b52952862fd2cf03938c17ffad10c3b7bece` |
| fontManifestHash | `29bddee77fb1f17b0dababea1afcce3493d7381a1510a03d75e179bea10bea59` |

## Команды и результаты

Команды выполнены из `D:/Projects/pero_crm_worktrees/kp-184`:

- `pnpm install --frozen-lockfile --ignore-scripts --prefer-offline`: exit 0, lockfile актуален, pnpm 11.10.0; прежние версии зависимостей не заменялись.
- `pnpm --filter @pero/kp-template test`: 14/14. Сохранение перед PDF, потерянный ACK и точный повтор тела/UUID, новая операция после известного FAILED, сохранение UUID после неизвестного исхода, независимый фокус основного КП при загрузке дополнительного, client sidecar со структурированными реквизитами, приватные media scopes после перезагрузки, фиксированный курс, список из 101 КП с cursor и архивными номерами/клиентами, восстановление версии с прежним UUID.
- RED→GREEN: новый тест `lost contract-settings ACK ...` сначала упал с `6 !== 7` — повтор подтверждал старые настройки, но терял более новую правку. Исправление сначала получает прежний receipt, затем сохраняет новую форму с подтверждёнными revision/clientBaseline; тест и все 14 тестов проходят.
- `pnpm --filter @pero/kp-renderer test`: итоговые12/12. Закрытый HTTP/secret, очередь один активный + четыре ожидающих, ограничения ресурсов/форматов/URL/templateHash, настоящий дочерний процесс завершается по укороченному дедлайну, OCI/pair/ownership guards и1000/1001 DOCX pages. Настоящий изолированный DOCX worker даёт те же XML/styles/media и все ZIP entries, что исходный генератор.
- `pnpm --filter @pero/web exec tsx --test tests/kp-editor-access.test.ts tests/kp-renderer-client.test.ts tests/kp-editor-component.test.mjs`: 12/12. Фактические Next handlers frame/assets проверены с управляемыми auth/Prisma boundaries; браузер исполняет перенесённые HTML/CSS/JS и реальный React parent/ClientDialog.
- После последнего изменения исторического просмотра: `pnpm --filter @pero/web exec tsx --test --test-name-pattern='actual React client|locked editor|archived contract' tests/kp-editor-component.test.mjs`: 3/3. Договор остаётся редактируемым у заблокированного текущего КП, история доступна архиву; просмотр исторического КП предлагает вернуться к текущей редакции для нового договора. Восстановление снова открывает эти операции.
- `pnpm --filter @pero/web exec tsc --noEmit --incremental false`: exit 0.
- `pnpm --filter @pero/web exec eslint src/lib/kp-editor-access.ts src/lib/kp-session-client.ts src/lib/nav.ts src/server/kp src/app/kp 'src/app/(app)/kp' 'src/app/(app)/layout.tsx' src/components/app-shell.tsx src/components/app-sidebar.tsx src/components/client-dialog.tsx tests/kp-editor-access.test.ts tests/kp-renderer-client.test.ts tests/kp-editor-component.test.mjs next.config.ts`: exit 0.
- Ранее затронутые общие UI-проверки: product-return-navigation-ui + task-reward-workspace 28/28; client-passport-read/details/component 11/11. Повторный запуск без изменений этих модулей не требовался.
- `git diff --check`: exit 0; только информационные предупреждения CRLF.
- `docker compose -f deploy/docker-compose.server.yml -f deploy/docker-compose.kp.yml --profile kp config --no-interpolate --no-env-resolution --format json`: exit 0, проверка подготовленной конфигурации без подключения к daemon. Профиль `kp`, read_only=true, память1536m, pids128, публикации портов нет, прежние backend/frontend сети web сохранены, сеть renderer internal=true. Значения env/секретов не выводились.

## Визуальная проверка

Исходный SheetRender загружен из отдельного неизменного fixture, его SHA проверен против source-manifest. Контрольный снимок содержит четыре изделия с количеством >1, длинным описанием, двумя изображениями, скидкой и явной разбивкой услуг.

У всех четырёх страниц исходного/перенесённого PDF совпали raw pixels после Poppler. Свежий bundle в одном изолированном Chromium page/context создал PDF при DPR1, затем исходные screenshots DPR2; raw pixels всех четырёх PNG совпали с отдельным оригинальным screenshot path. Проверена растеризация сохранённого PDF в том же порядке. После этого все четыре страницы PNG просмотрены визуально: обрезки/наложения и пропавшие элементы не обнаружены. Исходный/новый редакторы проверены при ширине1440 и390: компоновка, оси прокрутки и DOM печати совпадают; проверены оригинальная форма договора, история, замена клиента с паспортными данными, ручной курс и восстановление.

Фактический локальный движок: Chromium `153.0.8010.12`, Puppeteer `24.43.1`, диагностический существующий browser override. Это сравнение одинаковых шаблонов на одном движке; оно не заменяет проверку упакованного Chromium141.

Артефакты последнего полного прогона (ignored): `D:/Projects/pero_crm_worktrees/kp-184/apps/web/test-results/kp-editor/0273b83d-988c-498e-972e-fb3b8f57e123/`: `original.pdf`, `ported.pdf`, `page-1..4.png`, `appendix-1..4.png`, desktop/mobile screenshots и `receipt.json` (`allPagesIdentical=true`, `originalDpr2AppendicesIdentical=true`, `pages=4`, `container=NOT_RUN`, `staging=NOT_RUN`). Визуально прочитаны также идентичные страницы предыдущего полного прогона `b43cd160-8f0c-492d-8e39-5978dfaf08d6`.

## Оставшиеся обязательные gates

Session backend браузерного harness синтетический. Последующий CI294 подтвердил Linux OCI Chromium141, native CI и публикацию образов (точные receipts ниже); они не заменяют реальную API/UI/private-host приёмку после интеграции185–189. KP остаётся OFF, приватный renderer на staging host ещё не установлен. Покомпонентная точность DOCX подтверждена исходным generator/ZIP entries; визуальный рендер всех страниц DOCX в Word/LibreOffice и договор из нескольких реальных КП остаются сквозной приёмкой186/189.

№184 предоставляет закрытые страницы/адаптеры и приватные render ports, но не публикует выпуски и не делает переходы проектов. Эти действия выполняют185–187 после чтения сохранённой ревизии и серверной проверки прав/этапа. Раздел должен оставаться выключенным до завершения4.3.

## Дополнение: OCI pipeline и общий DOCX budget

По follow-up владельца реализован код полного pipeline в существующем `.github/workflows/ci-cd.yml`:

1. `kp-renderer-tests`: `node apps/kp-renderer/ci/pipeline.mjs prepare` разрешает Node22 Debian base в digest и задаёт labels SHA/run/attempt/service/source/font/template/Chromium/Puppeteer. Закреплённый существующий docker/bake-action строит `renderer-oci,renderer-runtime` одним graph, без публикации. `pipeline.mjs test` проверяет все SHA OCI descriptors/blobs и provenance, config/layers точной runtime projection, затем запускает её по config digest с network=none/read-only/1536 MiB/CPU1/PID128/tmpfs512 MiB. Cleanup проверяет точный созданный ID, image, labels и ограничения до удаления.
2. Внутри образа `ci/smoke.cjs` проверяет фактический Chromium141, исходный SheetRender SHA и все шрифты; настоящий закрытый HTTP выдаёт PDF/bundle/retained PNG/DOCX из двух КП. Все PDF/PNG страницы и DOCX ZIP entries сравниваются с исходником. Проверены unauth отказ и guards1000/1001 PNG-страниц. OCI/receipt upload выполняется только после успеха smoke; job outputs содержат проверенные archive/index SHA.
3. `build-push` и `build-push-bot` теперь зависят от success unit matrix/native-tests/kp-renderer-tests. Существующий pinned regctl публикует именно проверенный renderer OCI index с attestations без rebuild, проверяет digest registry и сохраняет promotion receipt.
4. Native web build зависит от испытанного renderer и записывает его exact index digest в OCI label. После продвижения обоих образов `pipeline.mjs release` проверяет bindings/SHA/run/attempt/receipts, выдаёт CI artifact `kp-release-<run>-<attempt>-<SHA>` с `release.json`, `kp-images.env`, `kp-images.override.json`, `docker-compose.kp.yml`. Это аудируемая immutable пара, флаг/секреты не включаются.
5. `deploy/watch-crm.py` сохраняет штатный auto GitFlow: KP off оставляет прежние команды; KP on добавляет профиль под прежними W07/lock, использует branch tag только как discovery, проверяет exact digest + protocol/revision/run/attempt/source/font/template и anti-drift до up. Временный собственный override обновляет только web/renderer через digest refs, без pull/build/dependencies. Частичная публикация не меняет services; health failure возвращает оба старых local image ID. Первая неудачная активация восстанавливает web и удаляет только собственный новый private renderer без постоянных mounts. Rollback45s + postcheck15s зарезервированы в прежнем200-секундном лимите. W07 controller/entrypoints/расписания не изменялись, постоянный pin не вводится.

Локальные новые результаты: renderer12/12 (OCI blob/label/projection tampering, smoke version/results, paired release revision/promoted digest, cleanup ownership/bounds и DOCX1000/1001), web-client3/3; YAML parser подтвердил graph dependencies и anchors. `node --check` всех трёх CI modules, TypeScript, ESLint и diff-check проходят. Эти проверки не запускали Docker или CI/cloud; фактическое исполнение нового Linux141 job и registry promotion ещё ожидается после разрешённого push/обычного merge.

Лимиты согласованы между184/186/187 через экспорт `KP_RENDER_LIMITS` из общего пакета: DOCX1000 страниц/1000 источников, PNG16 MiB/128 MiB суммарно, JSON192 MiB/output128 MiB/metadata4 MiB; retained PDF32 MiB/1000 страниц, PNG16 MiB/64 MiB суммарно. Source PDF/bundle по-прежнему64 страницы, изображение12 MiB, общий64 MiB и JSON96 MiB. CPU/deadline/1536 MiB/PID caps сохранены. При чтении исходного `api/contract.js` и `lib/kp-browser.js` подтверждено отсутствие legacy page/PNG/output cap: ранее был deadline45 сек и Vercel maxDuration60 сек. Отдельные legacy storage limits512 KiB на saved document и15 MiB на upload не являлись DOCX aggregate limit.

Дополнительные DI проверки watcher: `python -m unittest discover -s deploy/tests -p 'test_kp_paired.py' -v`:10/10; полный `python -m unittest discover -s deploy/tests -v`:63, из них2 Linux-only skips и61 pass. Покрыты off/normal pair/first activation, частичная публикация, template/container/tag drift, web health rollback, crashed renderer rollback и exact own temporary override. Это fake adapters, без Docker/серверов/БД; реальные paired staging/rollback gates остаются открыты.

Packaging: при `core.autocrlf=true` `git hash-object --path <file> <file>` отличался от `--no-filters` для6 captured text files/manifests. `.gitattributes` теперь задаёт `-text` для assets/**, test/original/** и обоих JSON manifests. Повтор для всех46 pinned файлов: `filterDrift=[]`. Исходный `pero_kp` не изменялся; хеши шаблона остались прежними.

## Проверка расписания CI после review P2

Выделен `unit-tests-backend` с единственной cohort backend и dependency `kp-renderer-tests`. Его display name остаётся `unit-tests (backend)`, поэтому API producer/consumer identity, bot receipt и branch check names сохраняются. `unit-tests` содержит только components0/1 без dependencies: они продолжают выполняться параллельно renderer. Обе группы переиспользуют одну sequence alias шагов, без YAML merge keys. Backend и native теперь начинают свои бюджеты после renderer, одновременно. `build-push` и `build-push-bot` ждут component matrix, backend, native и renderer.

Из `target.mjs` экспортированы прежние константы `CI_ARTIFACT_BUDGETS`, без изменения значений: types poll18 минут/consumer20 минут, bot-dist poll3 минуты/consumer23 минуты; job timeout25 минут не увеличивался. Новый `ci-scheduling.test.mjs` читает настоящий workflow существующим parser ESLint, моделирует DAG и использует фактические runtime budgets. Сценарий renderer15 минут + native build8 минут сначала был RED (types готовы на23-й минуте при backend deadline20); после split он GREEN (backend стартует на15-й минуте, deadline35). Проверен renderer у предела своего timeout, отсутствие задержки component cohorts, отсутствие DAG/межшагового цикла и ожидание обеих unit-групп при публикации.

Команда `pnpm --filter @pero/web exec tsx --test tests/ci-scheduling.test.mjs tests/integration/runtime/target.test.mjs`:5/5 pass; ESLint обоих изменённых JS модулей pass. Все GitHub API запросы existing target tests подменены; Git/DB/Docker/S3/SSH/network в этой проверке не использовались. Реальный запуск workflow остаётся последующей CI-приёмкой.

## Проверки координатора после объединения №181–182

Обычным fast-forward merge получена `feature/182` до `d7078cdf736f36280c513db0806b2b60264573c0`; собственные изменения сохранены через retained stash `05b92ab60e65b246b19405f27c56ff7bbfc63ef0`. В `.env.example` сохранён проверенный временный клиент и один выключенный feature flag, в `.gitattributes` — LF миграций и raw pins шаблонов. После объединения Prisma validate/generate и полный web TypeScript прошли. Повторены package tests: шаблон 14/14, renderer 12/12; web editor/client/scheduling/target 17/17, deploy 61 PASS и 2 ожидаемых Linux-only skips. OpenSpec strict и whitespace проходят. Независимое повторное review CI/deployment закрыло timing P2 без новых замечаний. Linux141 OCI, реальный paired staging и API-сценарии этим локальным прогоном не принимаются.

## Полный cached whitespace check после staging всех файлов

Первый полный git diff --cached --check проверил ранее untracked raw assets и дал 4132 сообщения в 8 файлах. Полный вывод сохранён только в ignored audit. Per-path whitespace=cr-at-eol на существующих -text captured paths убрал ложные ошибки CRLF, оставив ровно 2 настоящих исходных пробела в конце строки21: manrope-OFL.txt и spectral-OFL.txt.

Для этих двух неизменяемых vendor-лицензий задано только whitespace=cr-at-eol,-blank-at-eol. Их bytes не исправлялись; blank-at-eof и space-before-tab сохраняются. Это не общее отключение whitespace для assets: новые crm-transport.js/kp-list.js получают только cr-at-eol с обычными проверками, а новые TS/server/CI файлы не имеют исключения whitespace. Глобальный Git config не менялся.

Итоговый git diff --cached --check: exit0, сообщений0. Для всех 46 pinned файлов git hash-object --path совпадает с --no-filters и с уже staged blob SHA; raw hashes до/после совпадают. TemplateHash 3dbe1a6836471812476971fff264d8257393b21e37c653ac5e3d9570e64fbefd, sourceManifestHash cc35ac24621412e902f563d92037b52952862fd2cf03938c17ffad10c3b7bece и fontManifestHash 29bddee77fb1f17b0dababea1afcce3493d7381a1510a03d75e179bea10bea59 остались прежними.

Audit: .playwright-mcp/kp-184/whitespace-s5xyaf/ — cached-before.log, cached-cr-at-eol.log, cached-final.log, pinned-before/after.json, index-before/after.raw и report.json. Индекс всех остальных staged файлов координатора сохранён; агент добавил в index только .gitattributes. Эта запись appended без замены текста/правок координатора и отдельно не staged агентом.

## Диагностика первого Linux CI290

Координатор подтвердил: run39143861949 для staging9c2deca завершился ошибкой `kp-renderer-tests` примерно через4 секунды на шаге настоящего Linux141 HTTP smoke. OCI build прошёл; прежний вывод `KP_PIPELINE_FAILED` не устанавливает причину. Backend/native не выполнялись после этого gate. Причина остаётся неизвестной до следующего CI; ресурсы и production renderer по предположению не менялись.

В synthetic `ci/smoke.cjs` добавлены ограниченные записи фаз в stderr, включая загрузку модулей, pinned runtime, прямой Chromium launch/version preflight, HTTP bundle/rasterize/DOCX и сравнение документов. Ошибка HTTP выводит только status и проверенный `KP_RENDER_*` code из тела до4096 bytes. Ошибки запуска сохраняют закрытые native hints/имя отсутствующей `.so`/разрешённый missing module; `message`, stack, assertion actual/expected, PDF/PNG/DOCX и secret не сериализуются. Успешный stdout остаётся прежним единственным JSON receipt.

`pipeline.mjs` отмечает фазы до создания контейнера. При неуспешном owned smoke до удаления exact ID сохраняется `smoke-failure.json`: безопасная проекция State, коды ошибки, SHA/длины stdout/stderr/logs и только проверенные phase/error events. Чтение logs ограничено80 строками/128 KiB на поток/15 секундами, проекция последних64 KiB —64 events. Перед logs и cleanup повторно проверяются ID/image/run/attempt/labels/resource bounds; guard отказ не разрешает читать или удалять чужой контейнер. Ошибка diagnostics/cleanup не заменяет исходный failure и не создаёт success receipt. Отдельный workflow `if: failure()` загружает только этот JSON на1 день; прежние success-only OCI upload, DAG, budgets и promotion gates сохранены. `KP_BUILD_METADATA` не выводится диагностическим кодом.

Локально без Docker/сети: `node --test apps/kp-renderer/test/ci.test.cjs` —7/7. Новые поведенческие случаи проверяют безопасные bounded diagnostics/HTTP body cancellation, evidence-before-cleanup, сохранение исходной ошибки при отказе записи, запрет unowned logs/rm и прежний успешный receipt/exit path. `pnpm --filter @pero/web exec tsx --test tests/ci-scheduling.test.mjs` —3/3; оба CI файла проходят `node --check`; OpenSpec strict PASS. Core ESLint (`no-unused-vars`, `no-undef`, `no-unreachable`, `no-constant-condition` с явными Node/browser globals) —PASS. Web ESLint сначала исключил файлы вне base path; запуск с root и его Next config остановился на отсутствующем существующем `eslint-plugin-react-hooks`, поэтому полный web-config lint для этих CI файлов не заявляется. Зависимости не менялись.

Новый CI не запускался агентом; Docker/DB/S3/SSH/Git/network операции не выполнялись. Gate4.3 остаётся открытым. Следующий разрешённый push/обычный merge координатора нужен для фактического Linux failure artifact и установления причины.

## Подтверждённый noexec и исправление tmpfs

После диагностического выпуска координатор получил конкретный отказ CI291: run39145500548/job117728380850 остановился на `chromium-launch` с `BROWSER_LAUNCH_FAILED`/`PERMISSION_DENIED`, exit1, OOM=false. Загрузка модулей, pins и извлечение бинарника прошли. В собственном изолированном non-DB Node22 probe координатор проверил механизм: Docker `/tmp:rw,nosuid,size=512m,mode=1777` фактически имеет `noexec`; копия официального Node binary в нём получает EACCES. При единственном добавлении `exec` тот же binary запускается с exit0. Receipt `.playwright-mcp/kp-184/tmpfs-proof-701c3207-e05a-45b3-bafa-438b7f4e0a3b.json` прочитан агентом: оба exact probe containers удалены, business mounts отсутствовали. Предшествующий serialization guard-stop сохранён координатором отдельно; guard не обходился сменой цели.

По этому подтверждённому механизму CI create и `deploy/docker-compose.kp.yml` задают одинаковый `/tmp:rw,nosuid,exec,size=512m,mode=1777`. CI owned-container guard и watcher проверяют этот единственный bounded tmpfs: явный exec, отсутствие noexec, прежние512 MiB/1777/nosuid/rw, порядок флагов несущественен. Compose/current-container drift останавливает парный deploy до up. Memory1536 MiB, CPU1, PID128, network isolation, node user, read-only rootfs, cap-drop и no-new-privileges сохранены; worker/render/application code не менялись.

Synthetic smoke до запуска читает `/proc/self/mountinfo` и mode извлечённого executable. Только закрытая проекция tmpfs/rw/nosuid/nodev/noexec-or-exec/mode попадает в phase; raw mount paths/options и env не выводятся. Проверяются tmpfs, отсутствие noexec, regular file и X_OK фактического пользователя, затем прежний Chromium141 launch/version preflight.

Локальные проверки без Docker/DB/S3/SSH/Git/network: CI8/8 и paired-watcher12/12 PASS, `node --check` обоих CI модулей PASS. Регрессии отклоняют старый default без exec, явный/дублированный noexec, увеличенный размер и неверный mode; разрешён переставленный порядок безопасных флагов. Проверка mountinfo различает фактический noexec и exec, сохраняя file mode и не раскрывая сторонние mounts. Core ESLint и OpenSpec strict PASS. Новая Linux OCI проверка после исправления не запускалась агентом; успешный локальный fake/DI тест и Node probe не считаются приёмкой Chromium, PDF/DOCX или staging. Gate4.3 остаётся открытым.

Полный локальный `python -m unittest discover -s deploy/tests -v`:65 tests,63 PASS и2 прежних Linux-only skips. Все вызовы Docker/transport в этих тестах подменены; install/rollbacks/deploy не выполнялись.

## CI292: Linux renderer принят, отдельная ошибка PID fixture

Координатор подтвердил фактический CI292/run39146611770 для SHA `c5b27a878058606c76e217edd4d73d55537f75d0` после исправления exec tmpfs: `kp-renderer-tests` SUCCESS/job117731626116, проверки страниц PDF/PNG и DOCX с исходником на упакованном Linux Chromium141 прошли. Component0/1/backend SUCCESS. Native:75 cases,74 PASS и1 FAIL fixture PID; web/bot promotion SKIPPED, обновление runtime этим CI не подтверждено. Это закрывает прежний Chromium startup failure, но не означает завершение native job или staging-приёмки4.3. Числа страниц/raw pixels не приписываются до чтения фактического renderer receipt координатором.

Native job остановился в прежнем warehouse fixture `warehouse/two-connection-issue-replay-return-real-lock-and-exact-facts`: строка377 ожидала два PID, получила три. `move()` собирал PID и для последовательного подготовительного INCOME, а пул мог затем выделить два других соединения конкурентным EXPENSE. В fixture после завершения INCOME и перед конкурентной парой добавлен только `pids.clear()` с русским пояснением. Exact assertion `pids.size === 2` для конкурентных запросов и все проверки отказа, остатка, replay, valuation, возврата, количества движений/audit/events сохранены. Production склад и бизнес-расчёты не менялись; БД и native runner агентом не запускались. Последующий Linux native прогон остаётся обязательным.

Локально после этой узкой правки: полный web `tsc --noEmit --incremental false`, ESLint `tests/integration/domain-postgres.test.ts`, scoped `git diff --check` и OpenSpec strict —PASS. Подключения к БД, Docker, S3, SSH, network и изменение Git index/history агентом не выполнялись.

## CI293: race чтения /proc в CI cleanup

Координатор установил для CI293/run39147735022/job117735191603: `waitDependencies` остановился в `cleanup.mjs/groupMembers` на EACCES чтения `/proc/5609/environ`. Перед этим завершающийся cash child дошёл до последнего test61; полного PostgreSQL-suite acceptance receipt нет. Это отказ обёртки чтения процесса, а не новый доказанный отказ бизнес-assertion; общий native gate остаётся открытым.

После EACCES groupMembers теперь повторно читает stat. ENOENT/ESRCH подтверждают исчезновение и разрешают пропуск. Zombie пропускается только при том же исходном числовом starttime и неизменном pgid, равном owner.pid. Живой процесс с прежней identity повторно бросает исходный EACCES; reused PID, другая группа и неполный/нечисловой stat вызывают identity guard. Если повторное чтение stat само недоступно, ошибка не подавляется. Общего игнорирования EACCES/EPERM нет. Nonce/purpose/leader start guards, exact group identity, порядок проверки всех живых членов до сигналов и прежние deadlines сохранены. Production code не менялся.

DI в groupMembers заменяет только чтения `/proc`, с прежними настоящими FS defaults. Три новых поведенческих guard-теста в существующем `runtime/target.test.mjs` проверяют stat-live→Z, ENOENT/ESRCH, живой unreadable PID, переиспользование PID/starttime, смену группы, malformed stat, отказ повторного чтения, другие errno и прежние nonce/purpose/leader guards. Неподтверждённый член группы не возвращается вызывающему signal path; тесты не запускают процессы и не посылают сигналы.

Локально: `node --test apps/web/tests/integration/runtime/target.test.mjs` —5/5 PASS, `node --check cleanup.mjs`, ESLint обоих изменённых JS файлов и OpenSpec strict —PASS. DB/native/Docker/S3/SSH/network и изменение Git index/history агентом не выполнялись. Следующий реальный Linux native прогон и staging4.3 обязательны; локальный ProcRead DI их не заменяет.

## CI294 и локальное сравнение печати

CI294/run39148631888 для exact SHA `0f8d38d6d0bba091786fb8b483a064d0f4fa9a97` завершился SUCCESS:7/7 jobs (`kp-renderer-tests`, component0/1, backend, native-tests, build-push, build-push-bot). Срез координатора сохранён в `kp-180/.playwright-mcp/kp-180/ci-0f8d38d6.json`; runtime receipt renderer/job117737547887 координатор прочитал непосредственно в CI UI. Прежние CI292 PID-fixture и CI293 `/proc` race сохранены выше как история отказов; последующий native job294 SUCCESS не был заменён локальным fake.

Фактический renderer receipt: config image `sha256:6c599ba78c853b3c482ddca19b4d8912209187e94642314b6e97c2f328834159`, OCI index `sha256:88a8a05b05f60beb9e9f0e9b1b582517319ebdfc69ed1c9a1cbb22850012962d`, browser `HeadlessChrome/141.0.7390.0`,4 страницы, smoke SHA `sha256:1b3bf10dfa3d89b6422ca840fd6e52e9e1bcfa7d63e83c073055a7e06651330b`. Успешный job проверяет все страницы PDF/PNG и multi-КП DOCX ZIP entries относительно исходного генератора в ограниченном контейнере без сети/БД. Это проверка образа в CI, а не установка renderer на staging host.

Локальная отдельная pixel-проверка остаётся воспроизводимым дополнением: receipt `apps/web/test-results/kp-editor/0273b83d-988c-498e-972e-fb3b8f57e123/receipt.json` прочитан повторно, browser153.0.8010.12, pages4, `allPagesIdentical=true`, `originalDpr2AppendicesIdentical=true`, container/staging=NOT_RUN. Её четыре PDF/appendix страницы и desktop1440/mobile390 были визуально проверены в описанном выше прогоне; повторная визуальная проверка сейчас не заявляется. TemplateHash `3dbe1a6836471812476971fff264d8257393b21e37c653ac5e3d9570e64fbefd`, source/fonts hashes в локальном receipt совпадают с frozen package.

## Ограниченный read-only runtime metadata и текущий STOP

Подготовлен ignored `.playwright-mcp/kp-184/runtime-readonly-0f8d38d6/`:49-строчный Node bundle,71-строчный host image-label probe, pinned manifest и инструкция. Нового transport нет: повторно проверены старый `crm-acceptance-transport.mjs` SHA `c37fcdaeddf168832a59a2f063a98d7bec7a9bc9eead9e929c46627b3dd2dc5b` и wrapper SHA `7b02b72572750caeab9a0d7a8806aabde1bed97fa1fab3c7c489e3df87b3c930`; прежние два networks/DB-volume/W07 guards/lock сохранены. Node читает template/package/source+generated schema files и boolean flags, без app/PrismaClient/CLI/DB/S3/render. Python разрешает только actual allowlisted image labels по уже identity-проверенному immutable web image ID, не активирует renderer.

Первый actual Node вызов root остановлен: `runtime-receipt-6ded38bb-1452-4423-a3b2-4a6bb4969c08.json`, operation readonly, wrapper target identity PASS, process exit1, phase `template_metadata`, versions/schema не достигнуты. Web ID `30bc3eaf0e65de03618811bde9aabe956d078a27d4914a1d263314e50d75fb20`, image `sha256:ba26aba92a1bc93926ba3c0f6a7111fa7ae4db0596010168531145998081f327`, revision0f8d38d6…, прежний DB/W07 сохранены. Host image probe не выполнялся. Этот failure не объявляется template packaging defect до отдельного bounded diagnostic; исходный bundle/manifest/guards не менялись.

В source `next.config.ts` пакет externalized, tracing включает assets/** и JSON; getter читает manifests/fonts.css/print assets/каждый font, а Docker runner копирует standalone. Подготовлен отдельный37-строчный `template-diagnostic.mjs` SHA `0acf6fc7bc10ac0c1150360f0ded8bc675584c311a741304fb58ab40dc17ff87`: различает resolve/load/getter/6 safe identity fields без fallback, status DIAGNOSTIC_ONLY/accepted=false. Фактическая причина и следующие runtime receipts дописываются координатором после его review/вызова, без слепого retry или ослабления target guards. Локально syntax и3 pure host projection/negative guard tests PASS; агент не выполнял фактических probes/SSH/Docker/HTTP/SQL/S3. Gate4.3 остаётся открытым до финальной185–189 API/UI/private-host приёмки; KP flag OFF.

## Подтверждённый defect standalone package и узкая правка runner

Фактический root diagnostic `diagnostic-receipt-99e71f89-43dc-4734-859f-ca2d9279b424.json` прочитан: старый pinned target identity PASS, phase resolve/MODULE_NOT_FOUND; package.json/manifests/пять выбранных assets есть, `index.cjs` и `limits.cjs` отсутствуют. SQL/storage/render=0, fallback=false. Это подтверждает неполную упаковку externalized `@pero/kp-template` в web standalone. Receipt failure и frozen metadata/diagnostic bytes сохранены; guard не ослаблялся.

В `apps/web/Dockerfile` после standalone добавлен явный COPY из build пяти runtime files (`index.cjs`, `limits.cjs`, package.json, source/font manifests) и assets в `/app/packages/kp-template`. `node_modules`, test/original, остальные tests и ненужный runtime d.ts не копируются. Шаблоны, стили, fonts, расчёты и package index не редактировались. DOCX по-прежнему генерирует отдельный renderer.

В существующем native next-build шаге после OCI/config/layers/renderer binding proof и до публикации image.json/types outputs выполняется actual web package smoke по exact config digest. Новый build/job не добавлен. Один synthetic container: network=none, read-only rootfs, user=node, memory256 MiB/CPU1/PID32, cap-drop ALL/no-new-privileges, без mounts/ports/DB/S3 env. Inner timeout15 секунд ограничивает Node; outer30 секунд оставляет время на exact-owned cleanup. Подменён entrypoint: приложение, миграции, server и renderer не запускаются.

Список33 browser assets (включая22 fonts,534637 bytes) получается через настоящий browserAsset исходного пакета по public candidates/fontManifest. Внутри image заново вызываются обычный require пакета, getKpTemplateIdentity, KP_RENDER_LIMITS, browserAsset для каждого разрешённого пути и ContractModel.defaults/validate на синтетических данных. Проверяются size/SHA каждого asset, приватные path отказы и совместимые plain functions; байты/HTML/PDF/DOCX не печатаются. Только synthetic metadata передаётся в stdin. Guard проверяет exact container/image/run/attempt/labels/bounds до start и rm; finally сохраняет исходную ошибку. Existing always-cleanup removeWeb убирает только доказанный собственный smoke container после cancellation, до удаления его image.

Локально: target/scheduling13/13 PASS, в том числе настоящие Node resolver отказы для temp package.json без index.cjs и для index без limits, отсутствие font, same-size byte drift, приватный path refusal, выполнение сериализованного stdin program через controlled loader, сохранение исходного failure и отсутствие rm при смене owner. Пустой temp resolver может видеть pnpm NODE_PATH workspace fallback, поэтому regression моделирует точный runtime defect с уже существующим package.json. ESLint четырёх затронутых runtime JS modules PASS без отключения правил; syntax/OpenSpec PASS; полный web TypeScript PASS. Это local/pure/DI, без Docker/DB/S3/SSH/HTTP; реальный non-DB Docker proof и новый CI/staging остаются root-проверкой после review/commit.
