# Tasks

## 1. Политика и точные контракты

- [x] 1.1 Реализовать policy planner для принятия, годового срока и exact orphan/retired intents; проверить shared accepted refs, архивные даты, contracts и активные leases.
- [x] 1.2 Реализовать порт точного versioned delete с manifest до IO; локально проверить pagination, markers, соседний prefix, checksum/binding mismatch и повтор после частичного сбоя через MemoryS3/SDK без сети.

## 2. Устойчивая обработка

- [x] 2.1 Реализовать raw SQL repository, epoch/lease/reference guards и factual finalize; проверить DI и исполнить guarded native helper на разрешённой local БД с полным rollback.
- [x] 2.2 Реализовать отмену с read-only reconciliation и точный managed File tombstone; проверить LEAD/неизвестный INTENT/поздний ACK через DI и SQL с MemoryS3, cover/manual ссылки — локальными поведенческими тестами.
- [x] 2.3 Реализовать hourly planning и opt-in runtime runner; проверить выключенные флаги, backoff, batch и отсутствие overlap.

## 3. Приёмка

- [x] 3.1 Выполнить targeted tests, strict typing, lint, OpenSpec strict и diff check; записать фактические результаты и ограничения.
- [x] 3.2 После обычных merge зависимостей выполнить root guarded native SQL/MemoryS3 на local 5433; подтвердить точную сохранность всех 76 таблиц, catalog, 83 receipt и 11 пустых таблиц КП.
- [x] 3.3 Проверить настоящее S3 versioning/readback на разрешённых тестовых объектах; MemoryS3 не считать физической приёмкой. Принята составная цепочка FULL55 10/10: исходные6 + retry/due2 + annual2; все4 media отсутствуют во всех версиях, PDF/DOCX/2 Product copies сохранены, тот же quarantine original RESTORED. История HOLD и точные before/finally-after proofs сохранены в evidence.md; business cleanup guard остаётся закрыт.
- [x] 3.4 Принять развёрнутый staging по точным SHA/образу и runtime-сценариям; push/build/local native не считать staging-приёмкой. На ab5/CI308 приняты physical55 10/10 с original RESTORED, настоящий after-annual retained SDK save/generate/download и ordinary LEAD→version/data/PDF GET→один restore410 KP_MEDIA_UNAVAILABLE с неизменным документом. Последний actor f694 safely CLOSED11/22/OFF000; точные результаты, сохранность и границы — в evidence.md. Последующие finalCI/deployment/OWNER110 и owner UAT не выдаются за уже выполненные; business retention worker0 и cleanup guard сохранены.
