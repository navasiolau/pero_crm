# Design
## Context
Project overview использует общий inline provider с историческим address и делегированным client.phone. Shared contacts уже возвращает Client.address после подтверждённой смены клиента.
## Goals / Non-Goals
Контакты выбранного подтверждённого клиента читаются без новых writes. Сохранить существующие Client/Project CRUD, историю адреса, финансовые поля и права.
## Decisions
Карточка исключает address/client.phone из активных controllers и исходных данных. Отдельный Contacts component использует immutable SSR snapshot clientId и существующий helper контактов, реальный ClientDialog. Смена клиента возвращает clientAddress в существующем частичном ACK; initial options включают raw Client.address/phone. Это сохраняет readonly контакты при dirty/rejected selection и создании нового клиента.
Partial/legacy Project API сохраняются для существующих потребителей; отсутствие редакторов и controllers является границей этой UI задачи. Сервер Client CRUD не расширяет права.
## Risks / Trade-offs
Недоступный выбранный клиент → явный неизвестный контакт без fallback Project.address. Pending selection → показывать контакты confirmed baseline. Files RSC → сохранить dirty drafts и refresh clean controllers как раньше.
## Migration Plan
Без миграций. Root ordinary merge и фактическая staging-проверка; широкая визуальная проверка отдельно.
