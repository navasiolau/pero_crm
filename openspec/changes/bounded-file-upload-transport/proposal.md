# Proposal

## Why

Обычный file upload при разрешённом документе до 1 ГиБ сначала выполняет request.formData(), затем file.arrayBuffer() и создаёт полный Buffer. Память процесса растёт с размером и числом файлов; задача139 ограничивает транспорт, сохраняя действующие данные, ACL, nonce/retry, обложки и интерфейс.

## What Changes

- Потоковый multipart parser с byte/part/field limits, SHA256 по потоку и приватным owned spool вместо полного document Buffer; изображения сохраняют действующее bounded декодирование.
- Общий sendFileUpload добавляет declared target context header из готовых form fields без чтения File bytes. Для этого потока exact ACL проверяется до Request.body read, затем metadata сверяются с multipart и ACL повторяется перед storage/finalization.
- По решению root, основанному на прямом требовании владельца сохранить функциональность, headerless/file-first callers остаются допустимыми через тот же bounded private spool. Auth/global upload role проверяется до body; entity ACL проверяется как только известен полный контекст и повторно перед storage/finalization. Для legacy не заявляется exact entity ACL до file bytes: поздний projectId делает это невозможным. Никакого business DB/storage publication до ACL.
- Потоковая передача готового spool в S3/local сохраняет original bytes/keys и storage-confirmation-before-File+receipt; abort/limit/failure очищает только точно свой временный объект, unknown commit не удаляет возможный committed original.
- Generated streams/actual handlers, native ACL/retry и separate RSS/HTTP/staging proof дополняют существующие проверки. Лимиты25 МиБ image /1 ГиБ document и целевой transport32 МиБ на upload сохраняются.

## Capabilities

### New Capabilities

- `bounded-file-upload-transport`: ограниченный потоковый приём обычных вложений, declared/legacy compatibility, temporary ownership, точный hash и подтверждённая финализация.

### Modified Capabilities

Нет. Существующие engineer/combined-role grants и UI requirements не расширяются. Основные5 specs изучены; отдельного upload transport capability пока нет.

## Impact

Ветка bugfix/139 от cd38cb745759becd58dbbad4d6d37afa03f0ab7a. Основные targets: api/files/upload, общий file-upload-client, узкие context/transport/spool/storage adapters и tests. Direct busboy parser dependency и type declarations предлагаются на review; существующие package versions не обновляются. Миграций нет. Finance/logistics/Telegram140, общий storage151 и WIP queue135 не переносятся сюда. Main/production/infra/restic, reset/seed/new DB/dumps и широкая очистка исключены. Исходные правки/RSS/real DB/S3/Next запуск ждут отдельного root/reviewer GO.