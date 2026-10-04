# Design

## Context

См. proposal.md. Ошибочная реализация отображает ExpenseArticle в INCOME, загружает справочник в income loader и сохраняет связь. Пользователь явно требует удалить эту возможность.

## Goals / Non-Goals

**Goals:** INCOME без расходных статей во всех общих и проектных формах и серверных входах; EXPENSE сохраняет прежнюю классификацию.

**Non-Goals:** новый справочник доходов, изменение финансовых формул, миграции, переписывание истории, production.

## Decisions

- Article control существует только для EXPENSE. INCOME не отправляет expenseArticleId независимо от оставшегося состояния shared dialog. Income loader не читает ExpenseArticle, view не получает этот справочник.
- Сервер отклоняет INCOME с непустой статьёй до финансовой записи; transaction helper также защищает этот контракт от прямого вызова. Новая строка INCOME имеет expenseArticleId=NULL. EXPENSE по-прежнему проверяет обязательность, существование/active и повторно проверяет статью внутри транзакции.
- Сохранить optional number-only project, комментарий и bounded dialog layout. Предыдущие layout proofs остаются применимыми к неизменённым ограничениям ширины; новое состояние проверить кратким hosted smoke без pixel-perfect цикла.
- Проверить настоящий PaymentDialog и финансовый core meaningful RED→GREEN. Existing local/staging native выполняется в outerROLLBACK; browser открывает форму без финансового submit и новых постоянных fixtures.

## Risks / Trade-offs

- [Скрыто только поле, но stale/API payload продолжает связывать статью] → server и transaction regression.
- [Исчезли статьи у расходов] → настоящий EXPENSE dialog и required/active regressions.
- [Изменены суммы или история] → native rollback и сравнение исходных таблиц/схемы; без data backfill.

## Migration Plan

Обновлённая bugfix/61 → local checks/native → обычный merge staging → CI → actual deployed source/image/health → focused native/UI smoke. Нет SQL-миграции, дампов/restic/seed/reset/newDB/main/production; W07/refresh сохраняются.