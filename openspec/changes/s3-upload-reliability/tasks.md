# Tasks

## 1. Storage и контракт
- [x] 1.1 RED→GREEN strict storage config и безопасный error DTO; focused unit tests (RED2→GREEN2).
- [x] 1.2 RED→GREEN ordinary receipt/replay/conflict/audit rollback/late notify; focused backend tests (RED3→GREEN5, включая unknown commit и thumbnail).
- [x] 1.3 Route сохраняет ACL/validation, original bytes, cover CAS и закрытый JSON; targeted route regressions (26/26 PASS).

## 2. Проверки
- [x] 2.1 Проверить scoped lint/typecheck и OpenSpec strict; whole tsc PASS, scoped lint0errors/0warnings, strict valid.
- [ ] 2.2 Root выполняет actual staging assurance/upload/replay/cleanup после deployment с CRM_FILE_STORAGE=s3; runtime QA до исполнения остаётся pending.

## 3. Прямое уточнение upload UI 03.10.2026
- [x] 3.1 Исправить первый project-cover выбор (PHOTO≠undefined current context); fresh выбор использует текущую сущность/UUID, busy-only selection lock, без stale recovery ref/context gate.
- [x] 3.2 Удалить все видимые «Проверить прежнюю загрузку»/«Повторить…» и equivalent recovery controls во всех upload UI; каталог только upload recovery. Сохранить truthful friendly error/technical copy и отказ от success на unknown ACK; server ACL/idempotency/CAS/receipt не менять ради обхода.
- [x] 3.3 RED→GREEN meaningful rendered-input regressions: первый выбор, свежий файл после failure/context change, busy lock, отсутствие recovery controls, non-JSON/malformed/network response без ложного успеха; local lint/typecheck/full checks по scope.
- [ ] 3.4 Исследовать actual server non-JSON500 по конкретным logs/request correlation/raw response. Причина пока UNKNOWN; body10MiB hypothesis не записывать как установленную причину без actual evidence.
- [ ] 3.5 После CI и exact deployed revision пройти настоящий rendered file picker→browser POST→реальный S3 (project cover и затронутые upload UI), original SHA/thumbnail/pointer/receipt, truthful errors и fresh selection; handcrafted Node multipart не заменяет browser acceptance. Выполнить exact own cleanup и полный original RAW/schema proof, записать receipt paths.
- [ ] 3.6 Координатор выполняет один OpenSpec strict validation обновлённого change при подготовке commit; чекбоксы новой приёмки закрывать только по фактическим доказательствам.

Client source proof: genuine actual-component RED3 (first cover0POST, fresh files blocked) -> GREEN; final focused23/23 PASS, wholeTSC0, scopedlint0/0. Newselection/currententity/freshCID, lateoldACKignored and no visible previous-upload controls tested. Source server500 cause and hosted rendered picker/S3 acceptance remain3.4/3.5 pending. Finish UI removed from47scope per later owner instruction; separate72removal owns it.
