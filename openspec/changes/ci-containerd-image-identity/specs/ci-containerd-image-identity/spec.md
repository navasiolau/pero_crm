# Spec Delta

## Purpose

Подтверждать, что CI исполняет именно проверенный OCI-образ, при обоих форматах Docker image ID без отказа от криптографической связи и безопасного cleanup.

## ADDED Requirements

### Requirement: Оба формата runtime ID подтверждаются точным OCI

CI SHALL принимать config digest classic image store либо manifest digest containerd только при совпадении с полностью проверенным OCI-графом. Платформа и все diff IDs MUST совпадать. Непроверенный index/tag/чужой digest MUST отклоняться.

#### Scenario: Containerd
- **WHEN** Docker возвращает ожидаемый OCI manifest digest вместо config digest
- **THEN** CI подтверждает manifest/config/layers по OCI и запускает именно проверенный runtime ID

#### Scenario: Подмена
- **WHEN** отличаются ID, Descriptor, слой, порядок слоёв или платформа
- **THEN** CI останавливается до запуска образа

### Requirement: Идентичность сохраняется на всём пути

Metadata extraction SHALL следовать проверке полного OCI-графа без исполнения процессов образа. Smoke, image migrations, web/fault запуск и cleanup SHALL использовать и проверять тот же runtime ID. Проверки source/provenance, labels, owner, bounds и сохранности БД MUST сохраняться.

#### Scenario: После проверки появился другой образ
- **WHEN** local tag или runtime ID изменился перед запуском/cleanup
- **THEN** CI отклоняет операцию без исправления цели вслепую
