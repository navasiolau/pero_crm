# Приёмка конкретной ревизии

Приёмка связывает reviewed domain producer, accepted production sources и actual target с согласованными сценариями change. PASS относится только к исполненным сценариям. Полноту требований по риску изменения отдельно проверяют reviewer и root; общий отчёт не объявляет готовность всего плана и не разрешает выпуск.

В №168 неиспользуемые generic declaration/readiness/verify CLI `acceptance-evidence-runner.mjs`, `acceptance-evidence-protocol.mjs` и `acceptance-runtime-entry.mjs` выведены из эксплуатации. Действующие domain producers, native prerequisites, source manifest и закрытый транспорт сохраняются. Исторические результаты прежнего протокола не переписываются.

- Отсутствующий receipt — NOT_RUN.
- Несовпадение SHA/run/target/image/version/source/level, UNKNOWN или неизвестная ownership — BLOCKED.
- Известный отказ — FAIL.
- PASS требует проверенный adapter execution, все checks, неизменные pins и нужное доказательство rollback/cleanup.

CI и identity сами по себе бизнес-сценарий не закрывают. Native, HTTP, browser, visual, runtime-node и DI различаются. Подставной receipt native-уровня не считается PostgreSQL-приёмкой.

## Источники и ABI

acceptance-source-manifest.mjs проверяет accepted Git blobs, schema, lockfile и config. Все физические production imports допускаются только из принятого sourceRoot. Импорт той же копии из другого worktree также отказывает. Новый reviewed QA producer фиксируется своим SHA/version.

До bundle проверяется accepted tree и reviewed producers; FIRST onLoad проверяет physical path и компилирует те же bytes, чей hash проверен. После bundle проверяются pins и actual esbuild metafile. Таким образом WIP queries130/events135 не могут подтвердить staged131/129. Git hash-object учитывает clean CRLF; physical hashes защищают каждую фазу. Filters, traversal, reparse и неизвестные inputs отказывают.

Virtual adapter явно задаёт namespace/path/contents/loader/SHA, accepted original production paths, transformer file/SHA и boundary kind/effects. Центральный onLoad владеет объявленными bytes; неизвестные namespaces и overrides не проходят. Разрешённый adapter является ограниченной проверкой своих эффектов, а не доказательством full app delivery.

Raw stage transport связывает фактические bundle hash и identity. Каждый domain workflow сохраняет собственные reviewed bindings и доказательства сценария. При неопределённом эффекте сохраняются UNKNOWN/HOLD и checkpoint; продолжение — отдельный reviewed inspect, без автоматического повтора записи.

Actual image/identity подтверждает существующий qaTransport + crm-modernization-staging wrapper с прежними W07/DB/S3 guards. Secrets/sessions/raw logs/PII остаются вне Git и публичной сводки.

## Native modernization

Клиенты создаются только после physical target guard; cold import не запускает Docker/DB/network. Local использует существующий container и loopback5433/pero_crm, staging — injected wrapper proof/db/crm. Current prerequisites проверяются чтением каталогов, а не повторным исполнением migrations.

Percentage runner требует validated constraints, valid unique indexes и enabled triggers с нужными event masks/function names. Все v4 unit/batch/frozen/replay/adjustment assertions выполняются на own IDs внутри rollback-only transaction. Negative UPDATE использует own completionShare/adjustment. После неожиданной ошибки original snapshot проверяется всегда; original failure сохраняется вместе с preservation failure.

Warehouse работает только с существующим ACTIVE main, не создаёт и не удаляет его. Сначала отдельный read-only inspect формирует exact graph IDs, все mutation UUIDs, original fingerprints и state digest. Перед native bundle требуется внешний durable PRE. Native bundle связывает plan SHA, original inspect receipt и перепроверяет baseline перед первой записью. Container PRE — дополнительная копия, а не замена outer PRE.

Два backend PIDs доказывают независимые соединения. Перед первым удалением cleanup получает existing warehouse advisory lock и FOR UPDATE только exact owned PKs, проверяет все входящие FK, включая composite/Cascade/SetNull/Restrict, и full original fingerprint с исключением только exact own keys. Unsupported ownership/schema отказывает. Serializable cleanup с lock timeout 5s повторяет full snapshot до/после удаления и после commit. Изменяющие ошибки/потеря ACK сохраняют PRE и graph для inspect, без blind cleanup.

Original balances/valuations/main/прочие rows, constraints/functions/triggers/indexes остаются в fingerprint. Действующий main.runId не является ownership. Lease и independent review обязательны перед любым real native run.

## Матрица владельцев и evidence

| Область | Обязательное доказательство | Владелец |
|---|---|---|
| 159 | source-bound baseline/CI/actual image + read-only HTTP smoke; percentages TS недоступны | root, author159 |
| 163 source/native guards | accepted source pins, actual image/identity и real native rollback/concurrency | author163/root |
| 129 | реальные HTTP preview/download/ACL/CSP и browser PDF/image; exact fixture cleanup | files author |
| 131 | HTTP canonical months/CSV/roles, browser switcher3viewports; pure clock отдельной строкой | finance author |
| 128 | before/after UI/behavior/data, own prefs CAS cleanup, native grouping на accepted source | frontend author |
| 141 | проблемный iMac/Windows11/Chrome | BLOCKED до доступности устройства |

Supporting domain receipts требуют того же revision/identity/source/bundle/version/context. Producer не готов — его строка NOT_RUN. Pure clock не заменяет HTTP/CSV/browser; memory fixtures не заменяют actual app routes.

163 не меняет production/UI/schema/CI policy. Дампы/restic/reset/seed/новые БД не используются. Main остаётся запрещённым. Native130/135 windows задаёт root; во время HOLD DB/runtime запрещены.
