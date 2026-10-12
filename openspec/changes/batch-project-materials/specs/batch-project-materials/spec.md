# Spec Delta

## Purpose

Читать материалы нескольких изделий с ограниченным числом запросов, сохраняя существующие данные потребности, складской оценки, истории, возвратов и ролевого маскирования.

## ADDED Requirements

### Requirement: Ограниченный рост запросов материалов

Система SHALL получать материалы1/5/20 изделий при одном текущем акторе с querycount20<=querycount1+2, исключая подготовку/auth. Одиночная карточка MUST сохранять тот же read contract. Пустой список SHALL возвращать пустой positional result без domain SQL.

#### Scenario: Проект20 изделий
- **WHEN** открывается проект с20 разрешёнными изделиями
- **THEN** query budget достигнут, а возвращаемые группы совпадают с независимой контрольной выборкой и порядком изделий

#### Scenario: Пустой и повторённый список
- **WHEN** вход содержит ноль IDs либо одинаковый ID в нескольких позициях
- **THEN** пустой вход не читает доменные данные; непустой результат сохраняет длину/позиционные значения и одинаковую семантику повторений

### Requirement: Самостоятельный ACL и денежные grants

Система MUST проверять действующие office/product visibility и объединение ролей на сервере. IDs вызывающего кода SHALL не заменять ACL. Денежные поля, документы и суммы MUST сохранять действующее маскирование; запрещённые прежним независимым scope данные SHALL не раскрываться. Движения MUST сохранять отдельный existing history grant ADMIN/DIRECTOR, который допускает active историю soft-deleted product/project; live product scope needs/cost/valuation SHALL не применяться к нему автоматически.

#### Scenario: Смешанные роли и недоступное изделие
- **WHEN** office actor запрашивает свои/чужие/cross-project изделия либо роли не дают office grant
- **THEN** выборка и отказ равны контрольному reader, финансовые значения открываются только самостоятельным денежным grant

### Requirement: Точный неизменённый material DTO

Система SHALL сохранять fields/nulls/Decimal-derived values/порядок строк, shortage/debt/quantityPerUnit/issuedQty/WAC/warehouseReady/legacy fallback/return sources. Archived material и исторический issuedQty MUST сохраняться. Soft-deleted движения/связанные удалённые платежи SHALL не попадать в active read.

#### Scenario: Активный WAC и legacy issued quantity
- **WHEN** изделие имеет частичный возврат, archived material и issuedQty из прежнего учёта
- **THEN** цены/доступный остаток/нехватка/returnableQuantity/legacyReturnQuantity совпадают с эталоном без реконверсии истории

#### Scenario: Неизвестная стоимость
- **WHEN** вся активная история включает движение с totalBynnull
- **THEN** итог сохраняет прежний null contract, денежное маскирование не подставляет0

### Requirement: Независимый лимит истории изделия

Система SHALL сохранять последний набор до500 движений НА КАЖДОЕ изделие в порядке createdAtDESC/idDESC, применяя исключение INCOME после этого лимита. Финансовый total SHALL учитывать всю active EXPENSE/RETURN history, включая движения за пределами500. Возвратные источники SHALL подчиняться прежнему run/active/visibility contract.

#### Scenario: Одно изделие вытесняет соседнее глобальной историей
- **WHEN** один product имеет501+ движений, соседний тоже имеет историю, а внутри latest500 присутствует INCOME
- **THEN** оба получают свой прежний capped ordered result, INCOME исключён после ограничения, общая стоимость не ограничена500

### Requirement: Сохранность интерфейса и исходных данных

Оптимизация MUST NOT изменять визуальную компоновку, роли, writer semantics, складские снимки, цены, исторические движения/выплаты и их связи. Reader SHALL выполнять только чтение.

#### Scenario: Повтор открытия карточек и проекта
- **WHEN** пользователь открывает материалы проекта/изделия и picker возврата
- **THEN** действующие сценарии/значения доступны, исходные IDs/Decimal/связи/история неизменны и нет необъяснённых visual differences

### Requirement: Независимая видимость исторических движений

Система MUST сохранять прежний movement predicate отдельно от needs/cost/valuation visibility. Active historical movements soft-deleted product/project SHALL оставаться в результате ADMIN/DIRECTOR при прежнем full-visibility+draft grant; soft-deleted движения SHALL всегда исключаться.

#### Scenario: Удалённое изделие или проект под административной ролью
- **WHEN** ADMIN либо DIRECTOR запрашивает exact ID soft-deleted product/project с active movements
- **THEN** ordered historical movements/report document masks равны frozen old reader; needs/return sources/full-cost selection сохраняют свои независимые live scopes, без нового раскрытия

#### Scenario: Тот же исторический ID под обычной ролью
- **WHEN** ENGINEER либо PROCUREMENT запрашивает тот же soft-deleted graph
- **THEN** его DTO сохраняет прежний отказ/пустые scopes и не получает административного history grant
