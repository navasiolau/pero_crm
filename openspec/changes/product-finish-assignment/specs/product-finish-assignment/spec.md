## Purpose
Сохранённые покрытия текстовых элементов обычного изделия со стабильными снимками каталога и защитой concurrent edits без изменения денег, количества или данных CAD.
## ADDED Requirements
### Requirement: Named snapshots
Назначение SHALL хранить elementtext и snapshotkind/name/code/color/catalogrevision выбранного активногоFinish.
#### Scenario: Catalog edited later
- **WHEN** исходныйFinish изменён или отключён
- **THEN** сохранённый snapshot изделия не меняется самопроизвольно.
### Requirement: Scoped writes
Изменения MUST использовать действующиеmanagement/technicalDESIGN grants, liveproduct/parent и childownership.
#### Scenario: Foreign or readonly request
- **WHEN** actor readonly либо assignment принадлежит другому Product
- **THEN** запись отклоняется без изменения чужихданных/денег.
### Requirement: Concurrency and drafts
Partial write SHALL требовать revision+expectedvalue и UUIDreceipt; UI MUST сохранять соседние/новые черновики при slowACK/RSC и replayunknownrequest.
#### Scenario: Lost response
- **WHEN** результат ответа неизвестен
- **THEN** retry использует тотже UUID/payload без второго назначения или аудита.
#### Scenario: Conflict
- **WHEN** baseline/revision изменены
- **THEN** черновик остаётся до explicitaccept/rebase, silentoverwrite отсутствует.
### Requirement: Preserve financial facts
Назначения MUST не менять price/BYN/qty/earnedsnapshots и не создаватьBOM/3D/media74.
#### Scenario: Save or remove assignment
- **WHEN** спецификация изменяется явно
- **THEN** прочие исходные поля и финансовые факты остаются прежними.
