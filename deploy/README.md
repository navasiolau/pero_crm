# Деплой PERO CRM

GitHub Actions проверяет push в `staging` и `main`, затем публикует образ в GHCR.
Watcher соответствующего сервера скачивает образ и обновляет только `web`.
Изменения попадают в `main` после локальной и реальной staging-приёмки.

| Ветка | Hostname | Каталог / Compose project | Образ |
|---|---|---|---|
| `staging` | `crm-staging` (CT101) | `/opt/crm-staging` / `crm-staging` | `ghcr.io/navasiolau/pero_crm:staging` |
| `main` | `crm` (CT100) | `/opt/crm` / `crm` | `ghcr.io/navasiolau/pero_crm:main` |

В CI обязательны тесты watcher, проверки приложений, lint, typecheck и сборка.
Оба jobs публикации, CRM и Telegram-бот, сохраняют `needs: test`: упавшая проверка
не позволяет опубликовать новый moving tag. Образы имеют дополнительный тег
`sha-<полный Git SHA>` и OCI label `org.opencontainers.image.revision`.

## Файлы и запуск watcher

В каталоге каждой среды находятся:

```text
.env                         # секреты среды, chmod 600
docker-compose.yml           # deploy/docker-compose.server.yml
docker-compose.override.yml  # если есть: локальные healthchecks и настройки
Caddyfile                    # deploy/Caddyfile.lxc
watch-crm.py                  # deploy/watch-crm.py
```

Сервер использует Python 3.10+ и Docker Compose v2; сторонние Python-библиотеки
не нужны. Доступ к приватному GHCR уже должен быть настроен для пользователя
cron (read:packages). Исходники приложения на сервере не нужны.

Production entrypoint `watch-prod.sh` выполняет:

```sh
#!/bin/sh
set -eu
cd /opt/crm
exec /usr/bin/python3 /opt/crm/watch-crm.py
```

На staging внешний `/opt/crm-staging/watch-staging.sh` **сохраняется**: он вызывает
W07 controller, который удерживает общий lock, проверяет active run и SHA внутреннего
watcher. В `/var/lib/pero-staging-refresh/watcher.original.sh` устанавливается
аналогичный внутренний entrypoint с `/opt/crm-staging`; его точный SHA сохраняется
в существующем `watcher.json` с прежним owner. Прямой cron на Python для staging
обходит W07 и запрещён.

Watcher сам не изменяет cron, `.env`, compose, override или W07. Hostname и текущий
каталог выбирают строго одну среду; произвольного аргумента цели нет. Docker
использует только локальный Unix socket. Стандартный `docker-compose.override.yml`
всегда включается в итоговую конфигурацию. Альтернативные неоднозначные compose-файлы
и symlink-файлы приводят к отказу.

## Поведение и защита данных

Перед pull проверяются итоговый ожидаемый образ, допустимая pull policy,
healthcheck web, labels project/service/working_dir контейнеров и mount данных БД.
Старый `image: sha256:…` или `pull_policy: never` в override запрещают запуск;
watcher сам их не исправляет. Отсутствующий или остановленный контейнер не запускается.

Внутренний flock исключает параллельные watcher одной среды. После успешного
`pull web` сравниваются ID скачанного образа и **фактически работающего** `web`.
Если ID совпадает и web здоров, возвращается `unchanged`. Иначе выполняется только
`up -d --no-deps --no-build --pull never web`. Проверяется точный image ID,
здоровье ожидается до 180 секунд; Docker-команды также ограничены временем.
При ошибке pull команда up не выполняется.

Общий deadline — 200 секунд от начала запуска, включая команды и проверки:
последние 15 секунд зарезервированы для проверки БД, каждая команда оставляет
до 5 секунд на завершение своего процесса и потомков. Это укладывается во внешний
W07 timeout 240 секунд. При timeout на Linux уничтожается вся process group CLI,
затем ограниченно ожидается её завершение; внешний W07 timeout не меняется.

ID и весь список mounts БД сравниваются до/после обновления и при ошибке up/health.
Watcher не выполняет SQL, `exec` в БД, seed/reset/restore/down, удаление контейнеров
или томов. Нездоровый web не вызывает автоматического отката данных. Guard mismatch
требует остановиться и изучить причину, а не автоматически «починить» конфигурацию.

Пользователь отдельно запретил прямые действия с production DB. Staging DB
самообновляется существующим refresh; её не пересоздают и не наполняют фикстурами
ради проверки watcher. Локальные тесты watcher полностью изолированы fake adapter
и не подключаются ни к какой БД. Остальные локальные проверки CRM используют
существующую локальную БД по правилам текущей задачи.

