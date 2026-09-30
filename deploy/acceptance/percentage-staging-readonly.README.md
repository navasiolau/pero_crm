# Read-only стадийная приёмка процентных этапов

Скрипт [percentage-staging-readonly.py](percentage-staging-readonly.py) запускается **только внутри существующего `crm-staging`**, из root-reviewed файла с именем `/root/pero-percentage-readonly-<SHA256>.py`. Перед переносом root сверяет SHA256, копирует файл своим accepted file-script способом, не использует инлайн-SSH с кавычками и не меняет W07, watcher, сеть или production. Требования безопасности: [SAFETY-RULES.md](D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md); несовпадение guard — STOP.

Два JSON-запроса на stdin (один UUIDv4 `runId`):

```json
{"operation":"backup","runId":"<uuid-v4>","revision":"3f6da0da082cc707370346c9c3a458ba24d1c189"}
{"operation":"verify","runId":"<same-uuid-v4>","revision":"<root-reviewed-feature-A-full-commit>"}
```

`backup` — **до push в staging**. Скрипт проверяет hostname `crm-staging`, UID root, свой hash в имени, SHA frozen W07 support, lock/idle W07, точный старый web revision и DB identity. Через accepted `Snapshot` читает старую схему/все business rows в одном repeatable-read read-only snapshot, экспортирует его и делает `pg_dump -Fc --snapshot=<token>`. `check_archive` проверяет TABLE и TABLE DATA для каждой таблицы и `_prisma_migrations`; `pg_restore --file=-` проходит полный архив без восстановления. Все raw дампы/TOC/metadata хранятся приватно в `/var/lib/pero-percentage-readonly/<runId>`; stdout содержит только status, хэши и счётчики. Отдельно через staging web container читается **только** MinIO `ListObjectVersions` metadata (key, ETag, size, version, latest/delete marker) бакета `pero-crm-staging`; старые объекты полностью не скачиваются.

После backup root выполняет штатный staging push/watch автодеплой принятого feature commit. Скрипт не применяет миграции. `verify` — после принятого deployment и вне активного refresh: новый web revision передаётся явно, W07 lock/identity проверяются снова. `_prisma_migrations` должен содержать ровно две новые SHA-проверенные миграции. Старые business hashes (включая `PayrollEntry`, `Payout`, Work/Task доли, `File`, `Plugin.updatedAt`) совпадают; только для **сравнения pre/post migration** исключаются новые defaults `Product.noModel`, `Task.physicalOnlyShare`, `PayrollEntry.percentageCompletionShareId`. Единственное постоянное добавление строк — точное множество `LEGACY_PROTECTED` markers, вычисленное из прежних статусов/истории/проектных начислений; новые config/participants/shares и заработанные записи отсутствуют. MinIO metadata inventory key/ETag/size/version совпадает. `ApiToken.lastUsedAt` — единственное принятое volatile поле стадии; `Plugin.updatedAt` не нормализуется.

Ни `backup`, ни `verify` не создают QA-учёток, проектов, файлов, задач, платежей или начислений, не пробуют отрицательные write-операции и не очищают данные. При любом изменении старого бизнес-состояния, storage, триггеров/колонок, revision, W07 или неясном ответе работа останавливается без продолжения. Main/production остаются HOLD до отдельного решения владельца. Численные новые начисления и status/split сценарии native не проверяются, поскольку владелец запретил новые QA-записи; их доказательства — офлайн тесты.
