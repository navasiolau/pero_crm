# Proposal

## Why

Задача 129 согласованного плана устраняет выдачу активного оригинала в домене CRM: запрос `thumb=1` к HTML/SVG без миниатюры сейчас возвращает исходный MIME с `inline`. Политики приватной выдачи обычных, финансовых и логистических файлов также расходятся.

## What Changes

- Legacy `thumb=1` использует существующий ограниченный сервис проверенного перекодирования изображений; при неподдерживаемом или повреждённом источнике возвращается контролируемая ошибка без fallback оригинала.
- Обычный download сохраняет исходные байты и `attachment`; `view=1` сохраняет явный inline просмотр PDF. Изображения в действующих `preview=thumbnail/card/cover` и финансовых/логистических просмотрщиках остаются доступны.
- Один небольшой helper формирует приватные заголовки файла: MIME/disposition allowlist, `nosniff`, `CSP sandbox`, cache и Vary. Проверка прав остаётся в каждом домене до storage и каждого cached preview.
- Добавляются поведенческие проверки настоящего GET и двух document HTTP-adapters; исходные файлы, ключи, метаданные, UI, зависимости и БД не меняются.

## Capabilities

### New Capabilities

- `safe-private-file-responses`: безопасные приватные оригиналы и превью после текущей авторизации с запретом активного inline HTML/SVG и без изменения оригинальных байтов.

### Modified Capabilities

Нет. Уточнение инженерной видимости DESIGN/PRODUCTION относится к отдельной задаче 127; текущая серверная политика доступа этой задачей не меняется.

## Impact

`apps/web/src/app/api/files/[id]/route.ts`, `apps/web/src/server/files/image-preview.ts`, новый helper приватных response headers, read-части finance-documents/logistics HTTP-adapters и регрессионные тесты. Миграций, новых пакетов, storage cleanup и production-действий нет. Независимое review, local и реальная staging-приёмка обязательны.