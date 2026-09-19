# Восстановление инфраструктуры PERO

## Статус инструкции

Актуальная точка продолжения: [INFRA_RECOVERY_HANDOFF.md](INFRA_RECOVERY_HANDOFF.md).
Этот документ — операторские сценарии восстановления; README в
`deploy/infra-recovery/restore` описывает их программную реализацию.

Эта инструкция соответствует текущим CLI и схемам в
`deploy/infra-recovery/backup`, `deploy/infra-recovery/restore` и
`deploy/infra-recovery/operations`.

На 15.09.2026 новый полный backup ещё не запускался, полный изолированный
restore всех сервисов ещё не завершался, а эта инструкция не проходила
натурную приёмку. Наличие исходников и успешные unit/parser-тесты не являются
доказательством восстановления. До получения `BACKUP_OK`, `RESTORE_OK` и
проверенного `restore-report.json` запрещено отключать старые задачи, очищать S3
или считать процедуру готовой к аварийному применению.

Ни одна команда ниже не использует `latest`, mutable Docker-теги, фиксированный
тестовый CT/VMID, перезапись существующего каталога восстановления или сравнение
с изменившимся production. Во всех шагах используется один полный
64-символьный restic snapshot ID из одного complete receipt.

## Что должно быть доступно без Vaultwarden

Постоянный репозиторий restic остаётся только на диске E:. До аварии проверить
доступ к следующему комплекту без работающих Proxmox и Vaultwarden. Для пароля
restic и ключей ZFS нужна отдельно доступная владельцу офлайн-копия; это не
требование создавать второй restic-репозиторий:

- restic repository `E:\pero-backups\repo` и исполняемый файл
  `E:\pero-backups\bin\restic.exe` версии, закреплённой в backup-конфигурации;
- ACL-защищённый restic password file, путь к которому записан в
  `restic.passwordFile` backup-конфигурации;
- отдельные SSH private/public keys, `ssh_config` и `known_hosts`, пути к
  которым записаны в operations-конфигурации;
- ключи шифрования ZFS для всех raw encrypted streams `zdata/nas`, `zdata/s3`
  и `zdata/vault`, с проверенным перечнем dataset → key file;
- установочный носитель Proxmox, recovery ISO/offline package bundle и receipt
  чистого nested-Proxmox template;
- complete receipts, генераторы runtime layout/plan, сохранённые backup/restore
  скрипты и их SHA-256;
- доступ к VPS/регистратору/NetBird, необходимый после восстановления данных и
  приложений.

Ключи и password files не выводить через `Get-Content`, не передавать в
аргументах команд и не копировать в отчёты. Runtime-файлы находятся только на
E:, inheritance ACL отключён, доступ разрешён только `SYSTEM` и встроенным
Administrators. Если отдельная офлайн-копия restic password или ZFS keys не
проверена до аварии, восстановление нельзя считать обеспеченным.

## Общая подготовка и выбор snapshot

Запускать команды из повышенного PowerShell на recovery-компьютере. Сначала
найти фактический `-ConfigPath` в установленной задаче, не угадывать его. Ниже
используется подготовленный путь `E:\pero-backups\config\operations.json`:

