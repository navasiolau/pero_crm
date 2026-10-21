# Tasks

## 1. Discovery и manifest

- [x] 1.1 Реализовать read-only source adapter и frozen manifest с raw hashes, confidence, датами и unlinked DOCX inventory; проверить foreign host, missing bytes и 23/189/6/7 fixture.
- [x] 1.2 Добавить canonical IDs/media refs и reviewed bindings без потери unknown fields; проверить source drift и отсутствие now/original/history fallback.

## 2. Перенос и возобновление

- [x] 2.1 Реализовать guarded reserve/upload/finalize coordinator и SQL archive store с genuine upload jobs/PENDING ledger; проверить partial-I/O resume, uncertain ACK, replay и отсутствие business calls.
- [x] 2.2 Подключить реальные shared writer dependencies через CLI, dry-run default и reconciliation/cutover документацию; проверить аргументы и отсутствие автоматической активации.
- [x] 2.3 Реализовать согласованное владельцем восстановление missing images через reviewed map/root, cloud-first object404, точные ссылки, bounded bytes и provenance; проверить ошибки источника, reappearance, подмену bytes/map/path, переносимость и replay без бизнес-изменений.
- [x] 2.4 Реализовать согласованное explicit ADMIN-only восстановление существующего unpublished reserve по exact reviewed SQL witness: новый оператор отдельно от исходных creators/payload/fingerprint, два audit receipts, GET-only ранее verified объектов и прежняя атомарная публикация; проверить foreign/live lease/cleanup/manifest/target/hash/operation fences и replay0, подготовить root-only native regression без самостоятельного запуска БД/S3.
- [x] 2.5 Добавить отдельную fail-closed production target binding с reviewed release proof, явным разрешением операции и повторными runtime/DB/storage guards; сохранить QA helper, local/staging и offline dry-run. Реальный production proof/запуск/rehearsal остаются NOT_RUN и требуют отдельного согласованного выпуска после ручной staging-проверки владельцем.

## 3. Проверки

- [x] 3.1 Выполнить доступные unit, strict TypeScript, ESLint, OpenSpec strict и diff проверки; записать фактический evidence и ограничения.
- [x] 3.2 После нормальных dependency merges выполнить guarded native/import/staging приёмку через root: реальные байты, business baseline, 0 дублей второго запуска и сохранный source R2; без самостоятельных cloud/DB/S3 операций.

Функциональная часть3.2 принята: local SQL с полным rollback (исторические23/189/6/7, replay0, exact76/catalog/83receipts/4exceptions/11empty), затем actual APPLY32 и genuine inner REPLAY36 для frozen23/174/6/7 и265 объектов с отдельным operational CLI provenance4ff64fc. Старый PROVISIONAL manifest, 30 reviewed recovery, 323unknown facts и исходные HOLD сохранены. Финальная публикация объединённого staging и cutover выполняются отдельным операционным шагом после единого CI; до фактического runtime receipt они не объявляются завершёнными. Import/replay receipts не переименовываются в final-image proof. Production/main не приняты и этим evidence не разрешаются.
