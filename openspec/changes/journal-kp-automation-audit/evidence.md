# Проверка №225

- Исходная ветка: `bugfix/225` от `a391e5f1df7f307905513df7e1d46a10bee09a01`.
- По команде root получена foundation №221 обычным FF merge `origin/staging` → `26f1d12ab131e673930475f30203e35797a062ce`; WIP №225 сохранён, файлы между ветками не переносились.
- RED: три новые поведенческие проверки `journal-business-audit.test.ts` упали на отсутствии presentation и независимого contract snapshot.
- GREEN: те же сценарии плюс fault rollback/no-op Decimal проверены; целевой набор **198/198 PASS**, 0 skipped/cancelled.
- Полная TypeScript-проверка `tsc --noEmit --incremental false` — PASS; ESLint всех изменённых TS и нового native helper — PASS.
- Полный `pnpm --filter @pero/web test` — **1470/1470 PASS**, 0 failed/skipped/cancelled, 92.05 с. Локальный журнал: `.playwright-mcp/journal-225/full-web-tests.log`.
- Подготовлен `tests/helpers/journal-225-native.ts`: caller-supplied transaction, обязательные rollbackOnly/runId/database guards; реальные cores КП, цен, draft promotion, удаления проекта, contract store, replay и audit fault SAVEPOINT. Сеть, renderer, dispatch и отдельное подключение не вызываются.
- Native/helper и staging самим агентом не запускались; runtime-приёмку выполняет root. Публикация и merge в staging остаются за root. Production и restic не затрагивались.

Независимое review и root staging receipt будут добавлены по завершении.

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

Root разрешил локальный commit №225 и обычный merge принятого `origin/staging` `a632e1e36326c61f157d3de5d506e533fe0b3ff2` для подготовки. Push и merge в staging выполняет root после предшествующей приёмки; staging-пункт остаётся pending.
