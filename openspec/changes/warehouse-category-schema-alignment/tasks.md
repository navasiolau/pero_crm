# Tasks

## 1. Исправление

- [x] 1.1 Generated-client meaningful RED→GREEN после удаления только phantom MaterialCategory.revision и private regenerate; focused regression/defaultfield checks PASS, другие модели revision неизменны.
- [x] 1.2 Existing local native default list/create/toggle категории работают с outerROLLBACK и исходные складские данные/схема MATCH; source test/TSC/build/lint/strict/review PASS.

## 2. Staging

- [x] 2.1 Ветка bugfix/58 интегрирована обычным merge, CI118 SUCCESS. Фактически развёрнутый staging120eb56c, исправленный Prisma Client и health200 подтверждены; код Income61 сохранён, SQL-миграций и выпуска main/production нет.
- [x] 2.2 Страница warehouse/items отвечает200 и показывает Номенклатуру безP2022; обычные операции категорий прошли с outerROLLBACK. Все исходные таблицы и схема MATCH, сохранённых тестовых строк0. Receipts и скриншот сохранены; общий browser wrapper отдельно имеет STOP из-за заблокированного автоматического POST после успешных целевых наблюдений.
