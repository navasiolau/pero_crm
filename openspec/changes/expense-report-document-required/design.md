# Design

## Context

См. proposal.md. Документы и optional binding/idempotency уже реализованы №97–98. PaymentDialog сейчас живёт внутри finance-tab, используется также журналом приходов; server/finance/project-workspace импортирует UI type.

## Goals / Non-Goals

**Goals:** одна policy для нового расхода, общая форма/DTO, корректное состояние загрузки и финансовый просмотр.

**Non-Goals:** общий EXPENSE без проекта (#100), складской paid receipt (#103), изменение исторических фактов и зарплат.

## Decisions

1. assertExpenseReportDocument вызывается после проверки точного receipt, но до подготовки FX в core и до writes в transaction. Поэтому новая операция без документа закрыта, старый точный replay совместим. Клиентские флаги исключения не принимаются как полномочия; будущий paid receipt получит доверенный серверный путь в #103.
2. PaymentDialog переносится в components/payment-dialog с совместимым реэкспортом. Финансовые типы — server/finance/contracts. Один UUID на открытие/направление формы, после ошибки сохраняется. Проведение блокирует редактирование/закрытие; активная загрузка блокирует проведение.
3. FinanceDocumentUpload получает optional id/onBusyChange и защиту callback после unmount. Новый UUID формы задаёт key uploader, чтобы поздний ACK не попал в следующий расход.
4. Минимальная file projection (id/name/MIME/source) общая для financial readers. General project уже фильтрует payments по FINANCE_ROLES; добавление document selection следует этому guard. Pure nonfinance не получает имён/ID финансовых документов.
5. Старые строки возвращают document=null; viewer использует существующий финансовый route. Связанный файл физически не удаляется из формы.

## Risks / Trade-offs

- Старый API client без файла → явная ошибка создания расхода, история и приходы совместимы.
- Неясный денежный ACK → прежний UUID и fingerprint, без повторного списания.
- Отложенный upload после закрытия → key по UUID и mounted guard.
