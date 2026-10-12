# Spec Delta

## Purpose

Ограничить область чтения допустимых задач текущим проектом, изделием или поиском, сохраняя действующие права, результат, счётчики и финансовую историю при росте посторонних данных.

## ADDED Requirements

### Requirement: Ограниченная область допустимых задач

Система SHALL вычислять допустимость задач только в обязательном контексте проекта, изделия, выбранных проектов списка либо текущего task predicate страницы/поиска. Она MUST NOT предварительно получать массив допустимых Task.id всей базы через eligibility. Для карточки одного проекта/изделия selector SHALL не читать координаты изделий постороннего контекста. IDs уже разрешённых строк и существующие отдельные ACL-проекции SHALL сохраняться по своим прежним правилам.

#### Scenario: Рост посторонних задач
- **WHEN** к fixture добавлено сначала1, затем10000 посторонних задач и пользователь открывает ту же карточку
- **THEN** выбранные координаты и размер eligibility predicate не меняются, foreign Task.id не извлекаются, разрешённый результат карточки совпадает

#### Scenario: Пустой или отсутствующий контекст
- **WHEN** scope отсутствует, непригоден или selected projectIds пусты
- **THEN** система возвращает явный deny и не выполняет unbounded DB read

### Requirement: Прежняя согласованность связей

Eligibility SHALL сохранять ненулевые Product/Work/assignee bindings, совпадение projectId/productId у Task/Work/Product, живые Project/Product и прежний priced/frozen predicate. Known price0 SHALL оставаться известной. Frozen share SHALL NOT разрешать несогласованную, удалённую или отсутствующую связь. Stored rows, monetary snapshots и история SHALL не изменяться.

#### Scenario: Общепроектная задача и отсутствующая связь
- **WHEN** Task.productId=null, Work отсутствует либо не связан с изделием, даже при allocationGroup/shareAmount
- **THEN** задача остаётся исключённой из workspace, а исходная строка и финансовые факты сохраняются

#### Scenario: Разные проекты и изделия
- **WHEN** Task, Work или Product указывает другой проект/изделие
- **THEN** строка не попадает в tasks/count/search, включая priced и frozen варианты

#### Scenario: Связь изменилась между чтениями
- **WHEN** после координатного lookup Product перепривязан либо Product/Project мягко удалён
- **THEN** финальный SQL повторно проверяет current binding/live и не возвращает строку по устаревшей координате

### Requirement: Самостоятельные действующие права доступа

Workspace eligibility SHALL применяться отдельным AND к неизменному серверному task ACL там, где он применялся до изменения. Она SHALL NOT заменять ACL видимостью изделия либо дублированной raw SQL ролевой политикой. Role union, draft policy и действующее маскирование денег/времени/files/dependencies SHALL сохраняться. Dashboard organization-level counter SHALL сохранять прежний home-role gate и исходный predicate без добавления отсутствовавшего task ACL.

#### Scenario: Матрица ролей
- **WHEN** ADMIN/DIRECTOR, MANAGER, PROCUREMENT, ENGINEER, WORKER/MOUNTER, их разрешённые сочетания, ACCOUNTANT либо пустые роли читают одинаковый fixture
- **THEN** разрешённые задачи/счётчики/маски равны исходной политике; широкое чтение производственного изделия не даёт чужую задачу, чистый ACCOUNTANT не получает operational payload

#### Scenario: Черновик и финансовая история
- **WHEN** ограниченный сотрудник читает смешанный проект с DRAFT/soft-deleted изделиями и историческими начислениями
- **THEN** прежняя политика card/list/task/search скрывает недоступные operational rows и их счётчики, финансовая история не удаляется и не пересчитывается; organization-level dashboard counter сохраняется по собственной исходной политике

### Requirement: Счётчики выбранных проектов

Список проектов SHALL сначала сохранить прежние filters/order/pagination и затем агрегировать task counts только для выбранных projectIds под eligibility и task ACL. `_count.tasks`, total, product-count sorting и остальные DTO/masks SHALL сохраняться. Empty rows SHALL не вызывать eligibility/aggregate.

#### Scenario: Пагинация и сортировка по видимым изделиям
- **WHEN** пользователь меняет фильтры, страницу либо сортировку по числу видимых изделий
- **THEN** порядок/total/selected rows совпадают с исходным поведением, task aggregate выполняется после окончательного выбора строки/страницы, включая manual sort→slice, для выбранных проектов counts корректны, включая0

### Requirement: Прежние границы страниц задач и dashboard

Система SHALL сохранять прежние page gates и task predicates во всех достижимых callers. «Мои задачи» SHALL сохранять собственное назначение, порядок статуса/срока/создания, максимум100 и последние10 завершённых. Офисные задачи SHALL сохранять office gate, прежний порядок и максимум300. Dashboard SHALL сохранять home-role redirect до статистики, незавершённые задачи со сроком до конца текущего дня и organization-level count без добавления нового task ACL. Таймеры, preferences, mapper и остальные stats SHALL не изменяться этой оптимизацией.

#### Scenario: Лимиты личных и общих задач
- **WHEN** страницам доступны более100 собственных или300 офисных задач и посторонние/недопустимые строки
- **THEN** eligibility применяется до прежнего order/limit, выдача/active/done10/masks совпадают с baseline; непривилегированный пользователь сохраняет прежний redirect

#### Scenario: Доступ к dashboard и задачи на сегодня
- **WHEN** разрешённый home-role получает задачи с DONE, null dueAt, сроком сегодня/после todayEnd, priced/frozen/orphan связями
- **THEN** задачи на сегодня и остальные stats совпадают с исходной organization-level выборкой; другой home-role уходит по прежнему redirect до статистики

### Requirement: Допустимость поиска до ограничения результата

Глобальный поиск SHALL использовать прежний поиск по названию задачи/номеру проекта, офисное ограничение или собственное назначение, порядок по времени обновления, максимум6 и прежние поля ответа. Согласованность связей и ACL SHALL применяться до сортировки и ограничения результата.

#### Scenario: Недопустимые совпадения в начале
- **WHEN** более6 новых совпадений имеют orphan/cross-project/cross-product/hidden draft связи, а ниже есть разрешённые задачи
- **THEN** эти строки не заполняют take6, и выдача содержит первые6 разрешённых задач в прежнем порядке

#### Scenario: Совместимость поискового запроса
- **WHEN** поиск содержит Unicode, регистр, `%`, `_`, пробелы, либо строку короче2 символов
- **THEN** сохраняется прежняя семантика поиска подстроки, обработка пробелов/пустого ответа и независимые ограничения аутентификации и операционных ролей

### Requirement: Уровни доказательств и сохранность данных

Изменение SHALL фиксировать RED/GREEN actual-reader tests, объём координат/параметров, SQL/query observer и отдельный guarded native EXPLAIN. Синтетические adapters/build/source SHALL NOT считаться PostgreSQL/staging приёмкой. Native/staging SHALL подтверждать точные source/target/SHA/image и неизменность защищённых данных; guard mismatch SHALL приводить к STOP без обхода или автоматического повтора.

#### Scenario: Подготовленный и исполненный сценарий
- **WHEN** runner создан или unit observer проходит без обращения к SQL
- **THEN** evidence отмечает PREPARED/NOT_RUN для native и actual staging
