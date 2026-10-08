# Staging acceptance112

Исполняет только root после чтения `engineer-sketch-qa-entry.mjs` и `engineer-sketch-stage-runner.mjs`. Обязательные правила: `D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md`; guard mismatch означает STOP. Коммит и интеграция принадлежат root; current deployed baseline не подтверждает новый fix.

## Guards and scope

Transport `crm-modernization-staging.py` проверяет hostname `crm-staging`, full OCI revision, работающий/healthy web+DB, exact DB ID/StartedAt/volume/network/URL, staging S3 bucket и неизменный W07 watcher; держит existing workflow lock без изменения refresh. Старые backup gates не используются. Сам task entry повторно проверяет container identity, переданный proof, DB name/schema/options, exact S3 endpoint/bucket и credentials до соединения.

Разрешённые записи:3 QA-актора (MANAGER, назначенный ENGINEER, ENGINEER-участник),1 QA-клиент/CONTRACT-проект/DESIGN-изделие,1 engineering config+participant без начислений; реальные files/uploads от manager/engineers; только собственные audit/Notification effects. Direct fixture updates меняют engineerId/status/uploadedById исключительно собственных QA-строк. Production, существующие данные, user preferences, реальные назначения, задачи, платежи, payroll, outboxes и внешние провайдеры не меняются. Runtime route `notifyOrg` пишет только Notification; неожиданный provider/outbox effect даёт fingerprint mismatch и STOP.

Все public-таблицы, schema columns/constraints/indexes и migrations защищены hashes. Единственное volatile поле — `ApiToken.lastUsedAt`. Metadata всех versions/delete markers S3 сверяется до/после; никакие старые blobs не скачиваются. Download bytes только собственных новых originals сравнивается с исходным PNG.

## Commands

Из корня worktree. Сначала dry build; он ничего не подключает:

```powershell
node apps/web/tests/engineer-sketch-stage-runner.mjs build apps/web/test-results/engineer-sketch-112-qa.mjs
```

Root подставляет `<accepted-full-112-sha>`, один `<uuid-v4>` и абсолютный приватный `<output-dir>`; последовательно, без автоматических retries:

```powershell
node apps/web/tests/engineer-sketch-stage-runner.mjs prepare <accepted-full-112-sha> <uuid-v4> <output-dir> --authorized
node apps/web/tests/engineer-sketch-stage-runner.mjs runtime <accepted-full-112-sha> <same-uuid-v4> <same-output-dir> --authorized
node apps/web/tests/engineer-sketch-stage-runner.mjs cleanup <accepted-full-112-sha> <same-uuid-v4> <same-output-dir> --authorized
```

SCP переносит root-reviewed wrapper в файл по SHA, затем `ssh … python3 /root/…py` принимает structured JSON на stdin. Нет сложных inline SSH или host/service mutations.

Prepare возвращает signed ownership checkpoint, сохраняемый приватно. Runtime проверяет actual signed sessions, реальную серверную кнопку замены, manager→assigned engineer, exact duplicate replay, stale/fake context refusal, unassigned refusal, participant, legacy null-author, current DESIGN guard, два разных конкурирующих запроса и concurrent same-mutation delivery. S3 active keys обязаны равняться keys accepted files; originals сохраняются byte-for-byte. Runtime показывает compiled HTTP/server page, но не заменяет браузерную визуальную приёмку; root смотрит новую кнопку инженером на desktop/mobile отдельно.

Cleanup требует неизменного HMAC-signed observation и current CAS, удаляет только captured свои versions/delete markers по точным keys+VersionId, затем собственные File/audit/Notification/participant/config/product/project/client/user IDs транзакционно. По окончании исходные DB/schema/S3 hashes совпадают.

## Failure and recovery

Каждый mutation intent создаётся эксклюзивно; потеря ответа не разрешает повторять prepare/runtime/cleanup. При STOP сохранить output directory; root диагностирует известные fixture IDs и receipts. `capture` — отдельное root-reviewed чтение состояния по signed checkpoint, затем точная cleanup по observation; это не повтор upload и не broad cleanup:

```powershell
node apps/web/tests/engineer-sketch-stage-runner.mjs capture <same-full-sha> <same-uuid-v4> <same-output-dir> --authorized
```

Capture разрешён после failed runtime только после подтверждения, что upstream requests завершены. Непредвиденный own key, чужая связь, changed original hash или неизвестный исход запрещают cleanup. Нельзя ослаблять guard ради завершения.

113 позже удаляет category API/схему; если root меняет порядок интеграции, он обязан обновить поле multipart harness под принятый113 контракт и повторить проверки. Functional repeated-compensation/notify guards112 сохраняются при обычном merge.
