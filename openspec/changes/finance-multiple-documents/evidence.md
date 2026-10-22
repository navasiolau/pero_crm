# Проверки задачи №195

## Followup legacy INCOME — кандидат после 90310927

CI `119607404128` выявил реальную потерю совместимости в `files-crud.test.ts:230`: до №195 schema/policy/writer принимали INCOME + single reportDocumentId с READY/uploader/unused guards. Новый запрет направления ошибочно сузил старый контракт; замена fixture INCOME на EXPENSE скрыла бы regression. Исправлены только policy для нового массива и отдельная additive validate-function migration `20261022110000_finance_document_legacy_income_compatibility`. Старый applied SQL не изменён: локальный SHA256 до/после `1aca068ff13399a6cdc056c97d0b7faf3445b8a873e107afda0fd575573c0b54`.

Сохранён исходный income fixture; существующий legacy native case расширен single income + точный receipt replay и отказом дополнительной income-связи. Старые SQL relink/unlink expectations переведены на отказ, включая принудительный SET CONSTRAINTS ALL IMMEDIATE, с сохранением привязок, денег и версий объектов. UI/бот прихода не расширены. Один разрешённый targeted policy run — 5/5 PASS. Новые native/HTTP cases и additive migration локально не запускались; обязательны новый CI и операторский review/apply. DB/S3/infra-записей агент не выполнял. Коммит — после отдельного review/разрешения Root; push и дальнейшая интеграция остаются Root.

Предыдущая локальная проверка ниже относится к исходному кандидату; её нельзя считать прохождением нового followup в native/HTTP CI.

Root local5433, 22.10.2026: штатный Prisma migrate deploy применил только `20261022090000_finance_multiple_documents` из зафиксированного комплекта исходников на C:. Прежние 75 бизнес-таблиц, старые записи `_prisma_migrations`, четыре согласованных checksum-исключения и весь прежний каталог сохранены. Новый каталог имеет 16 записей, включая две `pg_constraint` типа `t` для constraint triggers; исходный postflight ошибочно ожидал 14, это проверено отдельной read-only сверкой без повторного применения. Квитанция `C:/Users/admin/.codex/tmp/pero-crm-190-196/acceptance/migration195-result.json`.

Единственный native195 probe — PASS, `moneyApi: ACTUAL_WRITER`: настоящий `createPaymentInTransaction` провёл три файла одной операцией, повтор UUID не изменил данные, повторная привязка документа отклонена SQL, legacy single-field/старый fingerprint и receipt сохранены. Все отложенные ограничения проверены IMMEDIATE. Одна внешняя транзакция откатила все синтетические записи; полные снимки 77 таблиц и каталога совпали до/после. Байты файлов и S3 не использовались. Квитанция `C:/Users/admin/.codex/tmp/pero-crm-190-196/acceptance/local195.json`.

Worktree: `D:/Projects/pero_crm_worktrees/requests-195`, ветка `feature/195`, база `3def4f0c76e4a1756aa4dabfbb3871b2112dd927`. Коммит, push, merge, миграция, DB/runtime-записи и обращения к рабочему S3 не выполнялись.

## Выполнено локально

- OpenSpec: root подтверждён CLI; change создан через `openspec new change`; `openspec instructions apply` вернул ready; `openspec validate finance-multiple-documents --strict` — PASS.
- Prisma Client 6.19.3 с новой моделью сгенерирован; `prisma validate` — PASS с синтетическим DATABASE_URL, без подключения.
- Web `tsc --noEmit --incremental false` — PASS. Бот `tsc` — PASS.
- Web unit/DI: payment-command, expense-document-policy, paid-stock-contract, finance-document-queue, report-document-access, finance-documents-http — 24/24 PASS; finance-project-workspace, crm-byn-finance-history/payroll, finance-documents, bot-finance-documents — 19/19 PASS. Дополнительно organization-expense/cash-balance-valuation/report-document-access — 39/39 (включая 11 nested cases) PASS.
- Бот: полный существующий набор — 40/40 PASS; после исправления review о legacy READY с сохранённым documentAttempt затронутые finance-engine/stock-purchase-engine — 13/13 PASS, включая новый legacy single/UNKNOWN replay.
- Реальный Chromium с производственными компонентами и подменёнными только внешними границами: income-form/default-cash/inline-expense-article/inline-material — 38/38 PASS. Дополнительные два случая трёх файлов в форме на 1440/390 — PASS; stock-movement-компоненты — 6/6 PASS, включая поиск третьего файла, mobile/detail и FileViewer изображения.
- Проверены multiple select, все файлы drop/paste, отдельный UNKNOWN и повтор того же UUID/файла, исключение ошибки, отсутствие повторной загрузки READY, фиксированный денежный payload после UNKNOWN, read-only проведённый платёж, один денежный факт при трёх документах, все ТТН в проекции.
- Lint изменённых web TS/TSX/MJS и новых модулей — PASS; `git diff --check` — PASS.
- Визуально просмотрены реальные Tailwind screenshot трёх файлов на desktop/mobile: `node_modules/.cache/inline-article178/multiple-documents-1440.png` и `multiple-documents-390.png`. Переполнения нет; длинные названия переносятся, действия доступны.

Первый generate остановился по ENOSPC на D:. По поручению root выполнен `pnpm install --frozen-lockfile --prefer-offline --virtual-store-dir C:/Users/admin/.codex/tmp/pero-crm-190-196/requests-195/node_modules/.pnpm`; lockfile не менялся. Последующие прямые exec запускались через `pnpm --config.verifyDepsBeforeRun=false --filter ... exec ...`, чтобы pnpm не пересоздавал virtual-store на D:. Полный build не запускался.

## Подготовлено, ещё не выполнено

`tests/integration/finance-postgres.test.ts` расширен существующими guarded rollback cases: три файла обычного расхода и закупки; один Payment/StockMovement; legacy fingerprints; точный повтор; изменение порядка/дубликаты/занятость; неполный комплект не получает COMMITTED; несколько ТТН и запрет finance-связи у логистики. Это исходники native-проверок, а не доказательство их прохождения.

Миграция: `apps/web/prisma/migrations/20261022090000_finance_multiple_documents/migration.sql`. Операторские guards и последовательность — в `operator-steps.md`. Native PostgreSQL, реальный staging web/API/бот и production-приёмка остаются отдельным этапом root. Чекбокс 4.2 намеренно открыт.
