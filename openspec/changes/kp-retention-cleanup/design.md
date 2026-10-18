# Design

## Context

Используются существующие ProposalJob/Media/Artifact/Version, acceptedVersionId/retentionEpoch №185 и точные orphan/retired intents №183. Бизнес S3 вне пространства нового модуля, restic и исходный R2 не входят в область очистки.

## Goals / Non-Goals

**Goals:** физическое удаление только подтверждённых собственных ключей, устойчивый прогресс, lease/epoch fences, защита текущих пользователей и отделение хранения File изделий от медиа КП.

**Non-Goals:** запуск облачной очистки при реализации, изменение инфраструктуры, переинициализация БД, очистка произвольных CRM-файлов.

## Decisions

- PRUNE_VERSIONS принимает `{schema:1,kind:'ACCEPTED_RETENTION',proposalId,acceptedVersionId,retentionEpoch}` от №185. PURGE_MEDIA поддерживает annual, exact orphan media/copy/artifact и retired Product copy. Исторический ContractVersion JSON не удерживает старый КП PDF: DOCX и снимок договора самостоятельны.
- Планировщик строит manifest только из текущей БД; клиентский payload сверяется с authoritative metadata. Manifest и каждый exact S3 version ID записываются до Delete. Повторы дополняют manifest только новыми версиями того же ключа, без расширения ключей.
- Порядок DB-блокировок: общая mutation advisory → Project → Proposal → File binding/metadata. Сеть выполняется вне DB transaction. Перед каждым IO — lease, epoch, стадия, ссылки и полный storage binding; после IO — прогресс и повторная проверка.
- Прежний accepted intent действует после DONE/PAUSED/RECLAMATION; его отменяют LEAD, отсутствие проекта либо смена pin/epoch. Hourly resweep использует историю IN_WORK после acceptedAt или существующий intent этого принятия; один CONTRACT без такого доказательства очистку не запускает.
- Принятый PDF и optimized shared media сохраняются на «В работе». Годовой срок удаляет все КП images независимо от сохранённых выпусков; активная генерация/копирование временно откладывает очистку. Даты исходного архива не заменяются датой импорта.
- Для optimized удаления используется retiring fence; удаление только original не блокирует доступ к сохранённому optimized. Отмена освобождает не начатые fences. Начатые операции проверяются отдельным read-only reconcile без возобновления удалений отменённого принятия.
- Read-only probe ждёт минимум 60 секунд после отмены, чтобы завершился ограниченный 45 секундами IO. Неопределённый INTENT сохраняет fence и PENDING retry без расхода retry-бюджета; только ACK/реальное отсутствие и проверенная доступность снимают неопределённость. Поздние факты исходного worker монотонно объединяются с probe; таймер сам по себе не доказывает завершение.
- Retired File остаётся до подтверждения физического отсутствия. Затем точный собственный File удаляется атомарно с обычным storage-delete tombstone; processedAt ставится после физического доказательства, чтобы общий worker не создал новый delete marker.
- Node runner проверяет `PERO_KP_ENABLED=1` и `PERO_KP_RETENTION_WORKER_ENABLED=1`, планирует due media ежечасно и последовательно обрабатывает ограниченную очередь с backoff. Импорт не имеет побочных действий.
- Архив №189 защищён точными ChangeLog `kpArchiveImport/archive.reserve` и `archive.publish`. До whole-batch publish annual cleanup откладывается; оптимизированные изображения используют настоящий upload ledger №183, незавершённые DOCX — отдельный ORPHAN_ARCHIVE_ARTIFACT с manifest/receipt/object proof и 24-часовой quarantine.

## Risks / Trade-offs

- Сбой после Delete до DB ACK → сохранённый version intent, повторная проверка S3 и отсутствие двойного расширения scope.
- Возврат в «Лид» во время запроса → остановка следующего Delete, read-only уточнение факта; уже выполненное не восстанавливается.
- Неожиданный binding, checksum либо ключ → STOP без попыток исправления конфигурации или широкой очистки.
- Незавершённая генерация → отложить destructive job, сохраняя данные и durable retry.

## Migration Plan

Новых таблиц не требуется: manifest/progress находятся в ProposalJob.result, а существующие purged/deleted/retiring поля фиксируют факты. Зависимости №180/183/185 поступают только обычными Git merge; код использует typed raw SQL adapters. До native, реальной S3 и staging-приёмки worker выключен.
