# Spec Delta

## Purpose

Обязательные CI-проверки используют реальные временные PostgreSQL и S3 с доказанной изоляцией и удаляют весь принадлежащий запуску стенд после завершения.

## ADDED Requirements

### Requirement: Ускорение без изменения доказательства сохранности

`nativeSnapshot()` MUST получать ordered table list, все table fingerprints и четыре catalog fingerprints тремя SQL-запросами. Формулы и JSON-форма результата/digest MUST сохраняться; owned IDs SHALL передаваться одним связанным JSON-параметром, SQL identifiers SHALL проходить whitelist, неполный либо повторный результат SHALL отклоняться. Кеш данных и DDL запрещён. HTTP fixture MUST повторно использовать только immutable manifest и compiled Flight script, сохраняя свежий sandbox/module/consumer каждого ответа и действующие протокольные ограничения.

#### Scenario: Изменение своих данных и DDL
- **WHEN** существующий складской rollback-case меняет свою строку и создаёт предусмотренные fault function/trigger
- **THEN** соответствующие fingerprints меняются, owned-exclusion исключает только свою строку, а rollback восстанавливает полный исходный snapshot

#### Scenario: Повторный ответ Server Action
- **WHEN** одна HTTP fixture декодирует несколько настоящих ответов
- **THEN** используются один manifest/compiled script и отдельное состояние decoder каждого ответа без ослабления HTTP, size, timeout, chunk и function guards

### Requirement: Явная изолированная цель

Runtime MUST допускать только текущий GitHub hosted Linux run репозитория PERO CRM, принадлежащие ему контейнеры/сеть, точные loopback endpoints, БД `pero_ci` и bucket этого run. Guard MUST выполняться до соединений, миграций и фикстур. Несоответствие SHALL останавливать выполнение без обращения к рабочим целям и без загрузки env по умолчанию.
Основной и дополнительный fault web MUST принадлежать этому run и проверенному Alpine OCI runtime; host endpoints остаются loopback, оба child используют проверенный owned PG/current job network. Second child MUST использовать unique `ci_fault_<run>_<attempt>` NOSUPERUSER LOGIN role с CONNECTION LIMIT5/minimal plugin DML/User SELECT и завершить real instrumentation/syncPlugins bootstrap с health200 до fault. POSTBOOT outage MUST менять только fault role CONNECTION LIMIT0 и завершать только exact role/datname=pero_ci sessions; health503/session null/my307 assertions сохраняются. Main role/PG/S3/protected data MUST оставаться неизменными; stop/reset, mocks/NEXT_PHASE bypass и working targets запрещены.

#### Scenario: Подмена цели
- **WHEN** endpoint ведёт на production, staging, legacy, local 5433 или контейнер не принадлежит текущему job
- **THEN** запуск завершается ошибкой до соединения или изменения данных

### Requirement: Общая проверка реальных контрактов

Существующий CI test job SHALL после единственной сборки проверять перенесённые PostgreSQL и HTTP/S3 контракты на синтетических фикстурах. Ошибка SHALL блокировать публикацию образов. Карта покрытия MUST показывать сохранённые случаи и фактический размер тестов/QA с учётом нового runtime.

#### Scenario: Пройденный пилот
- **WHEN** native PostgreSQL и защищённые HTTP/S3 cases проходят на ревизии PR
- **THEN** результат содержит ID run, case IDs и неизменность защищённых синтетических записей; факт сокращения вычисляется по файлам, а не обещается заранее

### Requirement: Удаление временного стенда

После успеха, ошибки или отмены runtime MUST завершать собственные tests/web-процессы, удалять обе owned main/fault web children и принадлежащие ему runtime/MinIO контейнеры, образы и данные. GitHub post-job MUST удалять PostgreSQL service, его данные и сеть. Удаление MUST подтверждаться журналом; остановленный контейнер SHALL NOT считаться удалённым стендом.

#### Scenario: Завершение run
- **WHEN** CI job завершён
- **THEN** owned MinIO отсутствует при повторной проверке, а `Stop containers` подтверждает удаление PostgreSQL и сети; данные не находятся в постоянных томах