Миграции приложения по-прежнему выполняются штатным entrypoint нового образа.
Неизменность DB container/mounts доказывает сохранность подключения к хранилищу,
но не заменяет проверку поведения миграций на staging. В этой фиче миграций нет.

Watcher пишет одну JSON-строку: `status` (`deployed`, `unchanged`, `busy`, `error`),
идентификаторы образа/контейнеров, известную revision и фиксированный код ошибки.
Окружение, сырой compose config, Docker stderr и healthcheck output не выводятся.
У старого опубликованного образа revision может отсутствовать; это не заменяется
предположением о SHA. Ошибка возвращает exit code 1.

W07 перехватывает stdout, поэтому тот же результат независимо сохраняется в
`/var/lib/pero-crm-deploy/result.json` (атомарный последний результат) и добавляется
в `/var/log/pero-crm-deploy.jsonl` (история). Каталог состояния принадлежит root
с mode 700, оба файла — root с mode 600; подмена типом/владельцем/небезопасными правами
вызывает отказ. Watcher не удаляет и не ротирует существующие журналы.

## Восстановление автодеплоя после security pin

Восстановление выполняет оператор после ревью. Оно не сводится к снятию комментария
с cron: старый override способен удерживать прежний образ.

Однократный `install-crm-watcher.py` принимает reviewed JSON manifest и candidate
файл через `--manifest` и `--candidate`. Manifest содержит `hostname`, `runId`,
`validatedRevision`, `helperSha256`, точные `dbContainerId`/`dbMounts` и словарь
`before` (абсолютный путь → текущий SHA256) для cron, override, entrypoint, а на
staging также `watcher.original.sh`/`watcher.json`. Полный deploy helper сначала
проходит локальные проверки и review; git-ревизия кандидата проходит CI.

Installer сохраняет защищённые оригиналы и receipt в
`/var/lib/pero-crm-watcher-rollout-<runId>`, сохраняет внешний W07 wrapper и
активирует только собственную строку cron последним действием. Перед заменой cron
durable receipt получает `activation-intent`. Ошибка после начала этой замены
возвращает `activation-unknown` (exit 2) с readback, а не обещание paused: нужно
осмотреть cron и receipt, не повторять установку или rollback вслепую.

1. Сохранить защищённые копии текущих cron/override/entrypoint/W07 metadata и их SHA;
   убедиться в принятом CI и ожидаемом image текущей ветки. Проверки БД ограничить
   Docker metadata: container ID, project/working-dir labels и mounts, без SQL.
2. Сначала на staging установить проверенный watcher; сохранить внешний W07 wrapper,
   обновить только его внутренний entrypoint и соответствующий SHA. Точечно убрать
   старый image/pull-policy pin, сохранив healthchecks и прочие настройки.
3. Восстановить только строку watcher в текущем cron с сохранением heartbeat-изменений.
   Старый `pin.resume` с историческим cron SHA применять нельзя, если cron изменялся.
4. Запустить штатный внешний staging entrypoint, проверить JSON, фактический
   image/revision/health и прежние DB identity/mounts; повторный запуск даёт `unchanged`.
   Проверить, что W07 продолжает блокировать пересечение с refresh.
5. Только после staging-приёмки и успешных тестов `main` выполнить тот же цикл для
   production. Результаты и точные image IDs записать в отдельное live evidence.

При отказе сохранить состояние и восстановить прежнюю строку cron из проверенной
копии, если это необходимо. Возврат приложения к предыдущему immutable image —
отдельное reviewed действие с оценкой совместимости миграций; автоматического
восстановления БД нет. Не запускать `docker compose down` или удаление volumes.

## Локальные проверки

```text
python -m unittest discover -s deploy/tests -v
openspec validate --specs --strict
git diff --check
```

Исторический RED воспроизводится отдельно (намеренно exit 1):

```text
python deploy/tests/test_watch_crm.py --legacy-baseline ImageRegressionTests -v
```

Это модель подтверждённого чтением старого source-алгоритма, а не выполнение live
watcher. Ни она, ни зелёные unit-тесты не считаются подтверждением установленного
cron, server health или фактического deployment.

Linux-тест отдельно запускает дочерний процесс с потомком, который игнорирует
SIGTERM, проверяет их завершение после timeout и права локального журнала.
Он не обращается к Docker daemon или БД и автоматически выполняется в Linux CI;
на Windows эти две POSIX-проверки отмечены как skipped.
