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

Root разрешил локальный commit №226 и обычный merge принятого `origin/staging` `a632e1e36326c61f157d3de5d506e533fe0b3ff2` для подготовки. На этом этапе staging-пункт оставался pending; публикацией и интеграцией управлял root.

## CI fixture и финальная staging-приёмка

На предыдущем CI cut `fa614229` native mutation-сценарий остановился на `CI133_WRITE_STOP`: прежний fixture разрешал только advisory lock и не учитывал новые точные metadata reads. В `9607a8f1` разрешены исключительно Work lookup с собственным `workId` и User lookup текущего собственного actor. Новый payroll audit разрешён только для ID фактически созданной fenced PayrollEntry, с проверкой raw привязок/суммы и System/инициатора. Readonly proof, точные receipt guards и пять partial rollback сценариев сохранены; добавлена явная проверка отката payroll audit. Guard/regression **9/9 PASS**, TSC/lint PASS; история первоначального отказа не заменяет успешную проверку.

- Фактически развёрнутый SHA: `e3f99ff05b97f3999fc8fbf74472e9077d769a3b`. Штатный [CI 43796217344](https://github.com/navasiolau/pero_crm/actions/runs/43796217344): **7/7 SUCCESS**.
- Web image: `sha256:7a08b609684a03aad93249ca9f190ef688571fbe5de2b3bd163a6443dba0cc2a`; renderer: `sha256:8fb1087afd508f9506952c4b16279adeccc7a27df353472eff485edf7770a19f`. Root подтвердил оба healthy и HTTP 200.
- Сохранены DB container `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, start `2026-11-10T18:42:15.758341834Z`, volume `crm-staging_pgdata`, W07 SHA `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139`.
- Прочитан root receipt [stage-final226b.response.private.json](D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/stage-final226b.response.private.json): `exitCode=0`, `status=PASS`, `kind=staging`, `rollback=true`, `auditCountPreserved=true`. SHA-256 receipt: `f015b115c391055a136cf72c2eafad8a26fb618ca030fe0fb99d46d6144838b6`; bundle SHA-256: `5b2eb0240fb660bf1c0271178d434efd60eeabf78d6351e00da49c2dbc398a86`.
- Подтверждены все проверки receipt: `work-full-diff`, `task-create`, `system-payroll`, `payroll-replay`, `file-metadata`, `file-detach`, `dependent-task-audit`, `file-delete-replay`, `deleted-assignee-label`, `split-cross-owner-dependencies`, `split-replay-money`, `delete-audit-rollback`.
- Перед rollback выполнен `SET CONSTRAINTS ALL IMMEDIATE`; собственные тестовые строки откатились. Перед финальными native-проверками: raw audit count **5529**, hash `64bcf0448dabe8e594a5ffa37da4aa1a`. [final-refresh-state.json](D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/final-refresh-state.json) на том же SHA подтверждает `scanned=5529`, `updated=5529`, `rawVerified=5529`, `remaining=0`; исходные события сохранены.

Ранний standalone QA bundle отказал до выполнения: отсутствовал `next/cache.js`, хотя приложение использует скомпилированные Next chunks. QA-only import alias бросает ошибку при вызове `revalidatePath`; `beforeExit` дополнительно завершает процесс с ошибкой при ненулевом счётчике. В успешной приёмке вызовов **0**, production-код не изменялся. Это DB/core proof, а не проверка Next cache invalidation.

Принята DB/core часть №226. Финальные браузерные сценарии и авторизация №228 остаются отдельной приёмкой root; настоящая запись их не объявляет завершёнными. Закрытые legacy time/share interfaces и внешние cleanup-процессы не запускались.
