# Design

## Context

PhotoUploadButton и Uploader напрямую fetch multipart upload; cover хранит uncertain File/CID и проверяет sketch DTO, ordinary сейчас UUID не задаёт. Server47 согласовал error {ok:false,error,kind,code,requestId,details:{phase,message},commitState:notCommitted|committed|unknown}; ordinary success echoCID/repeated/requestId, cover success прежний.

## Goals / Non-Goals

**Goals:** общий parsing/diagnostics и explicit same-request retry всех upload; понятная mobile-friendly ошибка/copy.
**Non-Goals:** server/storage изменения, новая камера/подписи, расширение ACL, автоматические дубли, runtime/S3/DB тесты субагента.

## Decisions

- Upload transport возвращает discriminated success/failure. HTTP берётся из Response; requestId/code/phase/safe message — только allowlisted DTO. Не показывать raw HTML, response object, stack, credentials или подписанные URLs.
- Каждый FormData содержит один clientMutationId. Attempt сохраняет уже построенный FormData и File; ambiguous retry повторяет их, не собирает новый context/category и не создаёт новый UUID.
- notCommitted очищает attempt; unknown/committed/unreadable/network/timeout сохраняют его. Нет автоматического повторного fetch. Пока результат неизвестен, новый файл не отправляется.
- Cover после success проходит существующий readSketchUploadConfirmation; неполный/mismatched ACK остаётся uncertain. Новые ordinary ACK также должны echo CID.
- Диагностика: короткий alert, native details/summary, textarea readonly без горизонтального page overflow, icon-only copy и status для результата clipboard. FileGrid action error использует тот же presentation без изменения delete server contract.

## Risks / Trade-offs

- [Ошибка без JSON] → generic friendly text + HTTP/content-type/phase/correlation, без raw body.
- [Timeout после commit] → commitState unknown и same UUID explicit retry.
- [Props/category изменились] → immutable retained FormData сохраняет прежний scope.

## Migration Plan

OpenSpec/TDD/source checks; №47 и №48 интегрируются обычными merge root. Clean isolated offline dependencies, без shared Prisma regeneration. Root выполняет real upload/clipboard/mobile/staging acceptance; эти задачи остаются unchecked.
