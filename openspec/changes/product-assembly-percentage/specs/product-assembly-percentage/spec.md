# Spec Delta

## Purpose

Добавить сборочный этап одиночной процентной оплаты изделия, переиспользуя новый quantity-aware BYN snapshot механизм №23 и сохраняя прежнюю историю.

## ADDED Requirements

### Requirement: Одиночный сборщик

Система SHALL хранить одного assemblerId и одну nullable ставку ASSEMBLY в существующей процентной конфигурации. Management SHALL назначать активного подходящего сборщика и редактировать текущие поля с CAS; старые выплаченные snapshots SHALL не изменяться. Новые participants/pools/shares config SHALL не создаваться.

#### Scenario: Назначение и права
- **WHEN** management выбирает активного подходящего сборщика
- **THEN** актуальное поле сохраняется через существующий inline контракт; stale expectedValue отказывает, pureEngineer не получает нового management права

### Requirement: Закрытие сборки на DELIVERY

Первое достижение DELIVERY либо management jump позднее SHALL завершать ASSEMBLY через общий version2 core №23: unitPrice×quantity×rate BYN, единственный recipient, atomic status/history/completion/share/Payroll/audit. Отдельные Work/Task SHALL не требоваться; projectstage SHALL не начислять. Возврат/RECLAMATION/повтор SHALL не создавать новую оплату.

#### Scenario: Сборка с количеством
- **WHEN** изделие1000BYN×3 со ставкой5% достигает DELIVERY впервые
- **THEN** сборщику фиксируется150BYN version2 один раз

#### Scenario: Прямой поздний переход
- **WHEN** management переводит DESIGN напрямую в DONE
- **THEN** закрываются достигнутые ENGINEERING/ASSEMBLY/INSTALLATION thresholds с их собственными recipient/rate; отказ обязательного positive-stage условия откатывает весь переход

### Requirement: Null, zero, legacy и защита оплаченных работ

ASSEMBLY SHALL наследовать №23 nullRATE SKIPPED_ONCE/no latebackpay, explicitzero noPayroll, positive requires заданную nonnegativeprice/positiveqty/activeeligible assignee. Version1/frozen history SHALL не backfill и не пересчитываться. Оплаченные LEGACY Work SHALL требовать явного covered/independent review через настоящие Payroll.workId или taskId→Task.workId перед новой positiveassembly оплатой, без name heuristics/doublepay.

#### Scenario: Пропуск или ноль
- **WHEN** DELIVERY достигнут с nullrate либо explicitrate0/price0
- **THEN** nullrate фиксирует SKIPPED_ONCE, zero — нулевой snapshot безPayroll; позднее изменение не начисляет заново

#### Scenario: Оплаченная обычная работа
- **WHEN** передpositive ASSEMBLY обнаружена оплаченная LEGACY Work без covered/independent review
- **THEN** affected переход отказывает без новой оплаты; covered не оплачивается повторно, historical amount сохраняется

### Requirement: Additive совместимость

Новые ASSEMBLY enum/scheme SHALL дополнять существующие значения без переименования старых записей. Payroll/settings/API/UI consumers SHALL принимать новый тип с прежними ACL. Данные ENGINEERING/INSTALLATION SHALL сохраняться, финальная visual/pixel QA SHALL оставаться deferred после26.

#### Scenario: Старые потребители
- **WHEN** открыты payroll/settings/status/bot записи старых типов после добавления ASSEMBLY
- **THEN** прежние значения отображаются и работают; новый тип имеет корректную метку без изменения исторических расчётов

### Requirement: Исключительное покрытие работы этапом

Одна exactworkId SHALL быть COVERED только одним процентным этапом. Review другого этапа SHALL отвергать конфликт с нынешним/frozen COVERED review без новых выплат, сохраняя старые денежные факты.

#### Scenario: Двойное покрытие
- **WHEN** работа уже COVERED INSTALLATION и ASSEMBLY пытается также включить её как COVERED
- **THEN** новый review/affectedpositivepayment отказывает, существующая оплата и история неизменны
