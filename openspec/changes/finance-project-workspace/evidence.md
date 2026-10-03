# Evidence — №59, финансовый workspace проекта

Feature59 создан после fresh fetch от origin/staging90c69f8, №58 уже интегрирован. OpenSpec ff/apply и strict validation выполнены до code. Изолированные offline/frozen/ignore-scripts dependencies и собственный Prisma client; shared26 не менялся.

Новые /finance/projects и /finance/projects/[number-or-id] используют отдельный metadata DTO и прежние getProjectEconomics/FinanceTab/payment actions. ACCOUNTANT/PROCUREMENT и finance union разрешены, nonfinance отказывает до DB read. Нет технических данных, phones/addresses или manager forms. Существующий reference API/bot контракт №58 сохранён: Actor/query/defaultPrisma и ровно четыре поля id/number/title/currency; расширенная workspace проекция отделена.

Query boundary и loader tests проверили safe allowlist даже при broad mock row, физический USD/фиксированный BYN и NULL исторические итоги. Actual auth callback и реальные money/general entrypoints сохранили независимые role guards. Новые6 +регрессии58 ещё8 =14/14 PASS; полный TypeScript PASS, scoped ESLint0errors/0warnings. Логи `.playwright-mcp/round2/workspace-green.private.log`. Первоначальный missing-module failure — scaffolding, не fabricated behavioural RED; выявленная несовместимость прежнего reference API исправлена с сохранением его assertions.

FinanceTab обновляет dynamic workspace только после confirmed financial ACK и использует общий Europe/Moscow date formatter. Денежная математика, сами payment cores/FX/cash limits, schema и migration не менялись. №61 не начат.

Integration dependency54: в текущей90c69 схеме нет deletedAt; все проекты пока live. selectableFinanceProjectsWhere выделен для normal merge liveProjectWhere из54 после совместной генерации. Historical financial lookup намеренно сохраняет старые ссылки и cost/payroll mathematics. Никаких dynamic unknown-column casts или selective source copying. Root/coordinator должен согласовать эту integration boundary перед hosted deleted-picker acceptance.

Task3.2 остаётся pending: actual native PostgreSQL/browser/image/health/payment acceptance выполняет coordinator/root. Worker DB writes/runtime/SSH/commit/push/prod/restic/dumps не выполнял; только разрешённые fetch и создание isolatedworktree. Планы/root документы не менялись.
