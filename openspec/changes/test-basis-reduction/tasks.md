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

- [ ] 5.1 До удаления дополнить карту точными блоками, retained действующими business/data/security/UI contracts либо exact cause obsolete QA-selftest/тавтологии/always-green/постоянного skip; для CLI проверить closed-task/current-consumer/operator evidence, согласовать границы параллельных edits. Unique assert закрытого helper не требует новой замены.
- [ ] 5.2 Удалить подтверждённые obsolete/непроверяющие QA-selftests и консолидировать повторяемые test/QA/native setup и fixture lifecycle через существующие helpers или малый общий runner с чистым сокращением строк; сохранить действующие money/ACL/CAS/idempotency/rollback/S3/browser/target/ownership/cleanup условия и уровень доказательства, сопоставить и фактически выполнить перенесённые cases действующего приложения до снятия прежнего контура.
- [ ] 5.3 Достичь web не более 32 361 и совокупно не более 34 831 строк от исходной базы 64 722/69 662 в неизменном tracked-text scope с включением всего добавленного test/QA кода, общего runner и перенесённых cases; подтвердить отсутствие minify, уплотнения строк, скрытия кода из счётчика, runtime/Prisma/package/lock/dependency изменений.
- [ ] 5.4 Проверить live refs и контрактную карту; после всех edits один раз выполнить итоговые автоматические suites, typecheck/lint и OpenSpec validation, записать реальные результаты.
- [ ] 5.5 Получить независимое review сохранности действующих контрактов приложения, точных причин obsolete retirement и итогового diff; после обычного merge подтвердить CI и реально развёрнутый новый staging SHA/образ/здоровье/GET-only smoke.