```powershell
$OperationsConfigPath = 'E:\pero-backups\config\operations.json'
if (-not (Test-Path -LiteralPath $OperationsConfigPath -PathType Leaf)) {
  throw "Operations config is missing: $OperationsConfigPath"
}
$Operations = Get-Content -LiteralPath $OperationsConfigPath -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath([string]$Operations.backupRoot) -cne 'E:\pero-backups') {
  throw 'Unexpected backupRoot'
}

$BackupConfigPath = [string]$Operations.backup.configPath
$BackupConfig = Get-Content -LiteralPath $BackupConfigPath -Raw | ConvertFrom-Json
$Restic = [string]$BackupConfig.restic.executable
$env:RESTIC_REPOSITORY = [string]$BackupConfig.restic.repository
$env:RESTIC_PASSWORD_FILE = [string]$BackupConfig.restic.passwordFile
$env:RESTIC_CACHE_DIR = [string]$BackupConfig.restic.cacheDirectory
$env:TEMP = [string]$BackupConfig.restic.tempDirectory
$env:TMP = $env:TEMP
foreach ($Path in @($Restic, $env:RESTIC_REPOSITORY, $env:RESTIC_PASSWORD_FILE, $env:RESTIC_CACHE_DIR, $env:TEMP)) {
  if (-not [IO.Path]::GetFullPath($Path).StartsWith('E:\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Runtime path is outside E: $Path"
  }
}
$ResticVersionOutput = (& $Restic version) -join "`n"
if ($LASTEXITCODE -ne 0 -or $ResticVersionOutput -notmatch "^restic $([regex]::Escape([string]$BackupConfig.restic.expectedVersion))\b") {
  throw 'restic version differs from the pinned backup configuration'
}
if ((Get-FileHash -LiteralPath $Restic -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$Operations.restore.resticSha256) {
  throw 'restic executable hash differs from operations configuration'
}
```

Получить список complete receipts без чтения password file:

```powershell
Get-ChildItem -LiteralPath 'E:\pero-backups\receipts' -Filter '*.json' -File |
  Sort-Object LastWriteTimeUtc -Descending |
  ForEach-Object {
    $Receipt = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
    [pscustomobject]@{
      ReceiptPath = $_.FullName
      RunId = $Receipt.runId
      Status = $Receipt.status
      SnapshotId = $Receipt.snapshotId
      CreatedAtUtc = $Receipt.createdAtUtc
      ProtectedUntilUtc = $Receipt.protectedUntilUtc
    }
  } | Format-Table -AutoSize
```

Владелец выбирает конкретный `$BackupRunId`, после чего receipt проверяется до
любого restore:

```powershell
$BackupRunId = '<backup-uuid>'
$ParsedBackupRunId = [guid]::Empty
if (-not [guid]::TryParseExact($BackupRunId, 'D', [ref]$ParsedBackupRunId)) {
  throw 'Backup run ID is not a canonical UUID'
}
$ReceiptPath = "E:\pero-backups\receipts\$BackupRunId.json"
$Receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
$SnapshotId = [string]$Receipt.snapshotId

if ([int]$Receipt.schemaVersion -ne 1 -or [string]$Receipt.status -cne 'complete') {
  throw 'Receipt is not complete schema v1'
}
if ([string]$Receipt.runId -cne $BackupRunId) { throw 'Receipt runId mismatch' }
if ($SnapshotId -cnotmatch '^[a-f0-9]{64}$') { throw 'Snapshot ID is not full 64-hex' }
foreach ($Tag in @('kind=infra-full', "run=$BackupRunId", 'schema=1')) {
  if (@($Receipt.tags) -cnotcontains $Tag) { throw "Receipt tag is missing: $Tag" }
}
foreach ($Field in @('snapshotListed','contentsListed','manifestRestored','manifestHashMatched','repositoryCheck')) {
  if ([string]$Receipt.restic.$Field -cne 'passed') { throw "Receipt check failed: $Field" }
}

$Snapshots = @((& $Restic snapshots --json $SnapshotId) | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $Snapshots.Count -ne 1 -or [string]$Snapshots[0].id -cne $SnapshotId) {
  throw 'Repository did not resolve exactly the selected full snapshot ID'
}
if ((@($Snapshots[0].tags | Sort-Object) -join "`n") -cne (@($Receipt.tags | Sort-Object) -join "`n")) {
  throw 'restic tags differ from the selected receipt'
}
```

Не изменять `$SnapshotId` в последующих шагах. Защита от retention хранится в
`Receipt.protectedUntilUtc`; команда `restic tag` запрещена, потому что создаёт
новый snapshot ID.

## Сценарий 1. Восстановить отдельный файл или объект

Этот сценарий ничего не записывает в production. Результат сначала появляется
в новом каталоге на E:.

### 1. Найти artifact в manifest

```powershell
$ManualRunId = [guid]::NewGuid().ToString('D')
$ManualRoot = "E:\pero-backups\manual-restore\$ManualRunId"
if (Test-Path -LiteralPath $ManualRoot) { throw 'Fresh restore directory already exists' }
New-Item -ItemType Directory -Path $ManualRoot | Out-Null

& $Restic restore $SnapshotId --target $ManualRoot --include ([string]$Receipt.manifestPath)
if ($LASTEXITCODE -ne 0) { throw 'Manifest restore failed' }

if ([string]$Receipt.manifestPath -cnotmatch '^/([A-Za-z])/(.+)$') {
  throw 'Unsupported manifest path in receipt'
}
$ManifestPath = Join-Path $ManualRoot $Matches[1]
foreach ($Part in ($Matches[2] -split '/')) { $ManifestPath = Join-Path $ManifestPath $Part }
if ((Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$Receipt.manifestSha256) {
  throw 'Restored manifest hash mismatch'
}
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ([string]$Manifest.runId -cne $BackupRunId -or [string]$Manifest.status -cne 'validated' -or -not [bool]$Manifest.coverage.complete) {
  throw 'Manifest identity or coverage is invalid'
}

$Manifest.components |
  ForEach-Object {
    $ComponentId = $_.id
    $_.artifacts | ForEach-Object {
      [pscustomobject]@{ Component=$ComponentId; RelativePath=$_.relativePath; Type=$_.artifactType; Bytes=$_.bytes; Sha256=$_.sha256 }
    }
  } | Format-Table -AutoSize
```

### 2. Восстановить один выбранный artifact

Указать ровно один `component.id` и один `artifact.relativePath` из выведенного
manifest:

```powershell
$ComponentId = '<component-id>'
$ArtifactRelativePath = '<exact-relativePath-from-manifest>'
$Components = @($Manifest.components | Where-Object { [string]$_.id -ceq $ComponentId })
if ($Components.Count -ne 1) { throw 'Component must match exactly once' }
$Artifacts = @($Components[0].artifacts | Where-Object { [string]$_.relativePath -ceq $ArtifactRelativePath })
if ($Artifacts.Count -ne 1) { throw 'Artifact must match exactly once' }
$Artifact = $Artifacts[0]

$RunPrefix = ([string]$Receipt.manifestPath).Substring(0, ([string]$Receipt.manifestPath).LastIndexOf('/'))
$ResticArtifactPath = "$RunPrefix/$ArtifactRelativePath"
& $Restic restore $SnapshotId --target $ManualRoot --include $ResticArtifactPath
if ($LASTEXITCODE -ne 0) { throw 'Artifact restore failed' }

if ($ResticArtifactPath -cnotmatch '^/([A-Za-z])/(.+)$') { throw 'Unsupported artifact path' }
$ArtifactPath = Join-Path $ManualRoot $Matches[1]
foreach ($Part in ($Matches[2] -split '/')) { $ArtifactPath = Join-Path $ArtifactPath $Part }
if ((Get-Item -LiteralPath $ArtifactPath).Length -ne [int64]$Artifact.bytes -or
    (Get-FileHash -LiteralPath $ArtifactPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$Artifact.sha256) {
  throw 'Restored artifact size or hash mismatch'
}
```

Для `config-tar` сначала только просмотреть список:

```powershell
& tar.exe -tf $ArtifactPath
if ($LASTEXITCODE -ne 0) { throw 'Archive listing failed' }
```

После проверки отсутствия absolute/`..` entries извлечь один точный путь в ещё
один новый каталог на E::

```powershell
$ExtractRoot = "E:\pero-backups\manual-restore\$ManualRunId-extracted"
$ArchiveEntry = '<exact-reviewed-entry-from-tar-list>'
if (Test-Path -LiteralPath $ExtractRoot) { throw 'Extract target must be fresh' }
New-Item -ItemType Directory -Path $ExtractRoot | Out-Null
& tar.exe -xzf $ArtifactPath -C $ExtractRoot -- $ArchiveEntry
if ($LASTEXITCODE -ne 0) { throw 'Single archive entry extraction failed' }
```

Не распаковывать архив поверх `C:\`, `/`, `/etc`, `/opt` или работающего
volume.

`rootfs-zfs`, `dataset-zfs`, PostgreSQL/SQLite dump и Docker image не являются
обычными пользовательскими файлами. Их нельзя открывать или импортировать в
production этим сценарием; перейти к сценарию одного сервиса.

Для одного S3 object сначала найти точные `bucket`, `key`, `versionId`, `size` и
`sha256` в сохранённом `object-manifest`. Затем восстановить S3 в изолированной
среде по сценарию 2 и скачать именно эту версию в новый каталог на E:. В текущей
связанной конфигурации `backup.config.pve-bound.json` DB reference queries уже
подготовлены, но административный S3 version capture ещё не подтверждён;
пока новый complete backup не содержит эти manifests, восстановление
отдельной версии объекта не подтверждено и выполнять его нельзя.

Ожидаемый результат сценария: файл находится только под `$ManualRoot`, его
SHA-256 совпадает с manifest. Копирование в рабочее место выполняется отдельным
осознанным действием после проверки владельцем и резервной копии заменяемого
файла.

## Сценарий 2. Восстановить один сервис

Текущий `restore-full.ps1` не имеет режима одного сервиса и не переключает
production. Поддержанный безопасный путь — проверить выбранный snapshot полным
изолированным восстановлением всех 13 зависимых компонентов, оставить стенд для
диагностики, а затем подготовить новый replacement-сервис. Нельзя вызывать
внутренний adapter против production: adapter contract рассчитан только на
`INFRA_RECOVERY_ISOLATED=1`.

### 1. Проверить runtime генератора

Weekly restore обязан строить layout и plan заново из manifest и payload именно
выбранного snapshot. Статический `LabPlanPath`, связанный с предыдущей копией,
устаревает после изменения image IDs или baseline и для weekly не используется.
`restore-full.ps1` сначала восстанавливает и проверяет все artifact hashes, затем
запускает находящиеся рядом `generate-runtime-layout.py` и
`compile-lab-plan.py`. Они создают `generated-services.json` и `compiled-plan`
в уникальном `E:\pero-backups\reports\<restoreRunId>`.

```powershell
$RestoreScript = [string]$Operations.restore.entrypoint
$PythonPath = [string]$Operations.restore.pythonPath
$RestoreBundleManifest = [string]$Operations.restore.runtimeBundleManifestPath
foreach ($Path in @($RestoreScript, $PythonPath, $RestoreBundleManifest)) {
  if (-not [IO.Path]::GetFullPath($Path).StartsWith('E:\', [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Pinned restore runtime file is missing or outside E: $Path"
  }
}
if ((Get-FileHash -LiteralPath $PythonPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
    [string]$Operations.restore.pythonSha256) {
  throw 'Python executable hash differs from operations configuration'
}
if ((Get-FileHash -LiteralPath $RestoreBundleManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne
    [string]$Operations.restore.runtimeBundleManifestSha256) {
  throw 'Restore runtime bundle manifest hash differs from operations configuration'
}
```

Runtime bundle manifest обязан закреплять `restore-full.ps1`,
`RestoreSafety.psm1`, оба генератора, `lab-runner.py`, PVE guard scripts и все
`.py`/`.ts`/`.cjs` adapters. `tests` и `__pycache__` в runtime bundle не входят.
Генератор не обращается к live БД, mutable tags или текущим registry images:
layout строится только из уже проверенных immutable metadata выбранной копии.

### 2. Выполнить Validate без создания VM

```powershell
& $RestoreScript -Mode Validate `
  -ReceiptPath $ReceiptPath `
  -GenerateLabPlan `
  -PythonPath $PythonPath `
  -BackupRoot ([string]$Operations.backupRoot) `
  -ResticPath ([string]$Operations.restore.resticPath) `
  -ResticRepository ([string]$Operations.restore.resticRepository) `
  -ResticPasswordFile ([string]$Operations.restore.resticPasswordFile)
if ($LASTEXITCODE -ne 0) { throw 'Restore validation failed' }
```

`RESTORE_VALIDATED` означает только проверку receipt, snapshot, manifest,
artifact hashes и plan. Это не восстановление сервиса и не зелёный restore в
Kuma.

### 3. Проверить целевой PVE и выполнить полный изолированный Execute

До запуска владелец сверяет по консоли/инвентарю hostname, management address,
host key, storage, свободные ресурсы и SHA-256 `qm config` template. Адрес сам по
себе не доказывает правильный узел.

```powershell
$SshConfig = [string]$Operations.paths.sshConfig
$SshPrivateKey = [string]$Operations.paths.sshPrivateKey
$SshExecutable = [string]$Operations.paths.sshExecutable
$PveTarget = [string]$Operations.restore.pveTarget
& $SshExecutable -F $SshConfig -i $SshPrivateKey -o BatchMode=yes -o StrictHostKeyChecking=yes -- `
  $PveTarget 'hostname; pveversion; pvesm status; qm list'
if ($LASTEXITCODE -ne 0) { throw 'PVE identity/preflight failed' }

& $RestoreScript -Mode Execute `
  -ReceiptPath $ReceiptPath `
  -GenerateLabPlan `
  -PythonPath $PythonPath `
  -BackupRoot ([string]$Operations.backupRoot) `
  -ResticPath ([string]$Operations.restore.resticPath) `
  -ResticRepository ([string]$Operations.restore.resticRepository) `
  -ResticPasswordFile ([string]$Operations.restore.resticPasswordFile) `
  -PveTarget $PveTarget `
  -TemplateVmId ([int]$Operations.restore.templateVmId) `
  -TemplateConfigSha256 ([string]$Operations.restore.templateConfigSha256) `
  -RecoveryStorage ([string]$Operations.restore.recoveryStorage) `
  -IsolatedBridge ([string]$Operations.restore.isolatedBridge) `
  -BridgeAddress ([string]$Operations.restore.bridgeAddress) `
  -GuestAddress ([string]$Operations.restore.guestAddress) `
  -GuestPrefixLength ([int]$Operations.restore.guestPrefixLength) `
  -SshConfigPath $SshConfig `
  -SshPrivateKeyPath $SshPrivateKey `
  -SshPublicKeyPath ([string]$Operations.restore.sshPublicKeyPath) `
  -KeepLab
if ($LASTEXITCODE -ne 0) { throw 'Full isolated restore failed; preserve report and owned VM' }
```

Успех — только строка `RESTORE_OK` и
`E:\pero-backups\reports\<restoreRunId>\restore-report.json` со статусом
`passed`, тем же `$SnapshotId`, успешной изоляцией и всеми фазами
`preflight/restore/verify` для 13 компонентов. Проверка выбранного сервиса
считается успешной только по его exact assertions; порт, process или HTTP login
page недостаточны.

```powershell
$RestoreRunId = '<uuid-from-RESTORE_RUN>'
$ReportPath = "E:\pero-backups\reports\$RestoreRunId\restore-report.json"
$Report = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json
$RequiredComponents = @('proxmox','crm','staging','nas','s3','vaultwarden','cms','cms-workers','cms-preview','telegram-bot','vps','kuma','sites')
if ([string]$Report.runId -cne $RestoreRunId -or [string]$Report.backupRunId -cne $BackupRunId -or
    [string]$Report.snapshotId -cne $SnapshotId -or [string]$Report.status -cne 'passed' -or
    [string]$Report.isolation.status -cne 'passed' -or @($Report.errors).Count -ne 0 -or
    @($Report.components).Count -ne $RequiredComponents.Count) {
  throw 'Restore report identity, isolation or status failed'
}
foreach ($ComponentId in $RequiredComponents) {
  $ComponentMatches = @($Report.components | Where-Object { [string]$_.id -ceq $ComponentId })
  if ($ComponentMatches.Count -ne 1 -or [string]$ComponentMatches[0].status -cne 'passed') {
    throw "Component failed or is duplicated: $ComponentId"
  }
  foreach ($Phase in @('preflight','restore','verify')) {
    if ([string]$ComponentMatches[0].phases.$Phase.status -cne 'passed') {
      throw "Component phase failed: $ComponentId/$Phase"
    }
  }
  if (@($ComponentMatches[0].assertions).Count -eq 0 -or
      @($ComponentMatches[0].assertions | Where-Object { $_.passed -ne $true }).Count -ne 0) {
    throw "Functional assertions failed: $ComponentId"
  }
  foreach ($Assertion in @($ComponentMatches[0].assertions)) {
    if (($Assertion.expected | ConvertTo-Json -Compress -Depth 16) -cne
        ($Assertion.actual | ConvertTo-Json -Compress -Depth 16)) {
      throw "Functional assertion is not exact: $ComponentId/$($Assertion.name)"
    }
  }
}
```

### 4. Подготовить replacement и вернуть сервис в работу

Последовательность всегда такая:

1. Создать новый target с новым временным адресом и без production routes,
   shared mounts, cron, рассылок, публикаций, NetBird identity и Telegram
   polling.
2. Восстановить storage/dataset и права, затем database/SQLite, затем
   конфигурацию.
3. Выполнить `docker load` сохранённого image artifact и сверить
   `docker image inspect sha256:<64-hex>`. Запускать только `imageId`, записанный
   в manifest; `main` и `latest` запрещены.
4. Выполнить service-specific functional assertions из manifest на временном
   адресе.
5. Остановить старый endpoint, получить явное решение владельца на cutover,
   переключить адрес/маршрут и повторить functional assertions.
6. Сохранить старый сервис выключенным для отката. Не удалять его до отдельного
   подтверждения.

Автоматизированной команды шагов 1–5 для одного production-сервиса пока нет.
Поэтому полный лабораторный `RESTORE_OK` разрешает подготовку replacement, но не
самовольный production cutover.

После диагностики лабораторную VM удаляет только UUID-owned cleanup:

```powershell
& $RestoreScript -Mode Cleanup `
  -BackupRoot ([string]$Operations.backupRoot) `
  -CleanupStatePath 'E:\pero-backups\reports\<restoreRunId>\resource-state.json' `
  -SshConfigPath $SshConfig `
  -SshPrivateKeyPath $SshPrivateKey
if ($LASTEXITCODE -ne 0) { throw 'Owned lab cleanup failed; do not delete a VM manually' }
```

Cleanup принимает только resource-state с UUID-маркерами и динамическим VMID.
Он не использует и не уничтожает фиксированный CT/VMID.

## Сценарий 3. Восстановить всю инфраструктуру после потери Proxmox

`restore-full.ps1` — изолированный тестовый runner на существующем внешнем PVE,
а не bare-metal installer и не production cutover tool. После полной потери PVE
автоматической end-to-end команды сейчас нет. Следующий порядок обязателен; на
каждом шаге сохранять команды, exit codes, hashes и фактический результат.

### 1. Поднять базовый Proxmox и storage

1. По физической консоли сверить сервер, диски, контроллеры и выбранный
   management address. Не выполнять destructive install по одному IP/hostname.
2. Установить закреплённую версию Proxmox с проверенного офлайн-носителя.
3. Восстановить storage topology, ZFS properties и только затем импортировать
   raw encrypted streams. Получить ZFS keys из независимой офлайн-копии, не из
   ещё не восстановленного Vaultwarden.
4. Проверить `zpool status`, dataset encryption/key status, mountpoints,
   owners/ACL и checksums до создания приложений.

Точные destructive команды разметки дисков, `zpool create/import` и `zfs
receive` нельзя универсализировать: они должны быть составлены по проверенному
manifest и фактическим новым дискам. Полный owner inventory от 15.09.2026
подтвердил один key path `/root/.zdata.key` для трёх encryption roots
`zdata/nas`, `zdata/s3`, `zdata/vault`. Это подтверждение пути, а не наличия
проверенной офлайн-копии ключа или успешного восстановления. Отдельная rehearsal
и независимое получение ключа остаются обязательными.

### 2. Восстановить сеть в закрытом режиме

Восстановить bridges, VLAN/firewall и management SSH без включения public
routes. Сначала `known_hosts` и проверка host key с консоли, затем доступ с
recovery-компьютера. Production WireGuard/NetBird identities, port forwards и
VPS routes остаются выключенными, пока данные и приложения не проверены.

### 3. Восстановить данные и базы

Порядок данных:

1. shared ZFS datasets NAS/S3/Vaultwarden;
2. MinIO data, versioning, IAM/policies и object-version manifests;
3. NAS files, numeric owners, ACL/xattrs, Samba/Filebrowser configuration;
4. PostgreSQL dumps CRM, staging и CMS и SQLite backups Vaultwarden/Kuma;
5. release/media artifacts и фактически опубликованные site artifacts.

Каждый artifact сначала восстанавливается из `$SnapshotId` в новый путь на E:
как в сценарии 1 и сверяется по `bytes`/SHA-256. Затем он переносится на новый
закрытый target. Не восстанавливать dump поверх работающей production database.

### 4. Восстановить приложения сохранёнными image IDs

Загрузить сохранённые image tar только после storage и databases. Для каждого
component использовать `manifest.components[].images[].imageId` вида
`sha256:<64-hex>` и сверить его после `docker load`. Mutable source tag в
manifest служит только происхождением. Порядок запуска:

1. S3, NAS и Vaultwarden dependencies;
2. CRM и staging;
3. CMS, release/media workers и preview;
4. Telegram bot с polling наружу выключенным;
5. сохранённые published site artifacts;
6. VPS/Kuma в закрытой сети.

На закрытых адресах выполнить exact assertions из manifest. Для worker нужны
heartbeat и выполненное изолированное queue job; для Telegram — fake Telegram
simulation и CRM health; для S3 — чтение конкретных versions с SHA-256.

### 5. Вернуть VPS, публичные маршруты и monitoring

После проверки данных и приложений восстановить Caddy, WireGuard/firewall и
Kuma. Проверить маршруты внутри закрытого стенда. Затем по одному
включить public endpoints, повторить login/file/media/site probes с внешней
сети и только после этого включить Telegram polling, workers, production cron и
уведомления. Kuma становится зелёной только после фактических probes и полного
restore-report; UFW rule, listener или container state недостаточны.

Старый/аварийный storage и offline backup сохранять до успешной приёмки и
проверки отката.

## Что ещё необходимо проверить фактически

До статуса «инструкция проверена» остаются обязательные gaps:

- выполнить новый полный backup и получить `BACKUP_OK`, complete receipt и
  один неизменяемый 64-hex snapshot ID;
- использовать полный owner inventory от 15.09.2026 и закончить три оставшиеся
  группы binding: S3 versions/IAM/config, фактические published artifacts и
  offline ISO/template receipts; при будущем capture заново зафиксировать
  согласованные baselines, object versions и точные saved image IDs;
- создать и проверить чистый nested-Proxmox template; подготовительные скрипты
  из `restore/TEMPLATE.md` ещё не запускались на реальном target;
- выполнить автоматическую генерацию layout/plan из фактического manifest и
  проверить сохранённые `generated-services.json` и `compiled-plan`;
- выполнить `Validate`, полный `Execute -KeepLab`, проверить все 13 компонентов
  и безопасный UUID-owned `Cleanup`;
- провести отдельную rehearsal восстановления файла, S3 object version, одного
  сервиса и bare-metal PVE на изолированных носителях;
- проверить получение restic password и каждого ZFS key с независимой офлайн-
  копии без Vaultwarden;
- выполнить owner-side проверки доступа до/после, включая реальный внешний
  маршрут, NetBird/Windscribe и Kuma; сетевые правила сами по себе не являются
  результатом;
- только после всех проверок активировать новые Windows tasks и обновить эту
  инструкцию точными подтверждёнными командами production cutover.

Временный `docs/INFRA_RECOVERY_PLAN_TEMP.md` до выполнения всех условий не
удалять.
