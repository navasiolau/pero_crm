# Design

## Context

См. proposal.md. Baseline уже содержит Product row lock, `expectedSketchFileId`, CAS и fingerprint receipt. Новые bytes записываются до транзакции; старая File-запись намеренно сохраняется. Обычный `s3Delete` в versioned bucket создаёт delete marker. DomainEvent уже имеет persisted payload/processedAt/attempts и существующий dispatcher.

Feedback09.10.2026 заменяет прежнюю политику сохранения эскизов. Старые actual receipts и QA-протоколы остаются датированными доказательствами прежнего поведения в acceptance.md/evidence.md; их raw pins и backend3 не переписываются.

## Goals / Non-Goals

**Goals:** после подтверждённой замены оставить один текущий эскиз; убрать ровно вытесненный File, original и thumbnail, включая все их версии; явно и восстановимо обработать сбой очистки после COMMIT; сохранить инженерную ACL и CAS/replay.

**Non-Goals:** массовая очистка ранее сохранённых вложений, расширение обычного file-delete ACL, изменение прочих обложек, финансов/схемы БД, миграции, новый сервис/очередь, main/production и инфраструктура.

## Decisions

- Под Product FOR UPDATE повторно проверить текущее техническое разрешение и baseline. Заблокировать ровно исходный File, проверить принадлежность и активные reverse cover refs. Общая активная project cover либо несогласованный File context дают отказ ДО replacement; чужие ссылки не обнуляются.
- В одной транзакции создать новый File, CAS-сменить pointer, удалить ровно old File, записать аудит и DomainEvent `file.sketch-obsolete` с exact old fileId/projectId/productId/storedName и mutationId. Receipt хранит cleanup eventId, поэтому одинаковый replay продолжает ту же очистку. Общего права удаления чужих вложений это не выдаёт.
- Физическая очистка SHALL начинаться только после успешного COMMIT. Проверить отсутствие живого File с тем же exact storage key, затем удалить original и thumbnail. Новый upload имеет новый generated storedName; совпадение со старым ключом отклоняется до записи.
- S3-очистка перечисляет версии только с Prefix, равным целевому key, выбирает только строго равные Key, удаляет их по VersionId и проверяет отсутствие exact versions/delete markers. Local fallback проверяет ограничение пути и допускает только ENOENT. Сбой конфигурации/identity/reference/postcheck не скрывается.
- Использовать существующий DomainEvent outbox без миграции: узкий внутренний dispatcher обрабатывает только этот type, не рассылает его плагинам. processedAt устанавливается лишь после полного physical postcheck; ошибка оставляет pending и безопасный lastError. REST-dispatch или повтор той же подтверждённой mutation может завершить работу. Никаких массовых scans/новых infra jobs.
- Route SHALL возвращать200 лишь после очистки. При pending cleanup возвращается503 с `SKETCH_CLEANUP_PENDING`, `commitState=committed` и понятным сообщением: новый эскиз сохранён, очистка прежнего не завершена. Клиент сохраняет тот же upload intent для явного повтора и не показывает успех раньше.
- Superseded replay сохраняет conflict/current pointer, не возвращает удалённый прежний результат. Его точный старый cleanup event остаётся в outbox независимо от текущего эскиза; диспетчер не может удалять живой winning key. Конкурентные одинаковые операции имеют один receipt/event; losing fresh bytes компенсируются только своими ключами.
- Загрузка переиспользует existing router refresh, чтобы удалённый old File исчезал из списка вложений. При rollback old File/pointer/bytes сохраняются, новые own keys компенсируются.

## Risks / Trade-offs

- S3 недоступен после DB commit → explicit committed503, durable exact event и idempotent retry. Ошибка не маскируется успешным upload ACK.
- Возможная историческая общая cover ссылка → отказ до replacement вместо неявного снятия чужой обложки.
- Listing по prefix может включать соседние имена → строгая Key equality, pagination validation и повторный exact postcheck; prefix purge запрещён.
- Outbox/HTTP могут выполнить одну очистку одновременно → идемпотентное удаление exact versions/ENOENT и один immutable intent; любые live-key refs блокируют удаление.
- Локальный тест не подтверждает actual S3/image → новая staging-приёмка остаётся pending до exclusive root lease.

## Migration Plan

Миграции нет. После focused local checks и independent review — обычная интеграция ветки112 в staging, CI, проверка full deployed SHA/image/health. На собственном QA-изделии root фиксирует BEFORE old File + exact original/thumbnail versions и AFTER отсутствие всех старых записей/версий, сохранность winner и неизменность чужих данных. Исторический backend3 не исполняется как доказательство новой политики.