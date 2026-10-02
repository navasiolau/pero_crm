# Spec Delta

## ADDED Requirements

### Requirement: Независимый desktop эскиз
Система SHALL ограничить правую область эскиза высотой немного меньше viewport независимо от left-content; mobile SHALL размещать её после контактов. Left-content SHALL не обрезаться.
#### Scenario: Длинное описание
- **WHEN** левое содержимое увеличивается
- **THEN** desktop cover сохраняет свою viewport-relative height и top alignment

### Requirement: Верхняя строка карточки
Номер, live status text и backarrow SHALL находиться одной строкой над editable title без дублирования номера.
#### Scenario: Подтверждённый статус
- **WHEN** ProductHeader получает status ACK
- **THEN** верхняя строка показывает подтверждённый статус без stale отдельного SSR badge

### Requirement: Контакты выбранного клиента
Product SHALL показывать readonly телефон и адрес confirmed selected Client отдельными строками. Product phone/address patch SHALL отклоняться до write; Project и Client CRUD SHALL сохраняться.
#### Scenario: Два разных адреса
- **WHEN** Project.address отличается от Client.address и выбран другой клиент
- **THEN** карточка показывает адрес и телефон выбранного Client; Project.address не копируется
#### Scenario: Старая форма
- **WHEN** Product patch отправляет client.phone или project.address
- **THEN** запрос получает отказ без изменений

### Requirement: Создание и выбор клиента
Менеджмент SHALL видеть «Новый клиент» справа от selector; dialog SHALL переиспользовать действующий CRUD. Selection SHALL использовать CAS после actual create success.
#### Scenario: Создание завершилось, выбор конфликтует
- **WHEN** сервер создал клиента, но selection baseline устарел
- **THEN** созданный клиент сохранён, прежний выбор/draft не подменяется без разрешения конфликта

### Requirement: Группа инженерных файлов
Production/Montage columns SHALL оставаться полной ширины под заголовком «Файлы от инженера» с тонкой округлой рамкой.
#### Scenario: Узкий container
- **WHEN** ширина группы меньше640px
- **THEN** existing columns складываются в прежнем порядке без overflow
