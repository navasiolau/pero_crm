# API CRM и повторяемые операции

Использовать `PERO_CRM_API_URL` (origin CRM или полный `/api/v1/kp`) и `PERO_CRM_API_KEY`. HTTPS обязателен, кроме localhost. Ключ CRM хешируется, может быть отозван, принадлежит активному ADMIN/DIRECTOR/MANAGER и имеет отдельные scopes:

`kp:read`, `kp:write`, `kp:media:write`, `kp:export`, `kp:contracts:read`, `kp:contracts:write`, `kp:contracts:generate`.

Общий старый `admin` scope не заменяет эти права. Не копировать старый секрет генератора и не помещать ключ в URL, JSON состояния или квитанцию. Отзыв ключа/прав проверяется сервером и при завершении долгой генерации.

| Операция | API относительно `/api/v1/kp` |
|---|---|
| Список, создание | GET/POST `/documents` |
| Чтение, полное обновление | GET/PUT `/documents/:id` |
| Клиенты | GET `/clients?q=...`, GET `/clients/:id` |
| Загрузка | POST `/uploads`, multipart: documentId, expectedRevision, operationId, file, необязательный optimized |
| Приватная картинка | GET `/documents/:id/media/:mediaId?variant=optimized&scope=current` |
| Выпуски | GET `/documents/:id/versions`, GET `/documents/:id/versions/:versionId` |
| Восстановление | POST `/documents/:id/versions/:versionId/restore` |
| PDF | POST `/documents/:id/pdf` |
| Форма/настройки договора | GET/PUT `/contracts/:documentId` |
| Выпуск договора | POST `/contracts/:documentId/generate` |
| Задание | GET `/jobs/:id` |
| Результат прежней команды | GET `/operations/:operationId` |
| PDF/DOCX | GET `/artifacts/:artifactId/download` |

Все приватные чтения требуют Bearer. Ссылки скачивания указывают на API CRM, не на публичный S3. Не переходить с Bearer на другой origin и не исполнять перенаправления.

Текущий документ содержит `id`, `revision`, `state`, `project`, `client`, `canEdit`, `fx`, `sourceDate`. Создание: `{state,operationId,clientId?,fx?,expectedNumber?}`. Обновление добавляет `expectedRevision`; `state` всегда полный. Вложенные поля редактора сохраняются, прежние `items[].id` остаются стабильными. Выбранный клиент хранится в `state.client.crmId` и структурированном `crmSnapshot` с ID; предпочтительнее передать `clientId` и использовать снимок из ответа сервера. Не разбирать ФИО/телефон из общего текстового поля.

Курс `fx` имеет `{currency,rate,date,source}`; rate — десятичная строка, source — NBRB или MANUAL. Сервер фиксирует курс при создании. Обычное сохранение не запрашивает новый курс. Смена валюты требует соответствующего нового курса; нельзя переиспользовать число старой валюты.

Каждая команда получает отдельный UUID, записанный **до отправки**. Повтор точно той же операции с тем же UUID сервер возвращает из receipt; другое тело с тем же UUID — конфликт. После неопределённого ответа сначала GET операции. Ответ `{operationId,kind,result}` содержит неизменяемый первоначальный результат, не текущее состояние сущности. Отсутствующая/незавершённая операция не разрешает создать второе КП с другим UUID. Уточнить исход по тому же UUID.

Генерация PDF принимает только `{operationId,expectedRevision}`. После ответа читать тот же job, пока `state=SUCCEEDED`; `FAILED`/`CANCELLED` не являются выпуском. `result` содержит artifactId, необязательный versionId, fileName, mimeType, downloadUrl. Долгий job не требует повторной генерации.

Форма договора: `{contractId,revision,settings,profiles,sourceRefs,clientDefaults,clientBaseline}`. Путь использует **ID основного КП**, не contractId. Сохранение: `{documentId,expectedRevision,operationId,clientBaseline,sourceRefs,settings}`; генерация — те же поля без settings. `sourceRefs=[{proposalId,expectedRevision}]` берутся из свежей формы; baseline защищает от смены реквизитов между открытием и выпуском. Для изменения состава источников снова открыть форму. Выбранные КП должны пройти исходные проверки валюты и заказчика. Выпуск переводит все включённые «Лид»/«Просчёт» в «Договор».

Ошибки `401/403` требуют проверки ключа/прав, `409` — новой ревизии/этапа/базового снимка, `410` — недоступного изображения после срока хранения. Не обходить их передачей state напрямую в renderer.

## Python

Помощник использует тот же Node-клиент, что MCP (Node 22+, Python 3.10+). Он читает только два названных значения окружения/.env, сохраняет квитанцию до записи и при повторном запуске с той же квитанцией выполняет только GET операции.

```text
python scripts/pero_kp_api.py --workspace E:\KP list
python scripts/pero_kp_api.py get DOCUMENT_ID --out before.json
python scripts/pero_kp_api.py backup DOCUMENT_ID --directory backup-new-folder
python scripts/pero_kp_api.py save --state state.json --receipt create-operation.json
python scripts/pero_kp_api.py save --id DOCUMENT_ID --before before.json --state state.json --receipt save-operation.json
python scripts/pero_kp_api.py upload DOCUMENT_ID image.jpg --before before.json --receipt upload-operation.json
python scripts/pero_kp_api.py pdf DOCUMENT_ID --before before.json --receipt pdf-operation.json
python scripts/pero_kp_api.py job JOB_ID --wait
python scripts/pero_kp_api.py artifact ARTIFACT_ID --out kp_231_Pero.pdf
python scripts/pero_kp_api.py contract DOCUMENT_ID --out contract-form.json
python scripts/pero_kp_api.py save-contract DOCUMENT_ID --form contract-form.json --settings settings.json --receipt contract-save.json
python scripts/pero_kp_api.py generate-contract DOCUMENT_ID --form fresh-contract-form.json --receipt contract-issue.json
python scripts/pero_kp_api.py operation OPERATION_UUID
```

После сохранения настроек договора заново прочитать форму перед генерацией. Для нового задания/правки использовать новую квитанцию; прежнюю не стирать. Существующий PDF/DOCX не перезаписывается помощником. Результат сохранения проверяется GET по ID и ревизии, а серверная нормализация номеров/ID/клиента учитывается.

## Установка после приёмки

Исходный комплект CRM расположен в `integrations/ai`. До включения и сквозной приёмки CRM не заменять действующий облачный навык: он остаётся рабочим источником текущих КП. Из принятой ревизии выполнить `python integrations/ai/scripts/install_skill.py` для просмотра точного списка. Затем `--activate --accepted-sha <полный SHA>` проверит доступ к новому API, сохранит точные копии прежних заменяемых файлов в отдельном каталоге рабочего пространства, установит комплект и сверит SHA-256. Незнакомые owner-файлы не удаляются. API-ошибка/выключенный раздел останавливают переключение до записи.

Для MCP перенести `mcp-config.example.json` в пользовательскую конфигурацию с фактическим абсолютным путём и приватно заданными переменными. Не коммитить заполненный конфиг. MCP и помощник используют один HTTP-клиент; stdio сервера содержит только JSON-RPC, секрет не попадает в аргументы процесса. Связанные инструкции рабочего каталога обновить по [workspace-crm.md](workspace-crm.md), сохранив остальные правила владельца.
