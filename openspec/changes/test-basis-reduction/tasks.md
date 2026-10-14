# Tasks

## 1. Scope

- [x] 1.1 До удаления согласовать точный allowlist и `reduction-map.md`: для каждого файла/блока проверить существующую сохраняемую замену и её уровень доказательства.

## 2. Reduction

- [x] 2.1 Удалить только согласованные перекрытия и осиротевшие helpers; проверить абсолютные пути/reparse points, ссылки и targeted retained suites.
- [x] 2.2 Обновить затронутые живые ссылки существующей контрактной карты; `coverage-baseline.mjs --check` должен проходить.

## 3. Verification

- [x] 3.1 Один раз выполнить полный автоматический web-прогон, typecheck/lint и OpenSpec validation; записать команды и фактические результаты в `verification.md`.
- [x] 3.2 Измерить в том же tracked-text scope чистое уменьшение строк, файлов и suites; `git diff` должен показывать отсутствие runtime/Prisma/lockfile/dependency изменений.

## 4. Acceptance

- [x] 4.1 Получить независимое review карты и diff, устранить подтверждённые замечания; сохранить результат в `verification.md`.
- [x] 4.2 После обычного merge подтвердить CI и реально развёрнутый staging SHA/образ/здоровье, выполнить GET-only smoke; записать фактическую приёмку.

## 5. Owner refinement: 50 percent

- [x] 5.1 До удаления дополнить карту точными блоками, retained действующими business/data/security/UI contracts либо exact cause obsolete QA-selftest/тавтологии/always-green/постоянного skip; для CLI проверить closed-task/current-consumer/operator evidence, согласовать границы параллельных edits. Unique assert закрытого helper не требует новой замены. A–J literal map/source GO подтверждены финальной ce0679 приёмкой.
- [x] 5.2 Удалить подтверждённые obsolete/непроверяющие QA-selftests и консолидировать повторяемые test/QA/native setup и fixture lifecycle через существующие helpers или малый общий runner с чистым сокращением строк; сохранить действующие money/ACL/CAS/idempotency/rollback/S3/browser/target/ownership/cleanup условия и уровень доказательства, сопоставить и фактически выполнить перенесённые cases действующего приложения до снятия прежнего контура. Independent A–J GO/CI25773 native PASS; receipt delivery-final168-170-ce0679c7/acceptance.json.
- [x] 5.3 Достичь web не более 32 361 и совокупно не более 34 831 строк от исходной базы 64 722/69 662 в неизменном tracked-text scope с включением всего добавленного test/QA кода, общего runner и перенесённых cases; подтвердить отсутствие minify, уплотнения строк, скрытия кода из счётчика, runtime/Prisma/package/lock/dependency изменений. Exact committed ce0679 census: web32 361/50%, ALL33 669/51,67%; новые outside205 LF учтены.
- [x] 5.4 Проверить live refs и контрактную карту; после всех edits один раз выполнить итоговые автоматические suites, typecheck/lint и OpenSpec validation, записать реальные результаты. ONE local1513 PASS/1 CSS SKIP, types/lint/OpenSpec168/170 PASS, coverage19/15/27/288 и CI257 accepted; receipt delivery-final168-170-ce0679c7/acceptance.json.
- [x] 5.5 Получить независимое review сохранности действующих контрактов приложения, точных причин obsolete retirement и итогового diff; после обычного merge подтвердить CI и реально развёрнутый новый staging SHA/образ/здоровье/GET-only smoke. FINAL_GO_168_ACTUAL: ce0679/CI257 all6SUCCESS, exact image/DB/W07/GET200/lab cleanup accepted.

## 6. Продолжение оптимизации — согласовано 14.10.2026

- [x] 6.1 Зафиксировать точные удаления/переносы повторных auth/UI/payment/file и bot checks, orphan helpers, тавтологий и закрытых migration/watcher веток; сохранить действующие business/data/security/provenance условия. Literal map записана до удаления; warehouse Root/independent PIN_GO и exact surviving bodies подтверждены. Новая runtime/staging приёмка относится к 6.4.
- [x] 6.2 Выполнить согласованные удаления/консолидацию и усилить существующие UI tests Enter/Tab/composition/checkbox filters; warehouse guards изменять только после подтверждённого переноса. Root PIN_GO/exact canonical bodies и existing56/18/26 suites PASS; CI260 web1472/native85 PASS, authenticated E2E list8 только NOT_RUN/runtime.
- [x] 6.3 Дополнить существующую карту реализованных функций действующими сценариями №168/169, явно отделить автоматическое/ручное покрытие и пробелы; измерить все строки/файлы/независимые сценарии без изменения scope. Matrix23 contracts/14 dispositions и14 feature directions; exact259f census web32296/64722 (50,10042953%), prefix33373+outside207=ALL33580/69662 (51,79581407%),453 prefix files/286flat. Нового100% coverage claim нет.
- [x] 6.4 После freeze пройти affected suites и один итоговый local прогон/types/lint/OpenSpec, независимое review и один обычный CI; принять exact staging SHA/image/health/GET и cleanup, main/production не затрагивать. Local/full+source review PASS; после factual failure258/259 исправлены test-only callers/fixtures, CI260 all6SUCCESS/85 native/owned cleanup и actual259f stage image/DB/W07/GET200 приняты Root ACTUAL_STAGE_GO и независимым FINAL_GO_STAGE_259f8447. Receipt refinement-delivery-259f8447/acceptance.json; tracking local WIP без docs-only push/CI.

## 7. Следующее согласованное сокращение — DONE (CI266/61f9)

- [x] 7.1 До удаления записать FULL literal pure/browser/manual/native allowlists и old→retained case IDs, levels, closed causes и last-consumer closure; сохранять actual named cases, без квоты/100% claim.
- [x] 7.2 Консолидировать согласованные existing pure-domain/browser CSS suites с exact bodies/isolation; кандидат может удалить только mapped old manual/mock contours после source case mapping/local proof, сохранив действующие guards/warehouse recovery. Финальная замена принимается только по actual native/HTTP PASS №169 в общем required CI; отдельный before-delete CI не требуется, failure блокирует deploy и сохраняет прежний принятый staging.
- [x] 7.3 После freeze обновить существующие matrix/README/maps, измерить ALLnew-inclusive строки/файлы/actual cases, пройти один итоговый набор проверок/review/обычный CI и actual Stage; historical DONE сохраняются; финальная actual приёмка CI266/61f9 подтверждена.

Финальная приёмка: `FINAL_GO_61f9`, staging61f9bc14/CI266 all6SUCCESS; native91/web1441/bot38/watch53/guards2, FAIL/SKIP0, both parallel0/0 и owned cleanup0. Actual OCI/health/GET200/DB/start/volume/W07 подтверждены, source/main/production unchanged. **196 с, ≤180 NOT_MET**; receipt `.playwright-mcp/application-improvements/dead49-delivery-61f9bc14/acceptance.json`.
