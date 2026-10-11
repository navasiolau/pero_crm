# Приёмка конкретной ревизии

163 связывает reviewed QA producer, accepted production sources и actual target с явно объявленным перечнем сценариев. PASS относится только к этому перечню. Полноту требований по риску изменения отдельно проверяют reviewer и root; общий отчёт не объявляет готовность всего плана и не разрешает выпуск.

Protocol: pero-crm-acceptance/v1. Declaration содержит full SHA, local/staging, runUUID и requirements: task/scenario/level, producer/version/sourceSHA, bundleSHA, sourceManifestDigest, preservation и обязательные assertion IDs.

- Отсутствующий receipt — NOT_RUN.
- Несовпадение SHA/run/target/image/version/source/level, UNKNOWN или неизвестная ownership — BLOCKED.
- Известный отказ — FAIL.
- PASS требует проверенный adapter execution, все checks, неизменные pins и нужное доказательство rollback/cleanup.

CI и identity сами по себе бизнес-сценарий не закрывают. Native, HTTP, browser, visual, runtime-node и DI различаются. Offline DI-capsules проверяют этот протокол и не считаются PostgreSQL-приёмкой, даже когда моделируют receipt native-уровня.

## Источники и ABI

acceptance-source-manifest.mjs проверяет accepted Git blobs, schema, lockfile и config. Все физические production imports допускаются только из принятого sourceRoot. Импорт той же копии из другого worktree также отказывает. Новый reviewed QA producer фиксируется своим SHA/version.

До bundle проверяется accepted tree и reviewed producers; FIRST onLoad проверяет physical path и компилирует те же bytes, чей hash проверен. После bundle проверяются pins и actual esbuild metafile. Таким образом WIP queries130/events135 не могут подтвердить staged131/129. Git hash-object учитывает clean CRLF; physical hashes защищают каждую фазу. Filters, traversal, reparse и неизвестные inputs отказывают.

Virtual adapter явно задаёт namespace/path/contents/loader/SHA, accepted original production paths, transformer file/SHA и boundary kind/effects. Центральный onLoad владеет объявленными bytes; неизвестные namespaces и overrides не проходят. Разрешённый adapter является ограниченной проверкой своих эффектов, а не доказательством full app delivery.

Координатор требует manifest.revision === declaration.revision до транспорта, а prepared.context и actual body должны совпадать по revision/target/runId/scenarioId/producerId/producerVersion. Stage raw transport дополнительно связывает actual bundle hash и identity. Verifier повторно проверяет сохранённые source manifest, intent, raw body, checks, preservation и подготовленный plan. Ошибки CLI выдаются закрытым кодом без arbitrary body/secret.

## API

acceptance-evidence-runner.mjs экспортирует:

- acceptanceDirectory(root,runId): собственная private .playwright-mcp/revision-acceptance/runId.
- executeApprovedScenario: reviewed producer/bundle/manifest/context, явная операция, immutable intent до транспорта, private raw и normalized receipt после исполнения.
- verifyRun: сверка immutable intent/raw/source artifacts и readiness объявленных requirements.
- persistPreparedPlan: только из verified read-only data-integrity inspect receipt; fsync exact plan и raw receipt binding до native bundle.
- prepareRuntimeProducer: маленький reviewed Node/V8 interval + actual HTTP health bootstrap, отдельные evidence levels.

CLI выполняет только verify. Нет автоматического execute, restore или повторного intent. При неопределённом эффекте сохраняются UNKNOWN/HOLD и checkpoint; продолжение — отдельный reviewed inspect.

Команда после подготовки реальных private receipts:

    pnpm exec node apps/web/tests/acceptance-evidence-runner.mjs verify <declaration.json> <identity.json> <private-run-dir>

Actual image/identity подтверждает существующий qaTransport + crm-modernization-staging wrapper с прежними W07/DB/S3 guards. Secrets/sessions/raw logs/PII остаются вне Git и публичной сводки.

## Native modernization

Клиенты создаются только после physical target guard; cold import не запускает Docker/DB/network. Local использует существующий container и loopback5433/pero_crm, staging — injected wrapper proof/db/crm. Current prerequisites проверяются чтением каталогов, а не повторным исполнением migrations.

Percentage runner требует validated constraints, valid unique indexes и enabled triggers с нужными event masks/function names. Все v4 unit/batch/frozen/replay/adjustment assertions выполняются на own IDs внутри rollback-only transaction. Negative UPDATE использует own completionShare/adjustment. После неожиданной ошибки original snapshot проверяется всегда; original failure сохраняется вместе с preservation failure.

Warehouse работает только с существующим ACTIVE main, не создаёт и не удаляет его. Сначала отдельный read-only inspect формирует exact graph IDs, все mutation UUIDs, original fingerprints и state digest. Координатор сохраняет outer durable PRE. Subsequent native bundle связывает plan SHA, original inspect receipt и перепроверяет baseline перед первой записью. Container PRE — дополнительная копия, а не замена outer PRE.

Два backend PIDs доказывают независимые соединения. Перед первым удалением cleanup получает existing warehouse advisory lock и FOR UPDATE только exact owned PKs, проверяет все входящие FK, включая composite/Cascade/SetNull/Restrict, и full original fingerprint с исключением только exact own keys. Unsupported ownership/schema отказывает. Serializable cleanup с lock timeout 5s повторяет full snapshot до/после удаления и после commit. Изменяющие ошибки/потеря ACK сохраняют PRE и graph для inspect, без blind cleanup.

Original balances/valuations/main/прочие rows, constraints/functions/triggers/indexes остаются в fingerprint. Действующий main.runId не является ownership. Lease и independent review обязательны перед любым real native run.

## Матрица владельцев и evidence

| Область | Обязательное доказательство | Владелец |
|---|---|---|
| 159 | source-bound baseline/CI/actual image + read-only HTTP smoke; percentages TS недоступны | root, author159 |
| 163 coordinator | local protocol/source/fault tests, accepted image tool/runtime/HTTP, real native rollback/concurrency | author163/root |
| 129 | реальные HTTP preview/download/ACL/CSP и browser PDF/image; exact fixture cleanup | files author |
| 131 | HTTP canonical months/CSV/roles, browser switcher3viewports; pure clock отдельной строкой | finance author |
| 128 | before/after UI/behavior/data, own prefs CAS cleanup, native grouping на accepted source | frontend author |
| 141 | проблемный iMac/Windows11/Chrome | BLOCKED до доступности устройства |

Supporting domain receipts требуют того же revision/identity/source/bundle/version/context. Producer не готов — его строка NOT_RUN. Pure clock не заменяет HTTP/CSV/browser; memory fixtures не заменяют actual app routes.

163 не меняет production/UI/schema/CI policy. Дампы/restic/reset/seed/новые БД не используются. Main остаётся запрещённым. Native130/135 windows задаёт root; во время HOLD DB/runtime запрещены.
