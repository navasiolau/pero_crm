## Purpose

Конвертировать текущие суммы существующих тестовых проектов в BYN по историческому официальному курсу с проверяемым исходным снимком и сохранением финансовой/операционной истории.

## ADDED Requirements

### Requirement: Валюта, дата и округление

Конвертация SHALL выбирать только текущие проекты с currency!=BYN и использовать календарную дату Project.createdAt в Europe/Moscow. Product current expected/nonnull initial и project initial/services SHALL отражаться отдельными строками; null и qty SHALL сохраняться. Unit BYN SHALL округляться half-up до копеек перед умножением на qty. Официальный rate/scale и validity SHALL подтверждаться raw responses/URL/hash; недоступный, неоднозначный или неверный FX SHALL приводить к STOP.

#### Scenario: RUB и несколько экземпляров
- **WHEN** цена за штуку конвертируется по rate за100 RUB
- **THEN** применяется OfficialRate/100, unit округляется отдельно и линия равна округлённому unit×qty

### Requirement: Atomic guarded test apply

Runner SHALL принимать только существующие local/staging targets с hostname/DB/expected deployment guards и signed original manifest. Apply SHALL быть атомарным, проверять expected values и fingerprints всех прочих моделей, сохранять qty/неизменяемые колонки и обновлять существующий pricing version/cache token. Повтор SHALL не выполнять вторую конвертацию. Triggers SHALL не отключаться; конфликт/неизвестное состояние SHALL сохранять исходные данные через rollback.

Fingerprint profile SHALL явно подписывать version2 и исключать только operational `ApiToken.lastUsedAt`. Все остальные поля/число токенов и все прочие модели SHALL сравниваться полностью. Old manifests без нового signed profile SHALL отвергаться без переинтерпретации прежних hashes/STOP receipts.

#### Scenario: Повтор или stale plan
- **WHEN** план выполняется второй раз либо цены изменились после inventory
- **THEN** exact completed plan возвращает idempotent result без записи, а stale/mixed state отклоняется без частичного изменения

#### Scenario: Легитимный bot GET между шагами
- **WHEN** изменился только ApiToken.lastUsedAt, а manifest явно содержит новый signed profile
- **THEN** apply продолжает проверку; изменение другого поля/количества токенов или финансовых данных по-прежнему приводит к STOP

### Requirement: Production остаётся вне runner

Production target и доступ к его БД SHALL отвергаться до создания DB client. Отчёт №32 SHALL использовать реальный прикладной источник; без такого источника результат не SHALL содержать выдуманных строк или заявления о созданном production файле.

#### Scenario: Production request
- **WHEN** runner получает production target
- **THEN** операция отклоняется до обращения к БД
