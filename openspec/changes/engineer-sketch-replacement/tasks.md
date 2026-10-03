# Tasks

## 1. Контракт и атомарная замена

- [x] 1.1 Подготовить RED-проверки замены чужого актуального эскиза, stale baseline, неправильной привязки и повторов; сохранить результат.
- [x] 1.2 Расширить upload baseline и cover CAS без изменения общей delete ACL; проверить сохранение старого файла, актуальные права и GREEN тестов.

## 2. Интерфейс и приёмка

- [x] 2.1 Добавить явную загрузку замены с исходным pointer и ACK; проверить передачу оригинальных bytes, безопасный retry и typecheck.
- [x] 2.2 Пройти focused tests, lint и OpenSpec strict; сохранить результаты.
- [ ] 2.3 На фактически развёрнутом staging SHA проверить реальную S3 замену инженером эскиза менеджера, сохранение старого файла и отказ устаревшей формы.

Локальная проверка 03.10.2026: RED 9 PASS/4 FAIL до изменения контракта и CAS; затем 59 PASS/0 FAIL, включая настоящую POST-функцию загрузки с контролируемыми storage/DB boundary, SHA оригинальных bytes, повтор ACK, отсутствующий baseline и компенсацию только новых ключей. Дополнительная регрессия проверяет две последовательные замены: старый upload/bind/delete receipt не подтверждает исторический pointer как актуальный и возвращает conflict без изменений. Web typecheck PASS, lint 0/0, strict OpenSpec PASS. Эти тесты не являются доказательством реального S3 или PostgreSQL. Private native bundle собран (93 822 B, SHA256 `c936d1bf70117c71e9c39fd70323cddb7546fec979b94b5f5f4ea7fcce84f763`), syntax PASS, без выполнения БД. Fingerprint динамически защищает все фактические public-таблицы, включая CalendarEntry другой ветки, и schema columns/constraints/indexes/enums; target guard не ослаблялся. Прежние build artifacts сохранены. Координатор выполняет actual native и окончательную staging-приёмку; логи сохранены в игнорируемом apps/web/.playwright-mcp/development71.
