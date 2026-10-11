# Tasks

## 1. Общий контракт и RED

- [x] 1.1 Добавить фиксированные boundary/strict/alias/TZ regression tests и зафиксировать RED на исходных month helpers без подключения рабочей БД.
- [x] 1.2 Реализовать чистый payroll month helper и делегирование queries; targeted строгие/границы/TZ тесты проходят GREEN.

## 2. Все payroll входы и новые записи

- [x] 2.1 Подключить общий месяц к validation actions и cash-core; writer tests подтверждают invalid отказ до DB и московский месяц аванса/порога долга при неизменном FX UTC дне и receipt replay.
- [x] 2.2 Заменить только month expressions PIECE/percentage/adjustment producers; fixed clock tests фактических ядер подтверждают месяц операций и отсутствие изменения сумм/снимков.
- [x] 2.3 Подключить helper к payroll UI/параметрам/CSV; tests проверяют одинаковую месячную навигацию, redirect/400 invalid без queries и сохранение существующего CSV формата.

## 3. Local и независимая проверка

- [x] 3.1 Выполнить relevant legacy money/history/retry suites и согласованные typing/lint; результаты и RED→GREEN записать в evidence, не выдавать unit за native/runtime.
- [x] 3.2 Выполнить guarded native regression на существующей local5433/pero_crm: invalid месяц не создаёт строки, rollback-only boundary fixture даёт ожидаемую SQL выборку и после отката защищённые fingerprints совпадают; аномалии истории только обезличенно перечислены.
- [x] 3.3 Независимый reviewer проверяет spec/diff/инварианты и все замечания исправлены с повторными relevant tests; review proof записан в evidence.

## 4. Staging-приёмка

- [ ] 4.1 После обычной интеграции и CI оркестратор фиксирует actual staging SHA/image/health, выполняет valid/invalid payroll/export и UI сценарии, сверяет защищённую историю и записывает приёмку; main/production не изменяются.