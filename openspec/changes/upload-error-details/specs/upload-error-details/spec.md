## Purpose

Давать пользователю понятное сообщение об ошибке загрузки и безопасный технический контекст для диагностики, сохраняя исходный запрос при неоднозначном результате.

## ADDED Requirements

### Requirement: Сообщение и копируемая диагностика

Client SHALL показывать короткую friendly error и свёрнутые «Технические подробности» ниже: readonly monospace textarea и icon-only copy с доступным aria-label. Подробности SHALL сохранять HTTP status/code/requestId/safe cause/phase; raw HTML, credentials и stacks SHALL не выводиться.

#### Scenario: Серверная и сетевая ошибка
- **WHEN** upload получает JSON error, non-JSON, network failure или timeout
- **THEN** доступна понятная ошибка и соответствующая безопасная диагностика без расширения страницы на мобильном экране

### Requirement: Исходный upload сохраняется

Все upload SHALL использовать UUID существующего createRequestId. Неоднозначный результат SHALL сохранять bytes/FormData/context/CID и требовать explicit same-request retry; новый UUID/автоматический duplicate SHALL не создаваться. Valid success SHALL подтверждать id/CID, cover additionally SHALL сохранять существующие sketch checks. Validation/conflict и camera/context/ACL SHALL сохраняться.

#### Scenario: Ответ потерян после отправки
- **WHEN** результат upload неизвестен
- **THEN** пользователь повторяет тот же запрос с тем же UUID и исходным файлом/context; новый файл не отправляется до подтверждения результата
