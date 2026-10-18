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
