# Проверки №188

Ветка `feature/188`, worktree `D:/Projects/pero_crm_worktrees/kp-188`. Зависимости поступили обычным FF merge №187 на base HEAD `c465290d2262a8d831fd3a6945d1670f6592e648`; собственные изменения №188 сохранены. В instrumentation объединены уже находящиеся в HEAD вызовы запуска рендера из №187 и два новых вызова запуска очистки из №188. Feature-файлы между ветками не копировались. Новых таблиц или миграций №188 нет.

## Локальные проверки

- 27/27 поведенческих тестов: `pnpm --filter @pero/web exec tsx --test tests/kp-retention*.test.ts`. Root повторил их после merge №187: PASS.
- Проверены IN_WORK/shared accepted optimized/PDF, сохранность DOCX history и самостоятельных Product keys, год от исходной даты и 29 февраля, архивные reserve/publish quarantine, активные PDF/CONTRACT/upload/copy leases, current/version refs, cover/manual aliases и pending ordinary delete.
- Versioned MemoryS3 проверяет pagination, точные version IDs и delete markers, сохранность соседнего ключа общего prefix, persisted INTENT до Delete, readback отсутствия, unknown ACK/retry и неизменность manifest. Проверен unversioned exact-key fallback. Это не настоящий S3.
- При binding/checksum mismatch дальнейшие Delete прекращаются. Возврат LEAD отменяет следующий шаг; read-only probe удерживает PENDING/fence при неизвестном результате, учитывает поздний ACK и не выполняет новых Delete.
- При независимом review до handoff исправлены продолжение прежнего accepted intent после DONE/PAUSED/RECLAMATION, ложный reconciledAt незавершённого probe и нативная позиция изделия с нуля. Добавлены поведенческие регрессии, включая поздний ACK.
- SDK adapter без сети проверяет exact VersionId/Key/cursor, ограниченный потоковый SHA, безопасный отказ при неправильной цели. Worker без флагов не создаёт таймеров/DB/S3 work, не допускает overlap; annual planning ежечасный, cancelled probes планируются отдельными tick.
- Frozen install и Prisma validate/generate выполнены без подключения к БД. Полная strict типизация приложения после merge №187 и после узкого helper fix: PASS.
- ESLint production/tests, OpenSpec strict и diff check прошли на первоначальном handoff №188. Для ignored native tooling современный project ESLint не подтверждён: app-cwd исключает outside-base, root-cwd останавливается на отсутствующем `eslint-plugin-react-hooks` в offline install. Зависимости и конфигурация не менялись.
- 12/12 pure tooling tests PASS: target/source/history guards, сохранение четырёх checksum-исключений, drift detection, transport/singleton tripwires, MemoryS3, безопасные AggregateError diagnostics, настоящий класс Prisma P2010 с извлечением meta SQLSTATE и fingerprint без чтения bind values. Default/dry инертен, production helper не импортирует.

## История native RED и исправления

Все actual SQL-запуски ниже выполнял root на существующей разрешённой local 5433 БД. Субагент готовил tooling и исполнял только проверки без БД/сети.

1. Plan `29717e06bf828c9672d405cd4585a335b349856b1ca9196625f09c08140fb5c4`, receipt `.playwright-mcp/kp-188/native188-root-9f5802db-d150-4f09-a13c-8078b75778c4.jsonl` (SHA256 `e1b2057da1ea1e5be6e2378a1d4ac87d32e0d80a008e1ef42c1fd34796c5cb3a`): FAILED в `actual188-native-helper`, Prisma P2010, markers[]. Supplementals не начались. Все 76 таблиц/catalog EXACT после rollback, 83 receipt/4 исключения без изменений, tripwires unused.
2. После расширения только ignored диагностики root запустил plan `e66c8af6fd938bcf26ed4a88921a9d3013d3d4c68ae4158133d794ec256fe447`; receipt `.playwright-mcp/kp-188/native188-diagnostic-38705ab0-67b1-40e5-8d66-406d61642662.jsonl` (SHA256 `8c4775c26d1be3d77325c0213c029fab14246a17254d52b763d1e009a63a4117`): FAILED, SQLSTATE 42601, raw SQL №12, UPDATE CommercialProposal, три parameter slots, statement SHA `6e30f2be5a09f78c00838b7ce87c480e91929027f70e87ae9f66b65bb04b1544`. Снова 76/catalog EXACT, 83/4 без изменений, tripwires unused.
3. Read-only AST-разбор 9 собственных файлов №188 / 106 SQL templates воспроизвёл тот же fingerprint: native helper, строка 41, содержал placeholder `now` непосредственно перед WHERE. Root разрешил добавить ровно один ASCII-пробел, EOL сохранены. Helper SHA `d7b625be1aad6dd9b0b7570706f759f8943db02bb54fcda11c41922a7b5e205c` → `97d4b8235943ccfadad0eb4e33acbeeb03309a8ec65e1e46539b5b63c7e2ec3c`. Других таких вхождений в 106 templates не найдено. Сверка 488 source hashes диагностического plan показала только этот утверждённый helper diff; production SQL, сценарии, baseline/target guards и data exclusions не менялись. Зеркальный whitespace unit test не добавлялся.

