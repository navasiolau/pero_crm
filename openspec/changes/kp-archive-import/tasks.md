# Tasks

## 1. Discovery и manifest

- [x] 1.1 Реализовать read-only source adapter и frozen manifest с raw hashes, confidence, датами и unlinked DOCX inventory; проверить foreign host, missing bytes и 23/189/6/7 fixture.
- [x] 1.2 Добавить canonical IDs/media refs и reviewed bindings без потери unknown fields; проверить source drift и отсутствие now/original/history fallback.

## 2. Перенос и возобновление

- [x] 2.1 Реализовать guarded reserve/upload/finalize coordinator и SQL archive store с genuine upload jobs/PENDING ledger; проверить partial-I/O resume, uncertain ACK, replay и отсутствие business calls.
- [x] 2.2 Подключить реальные shared writer dependencies через CLI, dry-run default и reconciliation/cutover документацию; проверить аргументы и отсутствие автоматической активации.
- [x] 2.3 Реализовать согласованное владельцем восстановление missing images через reviewed map/root, cloud-first object404, точные ссылки, bounded bytes и provenance; проверить ошибки источника, reappearance, подмену bytes/map/path, переносимость и replay без бизнес-изменений.

## 3. Проверки

- [x] 3.1 Выполнить доступные unit, strict TypeScript, ESLint, OpenSpec strict и diff проверки; записать фактический evidence и ограничения.
- [ ] 3.2 После нормальных dependency merges выполнить guarded native/import/staging приёмку через root: реальные байты, business baseline, 0 дублей второго запуска и сохранный source R2; без самостоятельных cloud/DB/S3 операций.

Локальная SQL часть3.2 принята root под обязательным полным rollback (23/189/6/7, replay0, exact76/catalog/83receipts/4exceptions/11empty). Source-only cloud prepare прошёл отдельно с30 reviewed recovery; его manifest остаётся PROVISIONAL, 323unknown facts сохранены. Реальный target import и staging/cutover ещё не приняты, поэтому3.2 остаётся открытым.
