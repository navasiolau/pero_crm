## Purpose
Независимый справочник базовых отделок для дальнейших снимков спецификации изделий без связи с фиктивными проектами и без изменения финансовых исходных данных.
## ADDED Requirements
### Requirement: Stable catalog
Система SHALL хранить UUID, тип, название, код, цвет и активность эмали/шпона/покрытия; код MUST быть уникален внутри типа после канонизации.
#### Scenario: Duplicate code
- **WHEN** введён повторный код того же типа с иным регистром/пробелами
- **THEN** создание отклоняется без второй записи и аудита успеха.
### Requirement: Catalog grants
Управление SHALL быть доступно ADMIN/DIRECTOR/MANAGER/PROCUREMENT; операционные readonly audience MUST не получать write grants.
#### Scenario: Readonly attempt
- **WHEN** инженер/worker/mounter пытается изменить запись напрямую
- **THEN** отказ происходит до данных/write, тогда как activecatalog доступен для чтения.
### Requirement: CAS and deactivation
Изменение MUST требовать captured revision; отключение SHALL сохранять запись/UUID/code и не удалять историю.
#### Scenario: Stale editor
- **WHEN** revision изменилась после открытия формы
- **THEN** чужое изменение не перезаписывается и успехнеаудируется.
#### Scenario: Disable and reactivate
- **WHEN** manager отключает либо включаетвариант
- **THEN** тот же UUID и данные сохраняются; readonlycatalog скрываетнеактивныйвариант.