Первые две попытки остаются FAILED; доказанная сохранность rollback не объявляется функциональным PASS.

## Actual native GREEN: 9/9 SQL metadata cases

Root run `c8cbe4a0-9048-45f0-9ecc-5f4003c4dc16`:

- Base HEAD: `c465290d2262a8d831fd3a6945d1670f6592e648` плюс проверенные собственные source №188 до коммита.
- Exact source plan: `97dd5fe29ffd5d5ef7356d621115fded882d198148792d3f7926c68435f14580`.
- Receipt: `.playwright-mcp/kp-188/native188-fixed-786fafe3-1818-41de-b885-5173858c10b1.jsonl`, SHA256 `28508946828c626d38097e5d2bdf42fb52b56f96224157bf29def059866f5f1e`.
- Target: loopback5433/pero_crm/user pero, container `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, internal listener5432.
- Полный before/after snapshot всех 76 таблиц совпал: `afd3a5a3feb4e6029c8ca298804d713f6b778b05da403194380adee268ee9bec`.
- Полный catalog совпал: `805b1dddc7a974baf129f63ba4fca19245e5a411b5756850f8cddea54f1d5738`. Все 83 successful migration receipts и ровно 4 прежних checksum-исключения неизменны; 11 таблиц КП пусты до/после. Guard/source/target mismatch не обходился.
- Одна outer SERIALIZABLE transaction, общий mutation advisory lock, обязательный sentinel ROLLBACK и собственные savepoints. Никаких data exclusions, постоянных fixtures, schema changes или новых миграций. Tripwires unused; global workers disabled.

Два сценария настоящего `verifyKpRetentionNative` проверили shared accepted images/PDF, exact versioned progress и retired managed File tombstone/reattach fence. Ещё семь сценариев использовали настоящие create/save №181, lifecycle/render queue/stage gates №185 и repository №188:

- accepted/shared refs; старый ContractVersion JSON не удерживает ненужный КП PDF; issued DOCX и самостоятельная ProductFile copy сохраняются;
- возврат LEAD отменяет очистку и разрешает read-only освобождение не начатых fences;
- смена accepted epoch принимает новый saved release и не оживляет старое cancelled job;
- unknown cancelled INTENT удерживает fence/PENDING retry без расхода budget; поздний ACK объединяется монотонно, probe не делает Delete;
- Delete до ACK повторяется по прежнему manifest без расширения scope;
- годовой срок берётся от исходного archived createdAt, сохраняются PDF/DOCX/data; до годовщины job нет, на границе создаётся один раз;
- активное server PDF job удерживает frozen media; после terminal cancel через настоящую queue annual cleanup повторяется успешно.

Итог receipt: `totalMetadataCases:9`, `actualStageGateAndQueue:true`, `actualRepository:true`, `preservation:EXACT`, `allFixturesRolledBack:true`. Backend PID/настоящие конкурентные S3 запросы этим прогоном не проверялись.

## Границы и оставшаяся приёмка

Storage только MemoryS3. PDF/DOCX/images — явные SQL metadata stand-ins; publication wrappers №185 проверяют связи/lease/revision, а не физический документ. Money/media hooks дополнительных сценариев metadata-only: приёмка №182/183 этим не заявляется. `physicalS3Acceptance:false`, `physicalPdfAcceptance:false`, `financialAcceptance:false`, `rendererAccepted:false`, `workerStarted:false`.

Настоящий S3 versioning/readback, физическое удаление реальных тестовых объектов и развёрнутый staging SHA/образ не принимались. Tasks 3.3/3.4 остаются открытыми. `PERO_KP_ENABLED` и `PERO_KP_RETENTION_WORKER_ENABLED` должны оставаться выключенными до сквозной приёмки и отдельного включения. Native GREEN не является разрешением на business storage cleanup.

Исходный R2, restic и чужие business-объекты не затрагивались. Субагент не запускал SQL/DB/Docker/S3/cloud/SSH, worker или deploy; локальный Git-коммит выполняется только по явному поручению root в рамках постоянного разрешения владельца №181–189. Production-выпуск и миграция этим change не разрешаются.

## FULL43: настоящий readonly capture и безопасное закрытие, физическая цепочка открыта

На 20.10.2026 фактическая staging-ревизия — `acbd164cb6e79194b7fe87a0469d60d745dead1a`; web image `sha256:8ef120a68e378d47b71ea5913ec8bd85391cfa4f2f8cd1ec25169151a55bd77f`, renderer image `sha256:ec35d0956e41d55f7d21cac46c5ea07430bde99d920a9538791899cc75dac5a8`. Ранее принятые CORE4 private Put/Get/readback и UI-сценарии №183/187 сохраняются; они не заменяют физическую приёмку retention.

Фактически выполнен только начальный readonly capture: `CAPTURED_FOR_ROOT_REVIEW`, 11 объектов / 2 jobs, по 11 LIST/HEAD/GET настоящего S3, RR READ ONLY, 76 таблиц, `writeCommands:0`. Все семь tripwires (FETCH, HTTP_OUTSIDE_S3, NET_OUTSIDE_S3, TLS_HTTP2, PROCESS, UNOWNED_SDK, SINGLETON) равны нулю. Каталог: `f28160d116d333d1ba0251bbd90ed7719393e7cbd2281ba758eeeac05f5e2c74`. Bundle: `1130a56efc988afd7b2e640a7f114bf534745f14c479e8f0ba33d103b9ee5bb7`; source proof: `22684e253a9cc42a5139621387ac8f45a03ad1456e65954c4fd3857e2f39bc37`.

- [Полный RAW capture](D:/Projects/pero_crm_worktrees/kp-180/.playwright-mcp/kp-integration/physical43-0cb36e93-c99a-41ea-9730-a15dc2510163/initial-capture-transport-ee9e311a-114d-4c57-b11e-35576db8f004.private.json) — SHA-256 `052d3d78efd92bdadfc80a877783a6a780ecbda19eb3a33059197a8dcbdac992`.
- [Фактический result](D:/Projects/pero_crm_worktrees/kp-180/.playwright-mcp/kp-integration/physical43-0cb36e93-c99a-41ea-9730-a15dc2510163/initial-capture-result-8ab07c93-8ae0-47c1-a04f-f032fa3d5708.private.json) — SHA-256 `c0459ef6e5122c78a9caf0ceb5f5df1e7a381d898c69a5a7dd72375a58303385`; manifest candidate — `45b967a41beb403f3190cf9bbb2cd6fe42f5d3cecc97c57e48d0cd528bbd64f3`.

Локальный QA-селектор после capture ошибочно искал MEDIA_ORIGINAL у обоих КП; secondary имел допустимый PDF target. Это ошибка локального связывания evidence, дефект business-программы не установлен. Исходный 405s admission был пропущен; **ни одна из десяти физических mutator-команд не отправлена**. Подготовка трёх S3 versions, COPY/Delete/readback после удаления, lost-ACK/retry, отмена при LEAD, due probe, annual cleanup, after-annual retained SDK contract и LEAD/restore410 остаются **NOT RUN**. Пункты 3.3/3.4 остаются `[ ]`: обязательная сквозная приёмка не завершена и не отменена. Старые HOLD и результаты SQL/MemoryS3 сохранены без переоценки.

Закрытие FULL43 подтверждено исходными квитанциями:

- [q100 RESTORED того же journal](D:/Projects/pero_crm_worktrees/kp-180/.playwright-mcp/kp-integration/full43-native-close/008-q100-restored-terminal.private.json) — `c7fc2641195ab9bc76999263ffefceb8f1712001a446c72d26dceaa0c16a2636`.
- [OFF ACK](D:/Projects/pero_crm_worktrees/kp-184/.playwright-mcp/kp-184/paired-continuation-packet-468aa763-30ff-47ba-8e61-8851f9816730/receipt-qa-off-67d2b46e-4d47-4387-bb08-23b9d1ed580a.json) — `896b672b32acbf95270d0150fbca19655fbf8375321a9dc2d6368bd4d873f583`: flags 000, owned renderer STOPPED.
- [Original finish RAW](D:/Projects/pero_crm_worktrees/kp-180/.playwright-mcp/kp-integration/full43-emergency-finish-a7ff82c0-b9cb-4de6-abf6-c40c90fdf4a2.private.json) — `88a09d3f3ec715261d03eceda3b0acc5e20eae81b3696afd578f16f79e62411b`: PASSED, 11 пользователей неактивны / 22 ключа отозваны.
- [Keeper terminal](D:/Projects/pero_crm_worktrees/kp-187/.playwright-mcp/kp-187/qa-key-deadline-packet-31905a3a-7770-4429-a227-5c7a4efeb132/receipt-status-af4089c5-c9be-466e-8631-3e96b3b7a286.json) — `790775854b4a012e58062d45de18340e74841084f837a22551429108a004963c`: ORIGINAL_FINISH_OBSERVED, `alive:false`.

Закрытый context `fresh-full43-run-context.json`: SHA-256 `0aa61d40171d87c89c6d517ec74fde17f5e54d44a8629da6b7bce5d194747b74`. Original finish сохранил foreign BUSINESS точно; RAW legacy ApiToken.lastUsedAt сохранён отдельно по ранее согласованной проекции. Полный RAW не объявляется равным после own finish-изменений User/ApiToken/ChangeLog. В finish сохранены семь pending jobs (5 PURGE_MEDIA и 2 PRUNE_VERSIONS), поэтому global-zero не заявляется. Разрешение на business cleanup, финальный cutover, main или production из этой частичной приёмки не следует.

Сводная независимая [классификация FULL43](D:/Projects/pero_crm_worktrees/kp-187/.playwright-mcp/kp-187/physical43-factual-classification-4c698c07-20261020.private.json), SHA-256 `7a7b848472264033ec5fb6069f49060465f68e8c67fbdf3ff0891ce084bff41f`: `SAFE_CLOSED_INCOMPLETE_PHYSICAL_NOT_RUN`. Нулевые writeCommands относятся только к readonly capture: предыдущие CORE Media upload/copy реально выполнялись.
