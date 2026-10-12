# Spec Delta

## Purpose

Ручное удаление эскиза и обложки проекта должно атомарно сохранять точный бизнес-факт и долговечный cleanup, сохраняя существующие права, CAS и подтверждённые исторические результаты.

## ADDED Requirements

### Requirement: Exact atomic manual deletion
Система SHALL удалить только подтверждённый File ID при текущих ACL/CAS и сохранить metadata/domain receipt/file audit/sealed storage intent в одной транзакции.

#### Scenario: Stale pointer or failed receipt
- **WHEN** pointer уже изменён либо запись audit/intent отказывает
- **THEN** новая обложка/эскиз и исходные метаданные остаются, storage не вызывается.

### Requirement: Durable confirmed cleanup
Система SHALL вернуть подтверждённый business result после metadata commit независимо от storage outage; pending intent MUST продолжиться тем же UUID через существующий worker без второго аудита.

#### Scenario: Storage outage and retry
- **WHEN** физический storage недоступен после commit, затем dispatcher запускается заново
- **THEN** сохраняется один receipt/intent и удаляются лишь исходные подтверждённые keys; соседние файлы/новая привязка сохраняются.

### Requirement: Bounded legacy replay
Система MUST сохранять старые confirmed receipts/UUID/File ID без изменения или добавления текущей storage identity. Legacy replay без verified identity SHALL вернуть confirmed result с явными pending cleanup/reconciliation status без физических effects и создания нового намерения.

#### Scenario: Historical committed delete without identity
- **WHEN** совместимый старый receipt подтверждает удаление, но имеет только legacy storageIntent
- **THEN** business result остаётся COMMITTED, cleanup требует reconciliation; старые bytes и receipt не изменяются, новый UUID не создаётся.

### Requirement: Replacement compatibility
Система MUST сохранить прежний conflict для несовместимого payload/изменённого pointer и отдельный exact-version obsolete-sketch replacement механизм.

#### Scenario: New pointer after old confirmation
- **WHEN** повтор старого delete содержит иной payload либо текущая обложка уже назначена заново
- **THEN** возвращается прежний conflict без изменения новой привязки и storage.
