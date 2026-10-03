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

### Requirement: Новая задача конкретной работы
Система SHALL создавать новую Task только с Work живого Product, сохранённой известной (not NULL) расценкой и одним active eligible исполнителем. Система MUST отвергать отсутствующие ссылки и очистку ссылок при обычном редактировании. Известная нулевая цена SHALL оставаться допустимой.
#### Scenario: Generic или unassigned задача
- **WHEN** manager не передал workId/productId/assigneeId либо очистил ссылку при update
- **THEN** создание/редактирование отклоняется без Task/audit/event writes
#### Scenario: Неизвестная расценка или чужая работа
- **WHEN** Work.priceSnapshot NULL или Work принадлежит другому Product/Project
- **THEN** новая задача отклоняется; исходная работа и история неизменны
#### Scenario: Несколько независимых объёмов
- **WHEN** создаются задачи на разные доступные части количества одной работы
- **THEN** сохраняется бюджет количества №69, каждая новая задача имеет одного исполнителя и полный коэффициент; старые allocation groups учитываются один раз
### Requirement: История и сумма задачи
Система MUST сохранять frozen Payroll/allocation snapshots и правила №70. Рабочий DTO SHALL содержать точную server-derived сумму, валюту и источник; неизвестное значение MUST оставаться null без нулевого fallback.
#### Scenario: Старое денежное обязательство
- **WHEN** читается Task с историческим monetary allocation snapshot
- **THEN** сумма берётся из сохранённого обязательства, а не пересчитывается по новой расценке

### Requirement: Рабочий список без service orphan
Рабочие списки Tasks/My/Project/Product и поиск SHALL требовать structural ссылки на конкретные Work/Product и одного исполнителя. Запись без известной расценки SHALL оставаться доступной только при определённом историческом monetary Task snapshot. Система MUST не удалять исходные строки и MUST не применять workspace filter к Finance/Payroll/settlement истории.
#### Scenario: Импортированное service сообщение
- **WHEN** Task не связана с Work или Product либо не имеет исполнителя
- **THEN** рабочий список и поиск её не показывают, а исходные данные и история остаются неизменны
