## Purpose
Единые контакты выбранного клиента в карточке проекта без редактирования общих данных клиента и без изменения исторического адреса заказа.
## ADDED Requirements
### Requirement: Confirmed client contacts
Карточка проекта SHALL показывать телефон и адрес подтверждённого выбранного клиента отдельными readonly строками под selector.
#### Scenario: Pending or rejected selection
- **WHEN** новый выбор клиента ожидает подтверждения либо конфликтует
- **THEN** строки сохраняют контакты прежнего подтверждённого клиента, без редактируемых полей телефона/адреса.
#### Scenario: New client
- **WHEN** разрешённый менеджер создаёт клиента через существующий CRUD и выбор подтверждён
- **THEN** selector и контакты отображают реального созданного клиента.
### Requirement: Preserve history and authority
Система MUST сохранять исторический Project.address и услуги без переноса Client.address; существующие Client/Project CRUD и права сохраняются.
#### Scenario: Client switch
- **WHEN** клиент проекта меняется через CAS
- **THEN** historical Project.address и доставка не изменяются; readonly пользователь не получает новых команд записи.
