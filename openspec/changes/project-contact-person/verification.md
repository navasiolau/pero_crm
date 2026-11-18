# Verification

Дата: 18.11.2026, Europe/Moscow. Ветка `feature/235`, отдельный worktree `D:/Projects/pero_crm_worktrees/project-contact-person-235`, исходный `origin/staging` — `81ec6e8589a057afd00e8bf076fdd332ee7cc5e1`.

## Result

Реализованы отдельное контактное лицо проекта и галочка клиента с правами ADMIN/DIRECTOR/MANAGER. ФИО подставляется при создании проекта и включении галочки в пустые неудалённые проекты. Сохранённый текст не меняется вслед за ФИО или снятием галочки. Подтверждённая смена клиента заменяет текст согласно настройке нового клиента, включая ручное значение.

## Local checks

| Проверка | Результат |
|---|---|
| Prisma validate / generate | PASS, Prisma 6.19.3; зависимости и lockfile сохранены |
| TypeScript strict | PASS: `pnpm --filter @pero/web exec tsc --noEmit --incremental false` |
| ESLint | PASS, 0 ошибок; 4 существующих предупреждения в cleanup-uploads.ts, product-attachments.tsx и product-percentage-pay/core.ts |
| Production build | PASS: `pnpm build`; standalone-артефакт только локальный |
| Контактные контроллеры и настоящие компоненты | PASS, 37/37: ожидание ACK, отказ и конфликт, неверный исходный клиент, поздняя проекция, null после очистки, галочка и baseline |
| Визуальный просмотр | PASS: телефон и контактное лицо рядом на 1440 px, друг под другом на 390 px; горизонтального overflow нет. Галочка доступна в мобильном редакторе клиента |
| PostgreSQL/runtime | PASS, 12 групп сценариев и межсоединенческий coordinator; см. ниже |
| Полный набор web | Итоговый повтор: **1565/1565 PASS**, 0 ошибок, 0 skips, 82.258 с. Первый прогон 1564/1565: уведомление перекрыло кнопку «Проверить» в существующем task-status-command.browser.test.ts; отдельный повтор файла 9/9 PASS. Исходный лог сохранён |
| OpenSpec strict | PASS |

## Database and preservation

Использован существующий local PostgreSQL `pero_crm_pg`, container ID `bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5`, `127.0.0.1:5433`, БД `pero_crm`, schema `public`, роль `pero`. Проверены container identity, port binding, database/schema/user. Перед миграцией pending была только `20261118090000_project_contact_person`; применена штатным `prisma migrate deploy`.

Native-проверка создала только собственные синтетические записи внутри одной interactive-транзакции с обязательным rollback. Проверены создание из формы и КП, включение галочки, сохранность ручного текста и удалённых проектов, изменение ФИО, очистка, отключение, смена и повторный выбор клиента, CAS/replay, права, совместимость старого input без флага. Ошибка аудита проверена реальным SQL SAVEPOINT/ROLLBACK: клиент, проекты и журнал возвращаются к исходному состоянию.

Общий coordinator проверен на двух соединениях: вторая операция не входит до завершения первой. Полный snapshot строк/constraints/functions/triggers/indexes совпал до и после сценариев: digest `45c96420c8f84f7d2e06627c2dc8c354b8ed59f6bab1387d8e5e0dd8000da61f`. Миграция остаётся единственным целевым изменением local БД; reset, seed и дампы не выполнялись. Restic и production не использовались. Контейнер до начала работ был остановлен; после QA остановлен по точному ID, readback `exited` подтверждён.

Повторяемый native-сценарий: [project-contact-person-native.ts](../../../apps/web/tests/helpers/project-contact-person-native.ts); тот же сценарий включён в guarded CI `domain-postgres.test.ts`.

## Evidence

- Native receipt: `.playwright-mcp/task-235/native-result.json`.
- Логи: `.playwright-mcp/task-235/{lint,build,web-tests,task-status-recheck,web-tests-final}.log`.
- Скриншоты реальных компонентов: `apps/web/test-results/project-contact-person/{1440,390}.png` и `apps/web/test-results/client-passport-details/mobile-dark-editor-footer.png`.
- Снимки и логи хранятся только локально в ignored-каталогах; синтетические имена и данные.
- Проверки и SHA256 проверенных исходников: `local-acceptance.json` и `local-code-manifest.json` рядом с этим отчётом. Это uncommitted working tree от указанного base SHA, не staging-релиз.

## Release boundary

Первоначальная local-проверка завершена 18.11.2026. По прямому поручению 19.11.2026 выполнены коммит, push, обычные merge и штатная staging-миграция. **Staging ACCEPTED `cbf498ec5586b847563a6fffd125e95b295a432a`**, CI №401 7/7 SUCCESS, реальные migration/native/browser и сохранность прежних данных подтверждены в [staging-acceptance.md](staging-acceptance.md) и JSON рядом. Исторический local-acceptance.json описывает состояние до коммита; текущий статус выпуска находится в staging receipt. Production не выпускался; его миграция согласуется отдельно по AGENTS.md.
