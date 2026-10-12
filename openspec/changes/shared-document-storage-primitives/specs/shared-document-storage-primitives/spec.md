## ADDED Requirements

### Requirement: Общий безопасный локальный путь

Finance/logistics SHALL использовать одну containment/realpath реализацию, сохраняя собственную key/mode validation и domain error codes.

#### Scenario: Путь или symlink выходит за root

- **WHEN** локальный документ указывает за effective storage root
- **THEN** adapter отказывает до чтения/публикации чужих bytes

### Requirement: Полный оригинал публикуется атомарно

Локальная запись SHALL использовать собственный exclusive pending и заменять target только после полного содержимого и закрытия handle. Потоковый source SHALL совпадать с declared size/SHA.

#### Scenario: Частичная или несовместимая потоковая запись

- **WHEN** source отказывает или его bytes/SHA не совпадают
- **THEN** старый оригинал остаётся прежним, собственный pending закрывается/удаляется

### Requirement: Доменная выдача сохраняется

Adapters SHALL сохранять storage keys, ACL/lifecycle, open-size checks и общую private-response129 политику PDF/view/attachment.

#### Scenario: Missing или partial local original

- **WHEN** original отсутствует либо size не совпадает
- **THEN** ответ сохраняет существующую доменную ошибку/отсутствие файла без выдачи partial bytes