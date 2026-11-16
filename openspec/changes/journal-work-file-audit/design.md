# Design

## Context

См. proposal.md. Общие writers уже обслуживают несколько transport; receipts хранят подтверждённые ответы и не могут менять формат. Удаление задачи исключение: audit пишется после transaction. У piecework операции один агрегированный receipt, но сравнение должно раскрывать реальный состав долей.

## Goals / Non-Goals

**Goals:** независимые presentation snapshots, стабильные references, атомарность audit.

**Non-Goals:** изменение сумм, распределений, permissions, retry/outbox либо storage-протоколов.

## Decisions

- Общий writer №221 получает исходный payload без изменений и отдельные before/after/context hints.
- Domain helper tasks/journal формирует контексты по загруженным данным либо точному ID внутри транзакции; project ссылка не становится project лентой у объекта изделия.
- Для перехода между владельцами сохранить объединение прежних/новых контекстов. Обычные действия имеют одного владельца.
- Удаление задачи записывает своё событие до выхода из существующей transaction; автоматическая отвязка файлов получает отдельные System события.
- Действительные изменения начислений из task completion/transfer отражаются здесь; общий payroll/percentage core принадлежит №227, дублей между ними нет.
- Закрытые legacy time интерфейсы не активируются. Их существующие operator writers сохраняют raw audit и получают presentation, если достижимы.

## Risks / Trade-offs

- Изменение receipt нарушит повтор → проверять raw payload и точный UUID replay.
- Лишняя привязка раскрывает чужой контекст → брать только ID из операции, сохранять old/new при переносе, не вычислять по тексту номера.
- Audit failure после mutation теряет историю → единая transaction и fault rollback test.

## Migration Plan

Миграции нет; используется принятая схема №221. Сначала local проверки и review, затем обычная интеграция и CI/staging приёмка root. Production не изменяется.
