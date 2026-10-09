# Tasks

Feedback09.10.2026 требует удаления вытесненного эскиза. Разделы1–2 закрыты для прежней политики сохранения старых вложений; новые требования и staging-приёмка отслеживаются в разделе3.

## 1. Локальная регрессия прежней политики — 08–09.10.2026

- [x] 1.1 Проверить реальный UI/upload-context/API/core path текущего baseline, описать фактические права и отсутствие либо воспроизведение отказа.
- [x] 1.2 Выполнить focused проверки замены, повторов, конфликтов, принадлежности файла и инженерного scope; дополнительные тесты нужны только для обнаруженного пробела.
- [x] 1.3 При подтверждённой регрессии выполнить минимальный RED→GREEN; при отсутствии дефекта зафиксировать evidence без необоснованного functional diff.

## 2. Фактическая приёмка прежней политики — 09.10.2026

- [x] 2.1 Подготовить root-reviewed task112 staging harness без backup gate; syntax/build/ownership guard проверки не подключаются к БД.
- [x] 2.2 Координатор проверяет exact deployed revision, DB/volume/S3/W07 и исполняет actual инженерную replacement/replay/stale/concurrent/participant проверку; историческая проверка сохраняла старый файл и оригинальные bytes.
- [x] 2.3 Выполнить точную очистку своих QA ID/S3 keys и сверить первоначальные fingerprints; сохранить приватные журналы и публичный обезличенный evidence.
- [x] 2.4 Пройти OpenSpec strict и локальные соответствующие проверки, зафиксировать вывод; Git-интеграция и разрешение на коммит принадлежат координатору.

## 3. Уточнение владельца: удалять вытесненный эскиз

- [x] 3.1 Обновить существующие proposal/design/tasks/acceptance/evidence и минимальный delta spec той же задачи; проверить OpenSpec strict, прежние actual receipts пометить датированным superseded evidence.
- [x] 3.2 Выполнить один focused RED→GREEN: exact old File удалён атомарно, shared cover/stale/rollback отказ безопасен, same receipt/replay/concurrency не затрагивают winner.
- [x] 3.3 Реализовать postcommit physical original+thumb cleanup всех exact versions/markers и existing DomainEvent retry; тесты подтверждают partial failure, committed503, same-nonce recovery и live-key guard.
- [x] 3.4 Сохранить явный client retry intent при committed/unknown ответе, успех после cleanup и обновление списка вложений; выполнить focused client/route/storage checks, типизацию и independent review.
- [ ] 3.5 После exclusive root lease принять фактический новый staging SHA/image/health: собственный BEFORE old File+original/thumb versions → AFTER отсутствие, winner и чужие fingerprints сохранены; exact QA cleanup завершён. До этого новая staging-приёмка pending.
