# Native protocol update proposal

Первый130 native run остаётся STOP с mutationStarted=false; readonly diagnostic сейчас доказала enabledPlugins1, outside payees/income0, identity match. Пользователи, плагины и их настройки не меняются.

## Read-only inspection scope

Новый отдельный operation `plugin-inspection` запускает existing local target helper и source-bound root approval, затем SET TRANSACTION READ ONLY. SELECT читает только enabled Plugin.id (без settings/config/names/version/credentials). Lookup `getManifest(id)` рассматривает зарегистрированность и наличие функции onDomainEvent; функция hook не вызывается. Registry, demo implementation и definePlugin SDK source входят в sourceHash. Возвращаются только ID/boolean/hash и readOnly/no mutation markers.

Текущий код registry содержит demo; definePlugin возвращает объект манифеста без callback execution. Payload/settings/permissions и bodies hook не возвращаются. Core130 напрямую импортирует только Prisma/чистые lib/actor/turnover-query и type-only TaskTransaction; SQL callbacks выполняются через supplied transaction. Native вызывает core, не actions: dispatch/notify/cache не вызываются. Outbound fetch запрещён, root независимо наблюдает отсутствие local Next/event runtime/listeners/dispatchers.

## Proposed execution gate, not yet applied

После metadata observation reviewer/root отдельно рассмотрят допуск точного source-pinned enabled-ID списка при подтверждённо неактивном dispatcher и core-no-dispatch/outbound-deny. Enabled row сама не исполняет hook; при active runtime либо unknown source/hook/ID остаётся STOP. Новая gate не разрешает менять enabled/config и не ослабляет outside-payee/income/target/schema/ownership/fingerprint safeguards. Root observations и точные IDs/hash входят в новую approval. Until separate GO native setup/retry остаются BLOCKED.

Все source/target/root approvals требуется обновить после code hash change. Один readonly inspection не является concurrency/native PASS и не заменяет original failed evidence.
## Applied reviewed outcome

Readonly enabled-ID observation:file-stages,registered=false,hasDomainEventHook=false. Exact no-runtime-hook gate согласована отдельными DESIGN/CONCRETE_PROTOCOL_GO, implementednegativecaps и fresh root observed inactive-window approval. Новая namespaceaf699a65… успешно прошла one native run под sourcea243…, exact cleanup/full originalFP unchanged/outbound0. Existing Plugin/config не менялись. Original6b511 STOP сохраняется. Finaltyping-only850100… provenance отдельно описана вevidence и не заменяет исходныйexecutedhash.