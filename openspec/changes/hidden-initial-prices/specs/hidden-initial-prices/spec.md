# Spec Delta

## Purpose

Защитить скрытые первоначальные цены от ordinary updates и автоматически фиксировать первый явный unitprice только для новых eligible изделий без изменения старых снимков.

## ADDED Requirements

### Requirement: Скрытые и закрытые ordinary writes

Product/Project initialPrice SHALL отсутствовать во всех пользовательских web/bot формах и ordinary create/update/patch DTO. Попытка передать initialPrice SHALL давать явный validation error без изменения данных. Старые значения SHALL сохраняться; ProjectNULL SHALL не заполняться автоматически, КП attachment SHALL не менять снимки.

#### Scenario: Stale web/bot request
- **WHEN** ordinary writer получает initialPrice даже равный прежнему значению
- **THEN** сервер отклоняет поле; прочие записи не выполняются

### Requirement: Новый eligible Product и первое значение

Durable eligibility marker SHALL отличать новые изделия после внедрения от legacyNULL. Первое явно заданное expectedPrice unitprice включая0 SHALL атомарно фиксировать initialPrice только eligible нового Product; отсутствие цены SHALL сохранять eligibility до первого explicitvalue. Subsequent price/quantity/null changes SHALL не изменять снимок. Existing legacyNULL SHALL никогда не backfill currentprice.

#### Scenario: Цена при создании
- **WHEN** новое изделие создаётся с explicitexpectedPrice0 либо100
- **THEN** initialPrice фиксируется0 либо100 один раз, без умножения наquantity

#### Scenario: Отложенная первая цена и гонка
- **WHEN** новый eligible Product без цены получает два конкурентных первыхprice requests
- **THEN** только первый успешныйCAS устанавливает snapshot; stale запрос не переписывает его

#### Scenario: Старое незаполненное изделие
- **WHEN** legacy Product.initialPriceNULL меняет текущую цену или прикрепляет КП
- **THEN** initialPrice остаётсяNULL независимо от expectedPrice/quantity

### Requirement: Совместимость финансов и истории

Hidden snapshots SHALL оставаться внутренними данными прежних consumers, без массовой конвертации/суммирования Project и без version1/2 pay rewrite. Audit SHALL отражать legitimate initial capture атомарно; права/decimal/CAS/receipt rollback SHALL сохраняться.

#### Scenario: Изменение партии
- **WHEN** текущая price/qty изменена послеinitialcapture
- **THEN** текущая сумма партии меняется по обычному контракту, initialunitprice и frozenpay snapshots неизменны
