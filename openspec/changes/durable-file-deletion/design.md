# Design

## Context

См. proposal.md. Ветка137 основана на свежем `origin/staging` `cfc4f91a8be070b8f160b3c9de6abeb2af8fce83`. Queue135 уже хранит claim/lease/backoff, обычный upload использует ChangeLog PK как receipt. Existing manual sketch/cover contracts остаются за138. Storage137 — отдельный author scope; интеграция и actual staging только Root.

## Goals / Non-Goals

**Goals:** атомарный факт удаления с текущим ACL; одна receipt по UUID; долговечная точная очистка при отказе/повторе; сохранение соседних и вновь привязанных файлов.

**Non-Goals:** новый брокер, новая схема или таблицы, purge S3 versions, изменение старых receipts/данных, переработка всех файловых операций и глобальная активация worker/plugins.

## Decisions

ChangeLog с детерминированным `file-delete:<UUID>` одновременно является бизнес-аудитом и receipt. Receipt хранит fingerprint actor/file, исходный контекст для повторной проверки ACL и ограниченный результат; storage identity/keys находятся во внутреннем DomainEvent. Новый event type `file.storage-delete` обрабатывается до пользовательских hooks. Сохранение двух существующих записей в одной транзакции даёт долговечность без новой таблицы; best-effort unlink до аудита убирается.

Малый delete core работает внутри транзакции: сериализовать UUID, заблокировать точный File, получить актуального actor и повторить видимость/delete permission. На replay проверить actor/file/fingerprint и текущую видимость исходного контекста; чужой UUID не даёт DTO или storage effect. Метаданные, ChangeLog и DomainEvent коммитятся вместе. Клиентские обычные FileList callers передают UUID, который удерживается до подтверждённого результата.

Intent содержит file ID, project ID, storedName/hasThumb, exact keys и identity local root либо S3 endpoint/bucket; receipt сохраняет hash полного intent. Секреты в payload не сохраняются. Executor сверяет receipt seal, identity, живые File ID/key references и ownership135 перед удалением. Local paths проверяются на containment и reparse; ENOENT — идемпотентный успех. S3 использует обычный DeleteObject без purge версий; потеря ACK оставляет retry того же intent.

Все текущие runtime File creators — ordinary upload, product-sketch upload, project-cover upload — получают новый storage key из серверного UUID единственного upload route. Поля projectId/storedName runtime не обновляет; existing-file bind только назначает существующий File через FK. Общая tx advisory lock использует canonical lower(projectId,storedName). Delete держит её до commit metadata+intent; все три creators держат ту же lock до commit и перед File.create проверяют полноценно validated/sealed FILE_STORAGE_DELETE_EVENT tombstone. Проверяется и COMPLETED: обычного удаления tombstones в runtime нет. Writer до delete завершает metadata под fence, поэтому cleanup видит его живую ссылку; writer после intent не может создать повторную привязку этого key, включая интервал reference check→remove. Нет длительной сетевой операции внутри DBtransaction.

Защищён контракт текущих supported File bindings. Прямой bucket overwrite, raw SQL и произвольный код нового trusted plugin не становятся поддерживаемыми операциями; именно fresh server UUID отделяет новые object uploads от старого key. Same-version гарантия для обычного DeleteObject не заявляется. Оригинальная замена эскиза сохраняет свой отдельный exact-version механизм.

Action после commit пытается завершить только свой event через scoped queue processor. Ошибка storage не отменяет сохранённый факт и не теряет intent. Background runtime135 и разрешённый ручной повтор используют тот же executor, прежний budget/lease/backoff. Настройки запуска не меняются.

## Risks / Trade-offs

- [Новая привязка к old key] → общий creator/delete fence и постоянный validated tombstone; existing live reference блокирует cleanup, новый supported creator после intent отказывает до File.create.
- [Переключён bucket/root] → immutable identity и отказ до storage effect.
- [Сбой между effect и ACK] → повтор обычного DeleteObject/ENOENT без второго аудита; purge не выполняется.
- [Отсутствует global worker permission] → scoped immediate attempt/replay и существующая очередь; новые settings не включаются.

## Migration Plan

Миграция не требуется. Только ordinary action/executor/internal routing/UUID callers и targeted tests. Local native на существующей5433 — после reviewed exact-owned protocol/Root ONE, без DDL/dumps/seed/reset/new DB. Staging после обычного merge/CI: actual revision/image/identity, scoped owned deletion/rollback/storage retry и cleanup с original snapshot equality. Main/production запрещены.
