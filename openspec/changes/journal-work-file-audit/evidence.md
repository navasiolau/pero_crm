# Проверка №226

- Worktree `journal-226`, ветка `bugfix/226`, исходный staging `26f1d12ab131e673930475f30203e35797a062ce` с №221.
- RED: два новых сценария загрузки и разделения начисления воспроизвели отсутствующие presentation.
- GREEN: пять новых поведенческих сценариев: file metadata/replay, split payroll/System, exact old/new owner contexts, task delete audit rollback/file detach, оба actual cover-delete caller с полными file metadata.
- Целевые suites работ, распределений, переназначений и файлов прошли 36/36; последующая проверка исправленных mock-адаптеров и бизнес-гарантий — 24/24.
- Первый полный web прогон: 1464 PASS / 3 FAIL; все три отказа были прежними DI adapters без новых read-only metadata queries. Добавлены их минимальные query/update shapes, прежние бизнес-assertions сохранены.
- Последующий полный web прогон: **1469/1469 PASS**, 0 failed/skipped/cancelled, 85.98 с. После добавления теста cover-delete запущен итоговый полный прогон.
- Итоговый полный прогон после всех уточнений metadata и cover-delete: **1470/1470 PASS**, 0 failed/skipped/cancelled, 81.92 с; `.playwright-mcp/journal-226/full-web-tests-reviewed.log`.
- Полная TypeScript-проверка, ESLint всех изменённых TS/новых helpers/tests, `git diff --check` и `openspec validate journal-work-file-audit --strict` — PASS.
- Native helper `tests/helpers/journal-226-native.ts` принимает только caller-supplied transaction и явные runId/database/rollbackOnly. Вызывает реальные work create/update, worker allocation, completion, file upload/delete и task delete. Проверяет System payroll, replay, file detach, удаление входящей зависимости и audit fault rollback через SAVEPOINT. Сетевые запросы, storage cleanup и внешние уведомления не вызываются.
- Native helper самим агентом не запускался; target guards, isolated runtime и staging приёмку выполняет root.
- Production, restic, чужие данные и инфраструктура не изменялись; публикацию и merge в staging выполняет root.

## Исправления по независимому review

- RED воспроизвёл оба замечания: split не создавал событий изменённых зависимостей у другого изделия/общей задачи, а удаление задачи показывало UUID исполнителя.
- Split сохраняет before snapshots под уже удерживаемым общим task mutex, без новых row locks. После прежнего `createMany` читает фактические зависимости; только реальный diff создаёт System событие с инициатором и собственным контекстом затронутой задачи. Первичный receipt, суммы и существующий outbox не изменены.
- Перед удалением задачи снимается `journalUserReferences` исполнителя и добавляется в links.
- Regression проверяет оба контекста, полные old/new dependencyIds, отсутствие дублей при replay, 700+300 и имя исполнителя после удаления. Targeted: **24/24 PASS**.
- Native helper дополнен actual split с зависимыми задачами другого изделия/общего проекта, проверками exact raw before/after, System/initiator/context, raw receipt replay, 75+25 и имени исполнителя удалённой задачи. Самостоятельно не запускался.
- Полный web после review fixes: **1471/1471 PASS**, 0 failed/skipped/cancelled, 91.29 с; `.playwright-mcp/journal-226/full-web-review-fixes.log`.
- Повторные TSC и scoped ESLint — PASS.

## Root native и подготовка интеграции

Root подтвердил финальный local native226 PASS на PostgreSQL с `SET CONSTRAINTS ALL IMMEDIATE` перед rollback: работа, создание/завершение задач, System начисление, replay, файлы/отвязка, входящие зависимости, имя удалённого исполнителя, split между контекстами, деньги и audit rollback. Все собственные строки откатились, общий audit count сохранился. Evidence root: `local226-complete.stdout.private.log`.

Root разрешил локальный commit №226 и обычный merge принятого `origin/staging` `a632e1e36326c61f157d3de5d506e533fe0b3ff2` для подготовки. Push и merge в staging выполняет root после предшествующей приёмки; staging-пункт остаётся pending.
