# Проверка №225

- Исходная ветка: `bugfix/225` от `a391e5f1df7f307905513df7e1d46a10bee09a01`.
- По команде root получена foundation №221 обычным FF merge `origin/staging` → `26f1d12ab131e673930475f30203e35797a062ce`; WIP №225 сохранён, файлы между ветками не переносились.
- RED: три новые поведенческие проверки `journal-business-audit.test.ts` упали на отсутствии presentation и независимого contract snapshot.
- GREEN: те же сценарии плюс fault rollback/no-op Decimal проверены; целевой набор **198/198 PASS**, 0 skipped/cancelled.
- Полная TypeScript-проверка `tsc --noEmit --incremental false` — PASS; ESLint всех изменённых TS и нового native helper — PASS.
- Полный `pnpm --filter @pero/web test` — **1470/1470 PASS**, 0 failed/skipped/cancelled, 92.05 с. Локальный журнал: `.playwright-mcp/journal-225/full-web-tests.log`.
- Подготовлен `tests/helpers/journal-225-native.ts`: caller-supplied transaction, обязательные rollbackOnly/runId/database guards; реальные cores КП, цен, draft promotion, удаления проекта, contract store, replay и audit fault SAVEPOINT. Сеть, renderer, dispatch и отдельное подключение не вызываются.
- Native/helper и staging самим агентом не запускались; runtime-приёмку выполняет root. Публикация и merge в staging остаются за root. Production и restic не затрагивались.

Ниже сохранены этапы локальной проверки, исправления по review и фактическая staging-приёмка.

## Исправление по review

- Обложка из КП: отдельный snapshot имён включает файлы, созданные в текущей транзакции. Реальный `linkProposalProductMediaInTransaction` regression сначала воспроизвёл UUID вместо имени первой картинки, затем подтвердил имя и для первой картинки, и для замены; raw payload события совпадает. `journal-media-cover` + `journal-business-audit`: **6/6 PASS**.
- Native contract fixture: исходный текст имел 2005 символов, тогда как существующий ContractModel ограничивает строку 2000. Продуктовый normalizer не менялся. Fixture использует два допустимых сохранения (исходное условие и новое 1205-символьное), сравнивает `subject` точными прежним/новым значениями. Длинное 2005-символьное примечание КП остаётся в проверке без сокращения.
- По сообщению root обновлённый local native225 прошёл внутри rollback-only транзакции; конкретный receipt и staging-доказательство сохраняет root.
- Повторные TSC и ESLint затронутого media/native regression набора — PASS.

## Покрытие автоматического пересчёта количества

- Root обнаружил отдельный gap: Work quantity/quantityPerUnit/total и ProjectMaterial quantity/quantityPerUnit обновлялись внутри пересчёта без собственных событий.
- Изменены только quantity-core и два caller: обычное изменение изделия и синхронизация КП. Actor передаётся явно; при КП передаётся финальный номер из снимка, а не промежуточный `__kp_sync` номер БД. Формулы, данные updates, guards и порядок locks сохранены.
- RED воспроизвёл отсутствующее событие пересчитанной строки. GREEN проверяет exact raw before/after, System/инициатора, понятные имена, исключительно product context, финальный номер после перестановки, отсутствие события для нулевой неизменившейся нормы, replay и audit rollback. Оба caller выполняются в regression.
- Native helper добавляет только собственные Work, MaterialUnit, Material и ProjectMaterial внутри caller rollback transaction. Проверяет перерасчёт КП 1→2 и ручной 2→3, Work total 20→40→60 при неизменной расценке 10, Material plan 3→6→9 при неизменном issuedQty, точные events и rollback плана/количества/аудита через SAVEPOINT. Самостоятельно не запускался.
- Targeted suites: **37/37 PASS**. Полный web: **1472/1472 PASS**, 0 failed/skipped/cancelled, 79.89 с; `.playwright-mcp/journal-225/full-web-quantity-audit.log`.
- TSC и scoped ESLint — PASS. №226 при этой доработке не изменялся.

## Root native и подготовка интеграции

Root подтвердил финальный local native225 PASS на PostgreSQL с `SET CONSTRAINTS ALL IMMEDIATE` перед rollback, включая нормы количества, сохранность сумм, точные снимки, replay и audit fault. Все собственные строки откатились, общий audit count сохранился. Evidence root: `local225-complete.stdout.private.log`.

Root разрешил локальный commit №225 и обычный merge принятого `origin/staging` `a632e1e36326c61f157d3de5d506e533fe0b3ff2` для подготовки. На этом этапе staging-пункт оставался pending; публикацией и интеграцией управлял root.

## Staging-приёмка DB/core — 16.11.2026

- Фактически развёрнутый SHA: `e3f99ff05b97f3999fc8fbf74472e9077d769a3b`. Штатный [CI 43796217344](https://github.com/navasiolau/pero_crm/actions/runs/43796217344): **7/7 SUCCESS**.
- Web image: `sha256:7a08b609684a03aad93249ca9f190ef688571fbe5de2b3bd163a6443dba0cc2a`; renderer: `sha256:8fb1087afd508f9506952c4b16279adeccc7a27df353472eff485edf7770a19f`. Root подтвердил оба healthy и HTTP 200.
- Сохранены DB container `27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a`, start `2026-11-10T18:42:15.758341834Z`, volume `crm-staging_pgdata`, W07 SHA `27e3bcd727d9e83170c76a254806fde42590da76cea30c9e1441d873df680139`.
- Прочитан root receipt [stage-final225b.response.private.json](D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/stage-final225b.response.private.json): `exitCode=0`, `status=PASS`, `kind=staging`, `rollback=true`, `auditCountPreserved=true`. SHA-256 receipt: `31eaacd2fa52db47af49eb7b304078a1678196ab2a5241d25cb6fe1ff43941e7`; bundle SHA-256: `08fd77b27549f1668560f867658d4a5df162cf61f250e896cb8ae3f66b310e31`.
- Подтверждены все проверки receipt: `full-proposal-diff`, `full-contract-diff`, `system-actor`, `exact-product-context`, `unchanged-raw-receipts`, `no-replay-events`, `quantity-work-material-audit`, `quantity-stable-number`, `quantity-plan-facts-preserved`, `quantity-audit-rollback`, `cascade-delete-events`, `audit-fault-rollback`.
- Перед rollback выполнен `SET CONSTRAINTS ALL IMMEDIATE`; собственные тестовые строки откатились. Перед финальными native-проверками: raw audit count **5529**, hash `64bcf0448dabe8e594a5ffa37da4aa1a`. [final-refresh-state.json](D:/Projects/pero_crm_v2/.playwright-mcp/journal-221-228/final-refresh-state.json) на том же SHA подтверждает `scanned=5529`, `updated=5529`, `rawVerified=5529`, `remaining=0`; исходные события сохранены.

Ранний запуск отдельного QA bundle остановился до выполнения сценария: standalone image не содержит `next/cache.js`, тогда как приложение использует скомпилированные Next chunks. Для QA bundle root применил только import alias: `revalidatePath` бросает ошибку при вызове, а `beforeExit` завершает процесс с ошибкой при ненулевом счётчике. В успешной приёмке вызовов **0**, production-код не изменялся. Это адаптация QA-границы импорта; она не является проверкой реальной Next cache invalidation.

Принята именно DB/core часть №225. Retention, operator repair и offline import/recovery не запускались. Итоговые браузерные сценарии и авторизацию №228 root проверяет отдельно; данный receipt их не подменяет.
