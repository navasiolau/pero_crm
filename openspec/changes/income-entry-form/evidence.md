# Приёмка формы прихода61

## Source и локальные проверки

- Fresh base origin/staging `6f98a0fd11ce9f6601b4b65e6d6802e030acc700`, ветка `bugfix/61`.
- Backend RED11 tests/5 PASS/6 FAIL:5 поведенческих ошибок потерянной FK/invalid/inactive/race/mismatch/missing loader articles; одна ошибка test encoding не считается behavioral RED. После исправления harness и кода focused18/18 PASS, scoped lint0/0.
- Component RED: первая actual подпись Project вместо Article. GREEN1/1 с настоящими React/BaseUI Dialog/Select, подменены только actions/router/toast. Проверены порядок, number-only options, точный placeholder, ручной выбор/no auto-first Income, outgoing selected FK/null project и прежний auto-first Expense. Минимальная stacking CSS не является layout proof.
- Общий набор **1188/1188 PASS**, TypeScript PASS, scoped ESLint0errors/0warnings, diff check PASS, production build PASS с build-only DSN; strict OpenSpec PASS. Independent source review ACK, конкретных P1/P2 нет.
- Реальный browser component test требует Chromium: CI test runner устанавливает официальный browser через существующий Playwright package перед test; роли/деплой/permissions workflow не меняются.

## Existing local native

- Первоначальный readonly/local native STOP до записи: нет активных ExpenseArticle/CashAccount, реальный ADMIN и BYN Project есть. Это не application failure; исходный STOP сохранён.
- Только2 недостающие owned references созданы внутри OUTERROLLBACK, без новых users/projects/seed/DB и без persisted fixtures.
- `income61-local-native-9606853a-ac53-4b20-9e0a-7437c6ff1163/receipt.private.json`: actual createPaymentInTransaction сохраняет выбранную FK для INCOME с NULL/linked project; currency/amount/rate/BYN/projectAmount/cash snapshot правильны. Original tables/schema MATCH после forced rollback, persisted0/outbound0; afterCommit NOT_EXECUTED.

## Staging

CI/deployment/actual3viewport geometry и native ещё открыты. Browser не отправляет финансовую операцию; проверяются реальные поля/options/placeholder/scrollWidth/clientWidth/bboxes/footer и сохраняются observations/screenshots до вторичных protocol asserts. Нет новой схемы учёта/миграции/backfill/ledger columns. Restic/dumps/seed/reset/newDB/prod/main не используются; W07/refresh неизменны.
