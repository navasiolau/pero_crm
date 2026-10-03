# Design
## Context
63 даёт nullable calendarEnabled и live actor guard. Персональных записей пока нет; CRUD не должен расширять права administrator на чужие планы.
## Goals / Non-Goals
Goals: month/day UI, собственные записи, CAS и дата независимо от timezone среды.
Non-Goals: совместные/назначаемые события, повторы и доставка65–66.
## Decisions
CalendarEntry ownerId определяется auth-session, не передаётся в mutation. Транзакция повторно читает active/roles/override. State PLANNED/COMPLETED/CANCELLED; отмена сохраняет запись. Update/status требуют revision; stale отказ без записи. UUID id создаётся до POST и повтор create принимается только при совпадении owner/полного содержимого. startsAt хранится UTC, формы и вывод всегда Europe/Moscow через явный Intl и проверяемый roundtrip; несуществующие/неоднозначные часы отклоняются. Reminder offset nullable, default15, ограничен 0/15/60/1440. UI отправляет серверные actions и заменяет подтверждённую запись, без page reload. Месячный запрос ограничен временными границами и owner.
## Risks / Trade-offs
CAS conflict требует заново открыть актуальную запись → UI показывает ошибку без молчаливой перезаписи. Переключатель может измениться после открытия → write транзакция повторно проверяет current actor. 65–66 должны проверять актуальную state/revision/flag перед доставкой.
## Migration Plan
Аддитивная новая таблица/FK/индексы, старые данные не меняются. Native outer rollback и фактическая миграция выполняются координатором; source developer выполняет только bundle build. Rollback не удаляет созданные записи автоматически.
