# Проверки №178 — 17.10.2026

Основание feature/178 получено обычным FF merge из origin/staging: `635dad832de9bb2744089e554b8fa774b4c041ae`, содержит принятую оркестратором №175. Код приложения изменён после GO. Коммиты, push, merge в staging и deployment этим агентом не выполнялись. Схема, зависимости и lockfile не менялись; установка offline/frozen, Prisma Client 6.19.3 сгенерирован локально.

## RED → GREEN

Новый action DI-test сначала падал по отсутствию канонической article option: сервер возвращал `{ok:true}`. После изменения действие возвращает только созданные id/name; его реальный core, общий transaction и ACL сохранены. Нет нового read action; пустой код передаётся как undefined, ручной код сохраняет прежний валидатор и unique guard.

## Пройденные проверки

- inline-expense-article-action + expense-article-codes + organization-expense + finance-project-workspace + default-cash-account + payment-command: 36/36 PASS.
- default-cash-account-component + default-cash-forms-component + income-form-component + stock-movement-component: 26/26 PASS.
- inline-expense-article-component: 11 сценариев PASS: организация, проект, закупка, пустой список, канонический выбор, отсутствие дублей, RSC-подобное обновление props, сохранение суммы/валюты/кассы/курса/дат/комментария/документа/складских полей, UNKNOWN reopen с прежним payload/UUID, ошибки и cancel/Escape, pending и blocked, общий реестр, быстрое повторное открытие до прихода серверных опций.
- Существующий Chromium PaymentDialog UUID/manual-FX/UNKNOWN/reload regression из task-status-command.browser: 1/1 PASS.
- TypeScript `--noEmit --incremental false`, ESLint изменённых TS/TSX/MJS, `git diff --check`, `openspec validate inline-expense-article-create --strict`: PASS.

## Визуальный harness

Реальные React/Base UI компоненты, полный globals.css/Tailwind; внешние auth/action/FX/upload границы подменены. Chromium 1440×1000 и 390×844, светлая и тёмная темы: независимое закрытие child, возврат фокуса, отсутствие горизонтального overflow; PNG просмотрены. Снимки находятся в ignored `node_modules/.cache/inline-article178`. Шрифт harness задаёт sans-serif fallback без Next font loader; реальную серверную/staging-приёмку это не заменяет.

Новый browser test явно направлен в CI components-0 отдельным case; backend не требует Chromium. Существующие entries и gates не менялись.

## Native и staging

`tests/helpers/inline-expense-article-native.ts` экспортирует `verifyInlineExpenseArticleNative(tx, actor)` для guarded rollback-транзакции оркестратора. В существующий finance-postgres.test.ts добавлен сценарий без изменения CI inventory. Агент не подключался к БД и не запускал CI fixture локально.

Оркестратор выполнил native-проверку на существующей local БД `localhost:5433` под guards и rollback: PASS для канонической записи, auto-code, серверных прав, конфликта кода, аудита и его отката, отсутствия платежа/выплаты/складского движения. После rollback все fingerprints 65 таблиц совпали с baseline, созданные строки и аудит отсутствуют. Receipt: [local-native178.json](D:/Projects/pero_crm_v2/.playwright-mcp/requests-171-179/local-native178.json). Независимое ревью оркестратора — без замечаний.

Пункт 3.2 выполнен. Фактическая staging-приёмка остаётся pending (3.3).
