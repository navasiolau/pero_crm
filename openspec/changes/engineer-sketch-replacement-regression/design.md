# Design

## Context

См. proposal.md. В baseline уже существуют независимая кнопка замены, точный `expectedSketchFileId`, upload receipt, проверка технического блока и transactional CAS. UI удаления дополнительно ограничен автором; это не условие замены. Схема и публичный API не меняются. Найдена гонка идентичных запросов: оба успевают записать bytes до Product lock, второй получает repeated receipt, но не удаляет свои новые ключи и повторно уведомляет.

## Goals / Non-Goals

**Goals:** подтвердить назначенного ENGINEER и ENGINEER-участника DESIGN по полному пути, чужой и legacy-автор старого изображения, сохранность вложения, stale/retry, неверные FK, реальный staging/S3 и ограниченную очистку QA.

**Non-Goals:** расширение ролей или статусов, удаление старого эскиза при замене, конвертация файлов, миграции, production, seed/reset, дампы, restic.

## Decisions

- RED дополнительной POST-регрессии воспроизвёл retained duplicate keys (0 compensation deletes вместо2). Добавить только repeated compensation и !repeated notification guards в существующем sketch path. Транзакция, ACL и original bytes сохраняются.
- Приёмка staged baseline принадлежит root. Перед записью root читает task harness и подтверждает exact OCI revision, hostname, DB identity/mount/binding, отдельный S3 bucket и idle W07. Используется существующий transport без старого backup gate.
- Фикстуры содержат один помеченный QA-проект/клиент, DESIGN-изделие и QA-акторы. Живые назначения и файлы не изменяются. Через реальные authenticated POST/browser requests manager загружает первый эскиз, engineer заменяет его; pre/post fingerprints, оригинальные bytes, S3 keys и сведения операции остаются приватными.
- Повтор идентичного запроса SHALL вернуть тот же file ID без дополнительного file/receipt/storage write; устаревший baseline, иной contentHash или pointer возвращает conflict. Два конкурентных запроса используют один baseline; успешен ровно один, старые файлы сохраняются.
- Очистка начинается только после распознанных ACK и подписанного ownership checkpoint. Удаляются собственные файлы/точные новые S3 keys и связанные исключительно с QA операции; сравниваются исходные fingerprints. При неизвестном исходе — STOP, сохранение checkpoint и диагностика по точным IDs.

## Risks / Trade-offs

- Зелёные DI-тесты не доказывают deployed image, PostgreSQL, S3 или браузер → отдельные acceptance tasks и evidence не закрываются до фактической проверки.
- Совместная local DB и nightly staging refresh → root serial coordination и действующий W07 lock; субагент не выполняет мутации БД самостоятельно.
- Доставка org-уведомлений в staging → root подтверждает изоляцию внешних побочных действий; QA сохраняет точную область своих уведомлений и audit.
- Незавершённая staging-приёмка прежнего change → новая задача не выдумывает кодовый дефект; по итогам фиксируется работающая текущая реализация.

Дополнение112: static standalone import Auth JWT упал до entry. Для QA JWT/Jose/HKDF включаются в65KB bundle locked версии; ESM createRequire мост обслуживает builtin crypto. Load-only dummy JWT roundtrip исполняется только в отдельном probe процессе, не создаёт data clients и не расширяет права. Target/HMAC/CAS/cleanup guards и приложение не изменяются. Failed prepare845 с0 собственных записей остаётся в журнале; новая попытка — только root review/new UUID, без повторения старого intent.

Partial AE recovery is explicit, not a new baseline: preserve present2 OrgSetting rows and retain unknown prior value as unknown; normal mode still requires original fingerprint equality. Signed exact AE graph/versions, current whole-table OrgSetting CAS, locking only its2 existing keys, own-only deletion and postchecks allow bounded cleanup without reverting unrelated state. Output must say PARTIAL_CLEANED, runtimePass=false/fullOriginalMatch=false. A later outside write is reported, preserved and never overwritten. Fresh verification must collect actual BEFORE per-row evidence to distinguish unchanged username from a value change.

Fresh checkpoints дополнительно подписывают BEFORE per-row evidence для единственного operational key telegram.botUsername и всех других OrgSetting rows. Политика сверяет immutablekey/value/allnon-datefields/count/otherrows и разрешает только monotonicupdatedAt; безbefore она не применяется. Old rawbaseline не переписывается, realvaluechange не маскируется. Whole-signed-observation CAS и exactkeylock защищаютnormalcleanup; последующий outsidewrite отмечается. AE partialcleanup завершён root безfunctionalPASS.

P2review required a coherent read boundary: normalcapture and postcommit snapshot/per-row evidence now use one RepeatableRead READ ONLY transaction. Prepare/cleanup retain their coherentSerializable context and invokeinnercapture; field verification is unchanged. Controlled tick/revert tests establish no cross-versionMATCH and no falseclock-only admission. This QA-only refinement must be re-reviewed beforefresh stageexecution.

Narrow participant repair: preserve currentEngineeringReadWhere for primaryengineer DESIGN/PRODUCTION; add existingengineeringProductWhere only for ENGINEER with currentverified participantIDs. DESIGN constraint and liveancestor wrappers stay shared. This brings read/project/file baseline checks into agreement with established technicaledit; does not grant participantPRODUCTION return/status writes or expand monetary views/actions. Engineerfilter predicate remains its previous primaryORparticipant union AND visibility, with meaningful selecteduser/status/deletion regressions.
