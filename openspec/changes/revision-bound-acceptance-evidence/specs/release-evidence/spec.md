# Spec Delta

## Purpose

Общий контракт QA evidence связывает обязательные native, HTTP/runtime, browser и визуальные сценарии CRM с проверяемой ревизией, исходниками и фактической средой, сохраняя честные статусы отсутствующих и неподходящих доказательств.

## ADDED Requirements

### Requirement: Полный перечень обязательных сценариев

Координатор SHALL хранить объявленные требования по риску изменения и отдельный результат каждого сценария с evidence level. Отсутствующее доказательство MUST оставаться NOT_RUN, недоступная среда или guard refusal — BLOCKED; готовность SHALL требовать PASS всех обязательных сценариев без замены native/browser доказательством DI, build или CI.

#### Scenario: Зелёный CI без native proof
- **WHEN** критический change прошёл CI, но обязательный PostgreSQL сценарий отсутствует
- **THEN** native остаётся NOT_RUN, готовность change не получает PASS

### Requirement: Привязка к ревизии и фактической среде

Receipt SHALL содержать full accepted SHA, target/run/scenario, проверенную image/identity и неизменность обязательных target guards до/после исполнения. Production, legacy5432 и посторонняя БД MUST отвергаться до эффекта.

#### Scenario: Старый или чужой receipt
- **WHEN** совпадают названия сценариев, но SHA, image, run либо target отличаются
- **THEN** receipt получает BLOCKED с фиксированным кодом и не закрывает требование

### Requirement: Привязка producer и production closure

Receipt SHALL связывать producer protocol/version/bundle/source manifest с исполняемым сценарием. Все импортируемые production modules MUST соответствовать accepted deployed SHA, включая фактические файлы WIP worktree; source pins SHALL проверяться до/после bundle и run.

#### Scenario: Незаметная WIP зависимость
- **WHEN** producer нового QA-кода импортирует изменённый payroll query или events из ветки автора вместо accepted источника
- **THEN** запуск отказывает до transport и никакой staged PASS не создаётся

#### Scenario: Manifest другой ревизии
- **WHEN** bundle/manifest построен для A, а declaration/image указывают B
- **THEN** manifest revision/context MUST отказать до transport; actual body с другим run/scenario/version не становится declared PASS

### Requirement: Безопасные native prerequisites

Native entrypoints MUST оставаться import-inert и использовать существующую проверенную БД. Уже применённые migrations не исполняются повторно; global warehouse lifecycle и main state не создаются, не заменяются и не удаляются ради QA. SQL constraints, rollback и независимая конкуренция SHALL доказываться настоящим PostgreSQL.

#### Scenario: Существующий ACTIVE warehouse
- **WHEN** concurrency сценарий выполняется на существующем ACTIVE state
- **THEN** он использует действующий runId и exact owned actor/material/receipt scope, сохраняет original rows/schema/global state и проверяет независимые соединения

#### Scenario: Prerequisite отсутствует
- **WHEN** требуемая схема, валюта или warehouse phase отсутствует
- **THEN** сценарий получает BLOCKED до QA mutations; reset, seed, migration replay или новая БД не используются как обход

### Requirement: Сохранность и неизвестный результат

PASS изменяющего QA SHALL требовать доказанный rollback либо exact owned cleanup и проверку защищённых данных. Неизвестный ACK/ownership MUST сохранять BLOCKED/HOLD до reviewed inspect; повтор новой mutation и blind restore запрещены.

#### Scenario: Потеря ответа после эффекта
- **WHEN** coordinator не знает результат producer и не имеет достаточного ownership receipt
- **THEN** он сохраняет UNKNOWN/BLOCKED и допускает только проверенное inspect, без автоматического cleanup или нового intent

#### Scenario: Чужая FK ссылка на owned graph
- **WHEN** Task/Work/File/Payment либо другая строка ссылается на owned graph перед cleanup
- **THEN** cleanup SHALL отказать до первого удаления; narrow rowlocks и exact original snapshot защищают all FKactions, а PRE сохраняется для inspect

#### Scenario: Неожиданная ошибка rollback сценария
- **WHEN** assertion или query отказала внутри rollback-only transaction
- **THEN** original data/schema fingerprint SHALL проверяться после rollback, не теряя исходной ошибки

### Requirement: Визуальная и поведенческая приёмка

Для UI и его DTO readiness SHALL требовать одинаковые before/after условия, поведенческую матрицу и ноль необъяснённых визуальных регрессий. Secrets/PII/raw sessions SHALL оставаться в private evidence; безопасная сводка содержит только закрытые коды и необходимые metadata.

#### Scenario: Есть screenshots без сравнения
- **WHEN** браузер сохранил изображения, но отсутствует проверенное сравнение baseline или есть необъяснённое расхождение
- **THEN** визуальная приёмка не получает PASS

### Requirement: Доказанная неизменная runtime зависимость

Если сценарий использует внешнюю runtime зависимость, receipt SHALL связывать полное фактическое публичное замыкание, версию и hashes с тем же target/revision/image/run/scenario. Система MUST проверять dependency до бизнес-функции и после неё. Подмена валидатора, сокращение API/локали, непроверенный package либо изменение validation results SHALL блокировать готовность. Ограничение размера artifact MUST сохраняться.

#### Scenario: Пакет отсутствует или отличается
- **WHEN** версия, публичное замыкание, target scope или hash runtime dependency не соответствует проверенному declaration
- **THEN** business scenario SHALL отказать до эффекта и readiness остаётся BLOCKED

#### Scenario: Малая сборка меняет результаты
- **WHEN** candidate укладывается в cap, но свежий независимый runtime даёт другие validation data/issues либо стандартные сообщения
- **THEN** размер SHALL не давать PASS; original validator и его результаты сохраняются

#### Scenario: Build без проверки упаковки
- **WHEN** build завершился, но actual target artifact, public dependency files и новый image/source binding не проверены
- **THEN** runtime scenario SHALL оставаться NOT_RUN; build не подменяет dependency/native proof

### Requirement: Shared18 exact own cohort

Общая QA группа SHALL содержать только Root-registered восемь core IDs с четырьмя раздельными ролями и nonDRAFT изделиями. Подписанные V2 документы MUST связывать тот же registry/run/revision/physical stage/source/catalog до и после эффекта. V1 historical receipts SHALL сохраняться без переобозначения.

#### Scenario: Чужой registry или прежний MANAGER DRAFT
- **WHEN** текущий запуск не имеет V2 Root registry, содержит другой ID/роль либо использует V1 как разрешение нового setup
- **THEN** producer MUST отказать до создания client/QA rows

#### Scenario: Поиск префикса и read-only actor
- **WHEN** браузер печатает префикс собственной строки
- **THEN** query SHALL сохранять mandatory own client/project filter; foreign/detail/action/payload вне точной области MUST блокироваться, engineer/accountant SHALL не получать manager preference grant

#### Scenario: Неучтённый status effect
- **WHEN** действие может создать audit/outbox/history/financial строки без exact Root-approved effect manifest
- **THEN** оно SHALL оставаться BLOCKED; core8 cleanup MUST не маскировать и не удалять такие строки

#### Scenario: Actual catalog отличается
- **WHEN** ledger checksum/row state/catalog/schema fingerprint не совпадает с Root policy текущего deployed SHA после согласованных миграций
- **THEN** entry SHALL отказать до fixtures; совпавший local migration count MUST не использоваться как замена actual stage qualification
