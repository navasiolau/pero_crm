# Проверки задачи №195

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
