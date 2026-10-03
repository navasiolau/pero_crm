# Proposal

## Why

Ошибки загрузки сейчас показываются короткой строкой без HTTP/code/requestId, а обычные файлы не сохраняют request UUID для проверки неоднозначного результата. Нужны понятная ошибка и копируемые свёрнутые технические подробности без потери текущего контекста/receipt.

## What Changes

- Общий client upload transport разбирает JSON/non-JSON/network/timeout и сохраняет safe diagnostics.
- Под сообщением доступен свёрнутый блок «Технические подробности», readonly monospace textarea и icon-only copy с aria-label.
- UUID из существующего createRequestId используется во всех upload, включая ordinary; explicit retry сохраняет исходные bytes/FormData/context/CID.
- Cover confirmation/validation/conflict и камера задачи сохраняют текущие правила; сервер/storage/error DTO принадлежат №47.

## Capabilities

### New Capabilities

- `upload-error-details`: понятные upload errors с безопасным техническим контекстом и сохранением неопределённого запроса.

### Modified Capabilities

Нет.

## Impact

Client transport/diagnostics component, PhotoUploadButton и ProjectFiles Uploader/FileGrid error surface, focused tests. Без server/storage edits, captions/camera изменений, новых миграций и actual DB/S3 uploads. Runtime/staging приёмка остаётся root.
