# Evidence

## Implementation

№126/change согласован владельцем, `bugfix/126` от `9fd7457553dee69f4331d6b0e33cf8cd0997a12f`. Прочитаны proposal/design/spec/tasks, implementation 2.1–2.3 завершена. Commit/merge/push/CI и staging выполняет оркестратор.

`captureDirectPercentage` сохраняет отсутствие назначенного получателя как `SKIPPED_ONCE` с общей постоянной причиной «Сотрудник не назначен при завершении», NULL получателем/ставкой/суммами и без долей/PayrollEntry. Такой пропуск обнаруживается в `captureProductPercentageCompletion` и `settleSkippedPercentage` до позднего расчёта. Прежний пропуск ставки сохраняет свой поздний расчёт; legacy PENDING_FX и уже оплаченные snapshots/adjustments не переписываются. Ролевые правила смены статуса и валидация явно назначенного неактивного/неподходящего получателя сохранены.

Отдельная `20261010200000_product_status_optional_assignees` заменяет existing immutable function, добавляя одно исключение постоянной причины из разрешённого SKIPPED_ONCE→SETTLED. Root проверил побайтовое совпадение остальных условий с прежней функцией и применил SQL на проверенном existing local PostgreSQL. Applied SQL, схема статусов и исторические строки не изменялись.

## Local acceptance — 10.10.2026

Единственный согласованный общий сценарий в реальном `127.0.0.1:5433/pero_crm` завершился PASS за 2,5 секунды. `existingLocalCrmDatabaseUrl` проверяет контейнер `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, host binding, имя БД и пользователя; пароль остаётся в памяти.

Точная команда в PowerShell:

```powershell
$env:CRM_LOCAL_CONTAINER_ID = 'bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5'
pnpm --filter @pero/web exec tsx tests/product-status-optional-assignees-native.ts
```

Один shared `runOptionalAssigneesAcceptance` проверяет все три отсутствующих назначения и переходы до DONE, отсутствие фактических начислений и долей, позднюю цену без оплаты пропуска, передачу без предсборки и поздние назначения инженера/сборщика, одно начисление монтажнику 100 BYN при DONE, повтор/возврат статуса без дублей, immutable SQL-запрет нового permanent skip→SETTLED, прежний late settle назначенному инженеру 25 BYN и сохранность прав работника. Общая зарплатная экономика собственного QA-проекта — 125 BYN. Все собственные пользователи/клиент/проект/изделия и финансовые записи находились во внешней rollback tx; семь исходных счётчиков совпали после её завершения. Файлов/storage/уведомлений не создавалось.

При подготовке исправлены две конкретные ошибки QA setup: entry предполагал отсутствующий `.env.local`, затем fixture не задавал обязательный `Client.phone`. После этих ошибок тот же сценарий продолжен с существующим guarded helper и собственным значением QA126; незавершённые транзакции откатились. Дополнительных сценариев, full suites/typecheck/lint/build и локальных unit-прогонов не выполнялось. Регрессии в `single-product-percentage-core.test.ts` подготовлены для полного существующего CI.

## Staging preparation

`product-status-optional-assignees-staging.ts` вызывает тот же shared scenario, принимает только base64(JSON) input с `operation=prepare` и SHA40, требует `S3_BUCKET=pero-crm-staging` и `current_database()=crm` до writes. Root wrapper отдельно проверяет фактическую identity/revision/health/W07. Entry выполняет outer rollback и выводит один safe JSON PASS либо фиксированный FAIL-код без error text/stack/PII/DSN. Исполнитель staging-entry не запускал.

Физическое удаление browser-own QA product после появления даже SKIPPED snapshot запрещено существующим FK RESTRICT и append-only DELETE guard. Эти гарантии сохранены. Root выбрал собственную QA-карточку с архивированием и сохранением skipped completion/actor до штатного nightly refresh; отдельный ignored lifecycle helper принадлежит root, не этому исправлению.

## Pending

3.1–3.2 остаются открыты: commit/ordinary merge, полный неизменённый CI по точному SHA и приёмка фактического staging, включая перетаскивание в интерфейсе. Main/production этим исправлением не выпускались.
