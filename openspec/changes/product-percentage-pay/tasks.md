# Tasks

## 1. Модель и сохранность

- [x] 1.1 Добавить ProductPercentageConfig и участников ENGINEERING/INSTALLATION с nullable rate, долей и `noModel` default false; RED→GREEN схема-тесты проверяют defaults и ограничения данных.
- [x] 1.2 Добавить immutable first-completion/earning snapshot, FK к PayrollEntry и distinct `skipped_once`/`pending` states с frozen FX inputs; RED→GREEN тесты покрывают 0/null и уникальность продукт+этап.
- [x] 1.3 Подготовить аддитивную forward migration и статически проверить SQL/совместимость; тесты и локальная read-only сверка подтверждают сохранность прежней истории.

## 2. Серверные правила

- [x] 2.1 Реализовать менеджерскую настройку ставок/состава и долевую передачу активному коллеге той же роли; RED→GREEN тесты проверяют сумму 100%, добавление участника, права на свою/чужую долю и неизменность ставки.
- [x] 2.2 Свести все переходы в единый status handler; RED→GREEN тесты проверяют свободные manager moves, ENGINEER только DESIGN→PRODUCTION с B3D/`noModel`, WORKER/MOUNTER запрет и объединённые роли.
- [x] 2.3 Сделать старые pool mutation actions отказами до записи, отключить новые начисления от Project moves и добавить явную менеджерскую маркировку выбранных монтажных Work как источника INSTALLATION без фонда/весов; RED→GREEN тесты проверяют отсутствие двойного PIECE+процента, отсутствие вывода по Task.type/title и неизменность обычной сдельной оплаты.
- [x] 2.4 Реализовать ENGINEERING snapshot при первом обычном выходе из DESIGN (инженеру доступен только PRODUCTION; менеджмент может выбрать любой downstream status) и INSTALLATION при первом manager-confirmed DONE; RED→GREEN тесты проверяют формулу `price × rate/100 × share/100`, пример 10 000 × 5% с долями 70/30 = 350/150, нулевой immutable snapshot без PayrollEntry и отсутствие дубликатов.
- [x] 2.5 Реализовать `skipped_once` на отсутствующей конфигурации без поздней оплаты; тест доказывает, что позднее заполнение ставки/цены не создаёт начисление.
- [x] 2.6 Реализовать FX pending и менеджерский retry по полным frozen inputs; тест сбоя/повтора доказывает неизменность входов и отсутствие выдуманного курса.

## 3. Доступ и интерфейс

- [x] 3.1 Обновить общую видимость: чистый ENGINEER только свои/участвуемые DESIGN; после PRODUCTION инженерный доступ исчезает, независимые комбинированные права сохраняются. RED→GREEN тесты покрывают роли, поиск, прямые ссылки и вложения.
- [x] 3.2 Проверить файлы, задачи и parent project serializers на скрытие DESIGN для WORKER/MOUNTER; тесты проверяют смешанные проекты и IDOR.
- [x] 3.3 Добавить карточку настроек ставок/долей, собственный preview/transfer, B3D/`noModel`, manager status actions и FX retry; RED→GREEN helper-тесты покрывают права, отсутствие модели, persisted-status при pending FX, дефолтную долю 100%, фильтр коллег и источник INSTALLATION без task-money.
- [x] 3.4 Обновить список/карточку изделия для текущих status gestures; CUA просмотр на 360/390/1440 использовал только существующие записи/изображения, без fixture rows или live status/rate/share writes.
- [x] 3.5 Добавить безопасную историю снимков и уведомления; тесты проверяют запись суммы/валюты и отсутствие скрытых деталей в ссылках/тексте.

## 4. Приёмка

- [x] 4.1 Запустить целевые RED→GREEN тесты схемы, домена, доступа, файлов и UI; сохранить команды и результаты в `qa-plan.md`.
- [x] 4.2 Выполнить локальный native QA только чтением существующих rows/images на PostgreSQL:5433; никаких новых QA users/projects/products/works/tasks/files/configs/earned rows и никаких live status/rate/share mutations.
- [x] 4.3 Выполнить read-only staging UI acceptance на ревизии `080d9d9` только по существующим данным; новые fixtures и QA status/rate/share writes не создавались. Приёмка ограничена UI/role behavior: full old-row preservation comparison не прошёл из-за отдельно подтверждённой activity другой существующей учётной записи, которая не откатывалась и не исключалась. Live earning/split не проверены; это отмечено в `qa-plan.md`.
- [x] 4.4 Выполнить SQL review, backup/TOC и before/after fingerprints существующих business rows; применить reviewed additive forward migrations к существующей локальной цели. Зафиксировать отсутствие новых fixtures, live positive earning acceptance NOT VERIFIED и production/main HOLD. Restore-test, disposable/copy DB, DDL rollback и destructive cleanup не выполнялись.

