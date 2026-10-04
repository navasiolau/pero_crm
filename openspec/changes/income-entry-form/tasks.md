# Tasks

Предыдущее требование о ExpenseArticle у INCOME отменено владельцем04.10.2026. Его прежняя приёмка сохранена в evidence.md; ниже текущая корректировка.

## 1. Исправление

- [x] 1.1 Сервер meaningful RED→GREEN: INCOME без статьи сохраняет NULL, запрос со статьёй отклоняется без записей, EXPENSE сохраняет required/active правила; income loader не читает ExpenseArticle.
- [x] 1.2 Настоящий PaymentDialog RED→GREEN: общий/проектный INCOME без статьи и payload без expenseArticleId, EXPENSE со статьёй; optional number-only проект и комментарий сохранены.
- [x] 1.3 Целевые и необходимые общие local checks/native outerROLLBACK проходят, исходные деньги/таблицы/схема MATCH; build/TSC/lint/strict/review PASS.

## 2. Staging

- [ ] 2.1 Обычный commit/merge/CI, actual deployed revision/image/health, native INCOME NULL/server reject и readonly формы без статьи подтверждены; исходные данные сохранены, receipts записаны, main/production не меняются.
