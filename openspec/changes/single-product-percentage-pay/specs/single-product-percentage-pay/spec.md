# Spec Delta

## Purpose

Один получатель инженерной и монтажной процентной оплаты изделия с количеством в новых снимках, без переписывания прежних расчётов или повторной оплаты.

## ADDED Requirements

### Requirement: Одиночный текущий получатель и ставка

Система SHALL использовать engineerId для ENGINEERING и mounterId для INSTALLATION, одну nullable ставку каждого этапа. Новые распределения/инженерные фонды SHALL быть закрыты во всех writers. Management SHALL исправлять текущие поля после завершения без изменения frozen снимка; pureEngineer технические права SHALL сохраняться.

#### Scenario: Старый writer
- **WHEN** stale form/API пытается создать engineering pool или новых процентных участников
- **THEN** сервер отказывает без данных/оплаты; существующая история доступна

### Requirement: Новая база и атомарное завершение

Новые version2 completion SHALL фиксировать price-per-unit, quantity, rate, единственного получателя, BYN сумму, дату/инициатора при первом PRODUCTION для ENGINEERING и management-confirmed DONE для INSTALLATION. Status/completion/одна share/Payroll SHALL commit согласованно. Прямой management jump SHALL закрывать достигнутые предшествующие этапы; возврат/RECLAMATION/повтор SHALL не начислять вновь. Work/Task SHALL не требоваться; projectstage SHALL не начислять.

#### Scenario: Цена и количество
- **WHEN** изделие1000BYN×3шт со ставкой5% впервые достигает этапа
- **THEN** version2 snapshot и Payroll фиксируют150BYN одному получателю

#### Scenario: Конкуренция и rollback
- **WHEN** два запроса закрывают один этап либо запись audit/payroll падает
- **THEN** существует максимум один completion; при ошибке status/history/completion/share/payroll rollback вместе

### Requirement: Пусто, ноль и обязательные данные

Null ставка SHALL фиксировать SKIPPED_ONCE без оплаты; поздняя настройка SHALL не создавать backpay. При положительной ставке SHALL требоваться заданная неотрицательная цена, актуальное положительное количество и активный подходящий получатель. Explicit zero price/rate SHALL сохранять нулевой snapshot без Payroll. Missing price при positive rate SHALL отклонять переход, не считаться нулём.

#### Scenario: Пропуск навсегда
- **WHEN** этап завершён с null rate и позднее назначен rate/получатель
- **THEN** денежного факта задним числом нет

#### Scenario: Ноль и пустая цена
- **WHEN** rate5% и price0 либо price отсутствует
- **THEN** price0 допускает zero snapshot/noPayroll; missing price отклоняет положительное начисление

### Requirement: Историческая совместимость и запрет двойной оплаты

Version1 и frozen PENDING_FX SHALL сохранять прежние валюты/базу/получателей/rates и exactly-once retry; количество SHALL не backfill старые snapshots. Legacy markers SHALL создаваться только при отсутствии completion и доказанных исторических связях status/pool/Project PERCENT_PROJECT, не из догадки. Общая старая проектная сумма SHALL не маркироваться paid-суммой отдельного изделия. Перед новой положительной assembly/install оплатой оплаченные LEGACY Work SHALL иметь явный covered/independent review по настоящим Payroll.workId или Payroll.taskId→Task.workId, без title heuristics; covered work SHALL не оплачиваться второй раз.

#### Scenario: Старый snapshot
- **WHEN** количество изменено после version1 оплаты либо frozen retry возобновлён
- **THEN** исходный snapshot неизменён, retry не создаёт дубля и новой version2 ставки

#### Scenario: Неоднозначные участники
- **WHEN** legacy stage имеет несколько возможных получателей
- **THEN** система не выбирает первого/самого большого; новая положительная оплата требует явного актуального назначения

#### Scenario: Уже оплаченная обычная работа
- **WHEN** LEGACY Work связан с Payroll через Task и новый положительный монтаж не имеет явного review
- **THEN** переход отказывает без оплаты; после review covered остаётся исторической оплатой, independent сохраняет отдельное назначение

### Requirement: Консервативная классификация обычных работ

Review SHALL хранить exactworkId/COVERED|INDEPENDENT nullablearray, опираясь на реальные Payroll.workId или taskId→Work связи. COVERED PAID SHALL защищать весь этап LEGACY_PROTECTED без нового процента и без приписанной суммы. INDEPENDENT SHALL сохранять PIECE и разрешать отдельный новый процент; COVERED UNPAID SHALL подавлять будущий PIECE через validated review, без переписывания старого Payroll или глобального Work-флага. Review SHALL быть immutable послеcompletion, с actor/date/revision audit.

#### Scenario: Покрытая оплата
- **WHEN** relevant work явно COVERED и существует настоящий оплаченный Payroll relationship
- **THEN** весь этап LEGACY_PROTECTED, новый процент/фиктивнаяpaidamount отсутствуют

#### Scenario: Неоплаченная или самостоятельная работа
- **WHEN** relevant work COVERED UNPAID либо INDEPENDENT
- **THEN** COVERED не получает будущий PIECE; INDEPENDENT сохраняет самостоятельный PIECE и отдельную процентную оплату, старые записи неизменны
