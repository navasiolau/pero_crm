# Read-only приёмка существующих данных и две forward migration

Владелец запретил новые QA-записи. Этот helper **не создаёт** synthetic User/Client/Project/Product/Work/Task/File, начисления, выплаты, тестовые split, отрицательные write-probes или cleanup фикстуры. Legacy `LEGACY_PROTECTED` markers, создаваемые самой согласованной SQL-миграцией, являются её штатным результатом. Production SQL и deploy отсутствуют. Правила: [SAFETY-RULES.md](D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md); при guard mismatch или неопределённом результате — STOP и private evidence, без повторного запуска write.

Запускать из `C:\Users\admin\.codex\worktrees\product-percentage-pay\pero_crm_v2\apps\web`. `dry-run` не читает Docker/БД и не запускает Next:

```powershell
node tests/percentage-readonly-local.mjs dry-run
```

После review исходного коммита, двух SQL SHA и точного Docker identity root готовит private `%TEMP%` seal с `approvedHead`, снимком исходника, полным ID/volume контейнера и `storageInventoryPath`. `seal-candidate` выводит только несекретные source/target сведения для review; root сохраняет этот JSON в private файле без ручной подстановки паролей. В `storageInventoryPath` — metadata receipts старых ключей `{key,etag,size,version}`; содержимое тысяч старых объектов helper не читает. Одноразовые команды:

```powershell
node tests/percentage-readonly-local.mjs seal-candidate <reviewed-full-HEAD> <absolute-private-storage-before.json>
node tests/percentage-readonly-local.mjs before <absolute-private-source-seal.json>
node tests/percentage-readonly-local.mjs apply <returned-private-dir>
node tests/percentage-readonly-local.mjs after <private-dir> <absolute-private-storage-after.json>
node tests/percentage-readonly-local.mjs start <private-dir> 3106
node tests/percentage-readonly-local.mjs probe <private-dir>
node tests/percentage-readonly-local.mjs probe <private-dir>
node tests/percentage-readonly-local.mjs browser-preflight <private-dir> <absolute-private-existing-actor-ids.json>
# root открывает только read-only UI через CUA, проверяя session ID/roles и отсутствие старых активных таймеров
node tests/percentage-readonly-local.mjs stop <private-dir> <absolute-private-storage-after-navigation.json>
```

`before` проверяет, что ожидают **ровно** `20260930145000_product_percentage_enum_values` (SHA256 `2d5ea9ef028cf9c38dff0bd4030846a8bca5f39d197e473cc7731ee73d017f17`) и `20260930150000_product_percentage_pay` (SHA256 `7c0b2bf77c10418a534fca63a4d7b7c4d77c4c3ac7033aa69ff433bf14a42a6a`). В одном read-only repeatable-read snapshot он снимает все старые business rows и экспортирует PostgreSQL snapshot. `pg_dump -Fc` использует **тот же snapshot**, после чего `pg_restore --list` и `pg_restore --file=-` проверяют структуру и полное чтение архива; восстановления БД нет. Дамп, SQL full-read, секреты и raw rows остаются только в ACL-ограниченном private `%TEMP%` каталоге.

`apply` повторно сверяет source/target и исходные fingerprints, пишет one-shot intent и вызывает только установленный `prisma migrate deploy`. Две миграции идут отдельными файлами; `ALTER TYPE ADD VALUE` не объединяется с использующей его миграцией в одну явную транзакцию. Никаких seed/reset/db push/DDL rollback. При неизвестном исходе intent запрещает слепой повтор; `after` отдельно читает ledger и состояние.

`after` проверяет прежние User, PayrollEntry, Payout, Work/Task allocations и все остальные старые строки целиком. Только для **pre/post migration projection** исключаются новые defaults `Product.noModel=false`, `Task.physicalOnlyShare=false`, `PayrollEntry.percentageCompletionShareId=null`. После миграции новое полное состояние не нормализуется. Новые config/participants/shares пусты; `ProductPercentageCompletion` содержит строго ожидаемые `LEGACY_PROTECTED` markers для уже пройденных/оплаченных этапов, без новых денег. Сверяются прежние File metadata и metadata inventory storage по key/ETag/size/version, без полного byte-read старых медиа.

До `start` root создаёт и проверяет junction **только** `worktree/apps/web/uploads` → `D:\Projects\pero_crm_v2\apps\web\uploads`; helper не создаёт/переносит uploads и fail-closed сверяет `realpath`/link type. `start` запускает только принадлежащий этому helper локальный Next процесс скрыто, на разрешённом loopback-порту 3106 или 3110, с приватным временным `AUTH_SECRET` в ACL-ограниченном `secret.json` (не stdout), точным существующим DB URL и **без S3 env**. `probe` подтверждает `/api/health`, тот же junction и нулевой business drift после старта. `browser-preflight` читает роли/sessionVersion только выбранных существующих сотрудников и запрещает навигацию при их активных таймерах. `stop` проверяет PID, executable, командную строку, время создания, останавливает только свой процесс и снова сверяет полные DB/storage fingerprints. Никаких изменений существующих password/sessionVersion/roles/preferences.

Из-за запрета на QA-записи эта приёмка **не доказывает native начисления 350/150/420/280, физический split или поведение SKIPPED при новых действиях**. Их покрывают offline unit/controller tests; native проверяет схему, совместимость и сохранность существующих данных. Staging после local green проходит штатный автодеплой и отдельную read-only сверку через уже принятые W07/target guards; main/production остаётся HOLD до отдельного решения владельца.
