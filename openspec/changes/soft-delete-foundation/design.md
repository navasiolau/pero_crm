# Design
## Context
См. proposal. Доступ централизован через visibility predicates, но bot/project core и некоторые lookup используют прямые запросы. Финансовые запросы намеренно не равны рабочей видимости.
## Goals / Non-Goals
Общая additive основа и guards. Команды/кнопки удаления №55/56, восстановление и очистка файлов вне №54.
## Decisions
Project/Product получают deletedAt и deletedById nullable. Автор хранится scalar snapshot без FK/cascade, аудит сохраняет имя отдельно. Shared live predicates оборачивают role grants через AND и parent relation; empty-role deny остаётся deny. Прямые operational lookup получают те же predicates. Финансовые lookup, исторические начисления и max-number queries исключены из фильтра, вместо global Prisma middleware. Guard находится перед receipt replay; изменения financial records не вводятся.
## Risks / Trade-offs
Прямой lookup может обойти общий фильтр → inventory и реальные query/guard tests. Тестовые fixtures с отсутствующим nullable полем → adapters должны интерпретировать его как SQL NULL. Миграция additive без массового backfill; root применяет только существующий local/staging, не агент.
## Migration Plan
Добавить nullable поля миграцией20261003030000, private client regenerate, root native acceptance. Нет удаления столбцов/строк; выключение приложения не требует изменения сохранённых фактов.
