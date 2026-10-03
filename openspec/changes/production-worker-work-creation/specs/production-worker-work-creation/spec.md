## Purpose
Позволить работнику добавлять работы текущего производства из действующего серверного прайса без права менять тарифы, изделия и исторические финансовые факты.
## ADDED Requirements
### Requirement: Узкое создание
Система SHALL разрешать активному WORKER создать Work только в живом Product текущего статуса PRODUCTION. Текущие роли SHALL перепроверяться сервером в транзакции. Независимый manager grant SHALL сохранять существующий поток.
#### Scenario: Работа без задачи
- **WHEN** активный WORKER выбирает действующую расценку на PRODUCTION Product
- **THEN** работа создаётся без synthetic Task и без нового allocation group
#### Scenario: Устаревшая карточка или роли
- **WHEN** Product уже вышел из PRODUCTION, удалён он/parent либо actor неактивен/потерял роль
- **THEN** создание отклоняется без Work/audit/financial writes
### Requirement: Серверный тариф и количество
Система SHALL принимать только идентификаторы и допустимое положительное количество/норму. Действующие unit и priceSnapshot берутся из PriceItem на сервере, масштаб и total вычисляются Decimal. Клиентская подмена цены, unit, total и вида оплаты SHALL отклоняться.
#### Scenario: Прайс изменился
- **WHEN** тариф изменился после показа формы
- **THEN** новая работа получает актуальный серверный снимок; старые Work и начисления не переписываются
#### Scenario: Отключённая расценка
- **WHEN** выбранный PriceItem стал inactive
- **THEN** новая работа не создаётся
#### Scenario: Атомарный audit
- **WHEN** запись audit завершается ошибкой
- **THEN** Work и audit откатываются целиком
### Requirement: Границы UI и доступа
Система SHALL показывать WORKER форму добавления только для PRODUCTION. Это SHALL не давать Product/status/technical/files/finance/PriceList edit или создание/распределение задач вне отдельной69.
#### Scenario: Монтажник
- **WHEN** pure MOUNTER открывает изделие
- **THEN** создание Work недоступно без независимой manager/WORKER роли

### Requirement: Единица и просмотр работы
Система SHALL сохранять unitSnapshot нового Work из действующего серверного PriceItem. Старые NULL и существующие price/unit snapshots SHALL не backfill и не переписываться при изменении прайса. WORKER SHALL видеть обычные LEGACY Work в live PRODUCTION без новых финансовых/paypool/Task execution grants.
#### Scenario: Единица прайса изменилась
- **WHEN** после создания работы unit PriceItem меняется
- **THEN** unitSnapshot и цена созданной работы сохраняют исходные значения, старый NULL остаётся NULL
#### Scenario: Созданная работа без Task
- **WHEN** WORKER возвращается в карточку PRODUCTION
- **THEN** название и количество обычной работы доступны без назначения Task, дополнительные чужие деньги/пулы скрыты
