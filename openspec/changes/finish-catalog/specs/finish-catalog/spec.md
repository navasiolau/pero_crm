# Purpose

Убрать отменённые catalogue/assignment/sample функции из активного CRM, сохраняя обычные файлы, историю миграций и данные вне разрешённой empty-schema границы.

## REMOVED Requirements

### Requirement: Standalone finish catalog

**Reason**: Владелец отменил функциональность72–74 целиком.
**Migration**: Nav/page/CRUD/controllers/DTO/domain/catalogue API больше не существуют; новый guarded schema removal только после actual emptiness/reference proof, historical applied migrations остаются.

### Requirement: Product finish snapshots and sample images

**Reason**: Назначения покрытий и их образцы также отменены; feature не скрывается флагом.
**Migration**: Product section/queries/types/sample endpoints и active ORM models удаляются. Blobs/original metadata при наличии не удаляются без отдельной безопасной retention boundary.

## ADDED Requirements

### Requirement: No active finish feature

CRM MUST NOT expose finish nav, Product editor, catalogue CRUD/upload/download routes or active finish domain/types. Ordinary File viewer/upload MUST retain existing ACL and transport.

#### Scenario: Removed entry points

- **WHEN** пользователь открывает /finishes или catalogue-media routes после deployment
- **THEN** routes404, nav/section отсутствуют; не выполняются finish queries или storage mutations

### Requirement: Historical and financial preservation

Applied migrations090/130/140 MUST remain unchanged. Removal MUST NOT delete financial snapshots, general File records or business S3 blobs. Guarded DROP MUST reject nonempty finish data or outside references.

#### Scenario: Unexpected original data

- **WHEN** actual count/reference guard не подтверждает empty scope
- **THEN** migration STOP/PRESERVE; никакого CASCADE или автоматического metadata/blob cleanup
