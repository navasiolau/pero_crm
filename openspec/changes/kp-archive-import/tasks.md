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

## 4. Уточнение владельца от 26.10.2026: обычные КП без архивного режима

- [x] 4.1 Удалить архивный режим из UI/transport/API, договоров, изображений и серверных gates; сохранить обычные ограничения этапов, исходные документы и историю импорта.
- [x] 4.2 Поддержать первый отсутствующий фиксированный курс при явном сохранении/выборе курса; открытие и нормализация не изменяют КП или CRM, существующие курсы не пересчитываются.
- [x] 4.3 Подготовить повторяемую нормализацию точных 23 КП: проверенные связи существующих проектов/клиентов и точных номеров изделий, без создания/изменения бизнес-сущностей, state/revision/дат/версий/файлов.
- [x] 4.4 Перевести проверку published import replay на неизменяемую историю и ledger, сохраняя последующие допустимые изменения и результаты retention.
- [x] 4.5 Выполнить только затронутые local/native/browser проверки и штатный CI/staging по точному SHA/образу; подтвердить отсутствие PUT при открытии и сохранность данных при нормализации.
- [x] 4.6 Развернуть исправление и применить проверенную нормализацию production; подтвердить 23 обычных КП, права по этапам, сохранность state/media/DOCX и существующих Project/Product/Client/финансовых данных.
- [x] 4.7 Исправить совместимость обычной подготовки копий изображений с точными импортированными ключами SHA-256; подтвердить воспроизведение, сохранность source bytes и отказ для чужого namespace/ID/хэша.
