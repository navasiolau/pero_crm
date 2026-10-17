# Проверки №175 — 17.10.2026

Ветка feature/175, основание 2dc8e104. Коммиты, merge, push и deployment этим агентом не выполнялись. Схема Prisma и lockfile не менялись; зависимости установлены из offline cache с frozen lockfile.

## RED → GREEN

Новый настоящий компонентный Chromium harness PaymentDialog до реализации: 1 PASS / 3 FAIL. Падения подтверждали игнорирование RUB-кассы по умолчанию при новом открытии и в сохранённом запросе. После изменения все сценарии проходят.

## Компонентный браузер

`pnpm --filter @pero/web exec node --test tests/default-cash-account-component.test.mjs tests/default-cash-forms-component.test.mjs tests/income-form-component.test.mjs` — 21/21 PASS.

Проверены новый default и его валюта, fallback без назначения, ручной выбор, изменение массива опций и валюты проекта при открытом расходе, сохранение суммы/даты/комментария/узла загрузки документа, новое открытие, UNKNOWN/reopen с тем же cash/currency/document/UUID. Реальные компоненты аванса, зарплаты, массового расчёта, логистики и реестра проверены через внешние auth/action/FX границы; корректировка логистики сохраняет прежнюю кассу. Harness проверяет поведение компонентов, не является production или staging-приёмкой и не проверяет полный CSS layout.

## Unit / DI / регрессии

- default-cash-account.test.ts — 7/7 PASS: ролевое объединение, CAS/ABA, no-op, недоступная касса, audit rollback, снятие назначения, loader DTO и неизменность кассового баланса.
- finance-project-workspace + logistics-cash-allocation + payment-command — 15/15 PASS.
- organization-expense + manager-cash-advances + payroll-month-writers + crm-byn-finance-payroll/history + logistics-workspace-render + task-status-command.browser — 51/51 PASS.
- Prisma Client generated (6.19.3); типизация и lint без ошибок на текущей реализации.
- `openspec validate organization-default-cash-account --strict` — PASS.

## Native / staging

Сценарий `tests/helpers/default-cash-native.ts` подключён в существующий CI finance-postgres.test.ts; новый CI fixture или база не создавались. Фактическая staging-приёмка остаётся отдельным невыполненным пунктом.

17.10.2026: независимое source-review175 — замечаний нет. Root выполнил native helper в rollback-транзакции и гонки на двух настоящих соединениях под прежним общим lock: одно назначение выигрывает, второе получает CAS conflict; одновременное назначение/деактивация не оставляет неактивную default-кассу. Перед исполнением отдельное review усилило fail-closed cleanup точных QA-UUID/собственного audit/setting и ожидание allSettled; итоговый runner прошёл повторное ревью. Удалены только две собственные QA-кассы и собственные тестовые setting/audit после проверки отсутствия чужих FK и актуального аудированного снимка. Все64 таблицы после проверки совпали с baseline. Приватные proof: `.playwright-mcp/requests-171-179/local-native175.json` и `local-after175-native.json` в основном каталоге. Новый стенд/reset/seed/dump не использовался.

## Размещение браузерных проверок в CI

CI635dad выявил запуск двух новых browser-файлов в backend без Chromium. default-cash-account-component и default-cash-forms-component перенесены в components-0. Реальный Bash case workflow проверен на всех globs, каждый файл исполняется ровно один раз; gates, версии, permissions и список тестов сохранены. Независимое ревью — замечаний нет; требуется повторный CI.
